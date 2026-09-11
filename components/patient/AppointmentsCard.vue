<script setup lang="ts">
// The patient's own appointments, with whatever control the clinic has
// granted. Rendered identically by the web portal and the mobile app.
//
// Every button here is a suggestion: the RPCs (0162) re-check the clinic's
// switch and the notice window server-side, so hiding a button is a
// courtesy, not the enforcement.
const props = defineProps<{
  patientId: string
  settings: PatientAppSettings
  /** The mobile app has a /book route; the web portal doesn't (yet). */
  bookHref?: string
}>()

interface AppointmentRow {
  id: string
  starts_at: string
  ends_at: string
  status: string
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
}

const supabase = useSupabaseClient()
const t = useT()
const { showToast } = useToast()

const appointments = ref<AppointmentRow[]>([])
const past = ref<AppointmentRow[]>([])
const loading = ref(true)
const showPast = ref(false)
const busyId = ref<string | null>(null)

const SELECT = 'id, starts_at, ends_at, status, appointment_types(name), team_members(full_name)'

async function load() {
  loading.value = true
  const nowIso = new Date().toISOString()
  const [{ data: upcoming }, { data: history }] = await Promise.all([
    supabase.from('appointments').select(SELECT).eq('patient_id', props.patientId).gte('starts_at', nowIso).neq('status', 'cancelled').order('starts_at'),
    supabase.from('appointments').select(SELECT).eq('patient_id', props.patientId).lt('starts_at', nowIso).order('starts_at', { ascending: false }).limit(20),
  ])
  appointments.value = (upcoming as unknown as AppointmentRow[]) ?? []
  past.value = (history as unknown as AppointmentRow[]) ?? []
  loading.value = false
}
onMounted(load)
watch(() => props.patientId, load)

// The same rule the RPC enforces, so the button disappears at the moment it
// would start being refused rather than failing on click.
function withinNotice(appt: AppointmentRow): boolean {
  return new Date(appt.starts_at).getTime() < Date.now() + props.settings.changeNoticeHours * 3600_000
}
function canChange(appt: AppointmentRow): boolean {
  return appt.status === 'booked' && !withinNotice(appt)
}

async function cancel(appt: AppointmentRow) {
  const when = formatWhen(appt.starts_at)
  if (!confirm(t(`Cancel your appointment on ${when}?`, `¿Cancelar tu cita del ${when}?`))) return
  busyId.value = appt.id
  const { error } = await supabase.rpc('cancel_patient_appointment', { p_appointment_id: appt.id })
  busyId.value = null
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(t('Appointment cancelled.', 'Cita cancelada.'))
  await load()
}

// Rescheduling needs a slot picker, which is the booking flow's job -- this
// hands off to it rather than growing a second availability calendar here.
const emit = defineEmits<{ reschedule: [appointmentId: string] }>()

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const statusLabel: Record<string, [string, string]> = {
  booked: ['Booked', 'Reservada'],
  completed: ['Attended', 'Asistida'],
  cancelled: ['Cancelled', 'Cancelada'],
  no_show: ['Missed', 'No asistida'],
}
</script>

<template>
  <section>
    <div class="flex items-center justify-between">
      <h2 class="text-[13px] font-semibold text-ink-700">{{ t('Upcoming appointments', 'Próximas citas') }}</h2>
      <NuxtLink v-if="settings.bookingEnabled && bookHref" :to="bookHref" class="text-[12.5px] font-medium text-brand-text">
        {{ t('+ New', '+ Nueva') }}
      </NuxtLink>
    </div>

    <div class="mt-2 overflow-hidden rounded-card border border-line bg-surface">
      <div v-if="loading" class="p-4 text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
      <ul v-else-if="appointments.length > 0" class="divide-y divide-line">
        <li v-for="appt in appointments" :key="appt.id" class="px-4 py-3">
          <p class="text-[13.5px] font-medium text-ink-900">{{ formatWhen(appt.starts_at) }}</p>
          <p class="text-[12.5px] text-ink-muted">
            {{ appt.appointment_types?.name ?? t('Appointment', 'Cita') }}
            <template v-if="appt.team_members?.full_name"> &middot; {{ appt.team_members.full_name }}</template>
          </p>

          <div v-if="settings.cancelEnabled || settings.rescheduleEnabled" class="mt-2 flex items-center gap-3">
            <template v-if="canChange(appt)">
              <button
                v-if="settings.rescheduleEnabled"
                type="button"
                class="text-[12.5px] font-medium text-brand-text"
                :disabled="busyId === appt.id"
                @click="emit('reschedule', appt.id)"
              >
                {{ t('Reschedule', 'Cambiar') }}
              </button>
              <button
                v-if="settings.cancelEnabled"
                type="button"
                class="text-[12.5px] font-medium text-danger-text"
                :disabled="busyId === appt.id"
                @click="cancel(appt)"
              >
                {{ busyId === appt.id ? t('Cancelling…', 'Cancelando…') : t('Cancel', 'Cancelar') }}
              </button>
            </template>
            <!-- Inside the notice window the clinic has to be involved, so
                 say that rather than showing a button that will be refused. -->
            <p v-else-if="appt.status === 'booked'" class="text-[12px] text-ink-faint">
              {{ t('Contact the clinic to change this one.', 'Contacta con la clínica para cambiarla.') }}
            </p>
          </div>
        </li>
      </ul>
      <p v-else class="p-4 text-center text-[13px] text-ink-faint">{{ t('No upcoming appointments.', 'No tienes citas próximas.') }}</p>
    </div>

    <div v-if="past.length > 0" class="mt-2">
      <button type="button" class="text-[12.5px] font-medium text-ink-muted hover:text-ink-700" @click="showPast = !showPast">
        {{ showPast ? t('Hide past appointments', 'Ocultar citas anteriores') : t('Show past appointments', 'Ver citas anteriores') }}
      </button>
      <ul v-if="showPast" class="mt-2 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        <li v-for="appt in past" :key="appt.id" class="px-4 py-2.5">
          <p class="text-[13px] text-ink-700">{{ formatWhen(appt.starts_at) }}</p>
          <p class="text-[12px] text-ink-faint">
            {{ appt.appointment_types?.name ?? t('Appointment', 'Cita') }} &middot;
            {{ t(statusLabel[appt.status]?.[0] ?? appt.status, statusLabel[appt.status]?.[1] ?? appt.status) }}
          </p>
        </li>
      </ul>
    </div>
  </section>
</template>
