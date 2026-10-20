<script setup lang="ts">
// A group class in the app: who has a place, and attendance in one tap --
// opened from the class's tile on the agenda. The web's class panel
// (components/calendar/ClassSessionPanel.vue), for the practitioner in the
// room: "Vino" completes the visit (utils/completeVisit, appointment.completed
// fired only if this tap completed it), "No vino" marks the no-show
// (appointment.no_show), "Vinieron todos los demás" does the rest at once.
// A name opens that visit's own screen, where it is charged or drawn from a
// bono like any visit. Adding people, the waitlist and editing the class
// stay on the web calendar.
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const route = useRoute()
const router = useRouter()
const t = useT()
const supabase = useSupabaseClient()
const { fire } = useAutomations()
const { context, restricted } = usePractitionerContext()
const { shown } = usePrivacyMode()
const sessionId = computed(() => String(route.params.id))
const readOnly = computed(() => restricted('calendar_read_only'))

interface Session { id: string; starts_at: string; ends_at: string; capacity: number; cancelled_at: string | null; appointment_types: { name: string } | null; team_members: { full_name: string } | null; calendar_resources: { name: string } | null }
interface Place { id: string; status: string; patient_id: string; patients: { first_name: string; last_name: string | null } | null }

const session = ref<Session | null>(null)
const places = ref<Place[]>([])
const loaded = ref(false)
const busy = ref(false)
const error = ref('')

async function load() {
  const [{ data: s, error: e1 }, { data: ps, error: e2 }] = await Promise.all([
    supabase.from('class_sessions').select('id, starts_at, ends_at, capacity, cancelled_at, appointment_types(name), team_members!class_sessions_practitioner_id_fkey(full_name), calendar_resources(name)').eq('id', sessionId.value).maybeSingle(),
    supabase.from('appointments').select('id, status, patient_id, patients(first_name, last_name)').eq('class_session_id', sessionId.value).is('deleted_at', null).neq('status', 'cancelled').order('created_at'),
  ])
  error.value = e1?.message ?? e2?.message ?? ''
  session.value = (s as unknown as Session | null) ?? null
  places.value = (ps as unknown as Place[] | null) ?? []
  loaded.value = true
}
watch(sessionId, load, { immediate: true })

const tz = computed(() => context.value?.timeZone ?? DEFAULT_CLINIC_TIMEZONE)
const when = computed(() => {
  const s = session.value
  if (!s) return ''
  const d = new Date(s.starts_at)
  const day = d.toLocaleDateString(t('en-GB', 'es-ES'), { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz.value })
  return `${day} · ${clinicTimeLabel(d, tz.value)}–${clinicTimeLabel(new Date(s.ends_at), tz.value)}`
})
const started = computed(() => !!session.value && new Date(session.value.starts_at).getTime() <= Date.now())
const pending = computed(() => places.value.filter((p) => p.status === 'booked'))
const name = (p: Place) => shown([p.patients?.first_name, p.patients?.last_name].filter(Boolean).join(' '))

async function came(p: Place) {
  busy.value = true
  error.value = ''
  const { completedNow, error: e } = await completeVisit(supabase, p.id)
  if (e) error.value = e
  else if (completedNow) fire('appointment.completed', { patientId: p.patient_id, appointmentId: p.id })
  busy.value = false
}
async function missed(p: Place) {
  busy.value = true
  error.value = ''
  const { data, error: e } = await supabase.from('appointments').update({ status: 'no_show' } as never).eq('id', p.id).eq('status', 'booked').select('id')
  if (e) error.value = e.message
  else if ((data ?? []).length) fire('appointment.no_show', { patientId: p.patient_id, appointmentId: p.id })
  busy.value = false
}
async function mark(p: Place, how: 'came' | 'missed') {
  await (how === 'came' ? came(p) : missed(p))
  await load()
}
async function allOthersCame() {
  for (const p of [...pending.value]) await came(p)
  await load()
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page" data-cy="class-screen">
    <AppPageHeader :title="session?.appointment_types?.name ?? t('Class', 'Clase')" back @back="router.back()" />
    <div class="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
      <div class="mx-auto flex max-w-[560px] flex-col gap-3">
        <p v-if="loaded && !session" class="text-[14px] text-ink-muted">{{ t('This class could not be found.', 'No se ha encontrado esta clase.') }}</p>
        <template v-if="session">
          <div class="rounded-card border border-line bg-surface px-4 py-3">
            <p class="text-[13.5px] capitalize text-ink-700">{{ when }}</p>
            <p class="text-[13px] text-ink-muted">{{ session.team_members?.full_name }}<template v-if="session.calendar_resources"> · {{ session.calendar_resources.name }}</template></p>
            <p class="mt-2 inline-flex h-6 items-center rounded-pill bg-brand-tint px-2.5 text-[12px] font-semibold text-brand-text" data-cy="class-screen-places">
              {{ t(`${places.length} of ${session.capacity} places`, `${places.length} de ${session.capacity} plazas`) }}
            </p>
            <p v-if="session.cancelled_at" class="mt-2 text-[13px] text-danger-text">{{ t('This class was cancelled.', 'Esta clase se canceló.') }}</p>
          </div>

          <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>

          <div class="rounded-card border border-line bg-surface px-4 py-1">
            <p v-if="!places.length" class="py-3 text-[13.5px] text-ink-muted">{{ t('Nobody has a place yet.', 'Todavía no hay nadie apuntado.') }}</p>
            <div v-for="p in places" :key="p.id" class="flex items-center gap-2 border-b border-line-divider py-2.5 last:border-b-0" data-cy="class-screen-place" :data-status="p.status">
              <NuxtLink :to="`/calendar/${p.id}`" class="min-w-0 flex-1 truncate text-[15px] font-medium text-ink-900">{{ name(p) }}</NuxtLink>
              <template v-if="!readOnly && !session.cancelled_at">
                <button type="button" class="h-10 rounded-ctl border px-3 text-[13px] font-semibold disabled:opacity-60" :class="p.status === 'completed' ? 'border-success-border bg-success-bg text-success-text' : 'border-line-control bg-surface text-ink-500'" :disabled="busy || p.status !== 'booked'" data-cy="class-screen-came" @click="mark(p, 'came')">{{ t('Came', 'Vino') }}</button>
                <button type="button" class="h-10 rounded-ctl border px-3 text-[13px] font-semibold disabled:opacity-60" :class="p.status === 'no_show' ? 'border-danger-border bg-danger-bg text-danger-text' : 'border-line-control bg-surface text-ink-500'" :disabled="busy || p.status !== 'booked'" data-cy="class-screen-missed" @click="mark(p, 'missed')">{{ t("Didn't", 'No vino') }}</button>
              </template>
            </div>
          </div>

          <AppButton v-if="!readOnly && !session.cancelled_at && started && pending.length" variant="primary" :disabled="busy" data-cy="class-screen-all-came" @click="allOthersCame">
            {{ places.length === pending.length ? t('Everyone came', 'Vinieron todos') : t('Everyone else came', 'Vinieron todos los demás') }}
          </AppButton>
          <p class="text-[12.5px] text-ink-muted">{{ t('Tap a name to charge the visit or draw it from a bono. Adding people, the waitlist and changing the class are on the web calendar.', 'Toca un nombre para cobrar la visita o descontarla de un bono. Añadir personas, la lista de espera y cambiar la clase, en la agenda web.') }}</p>
        </template>
      </div>
    </div>
  </div>
</template>
