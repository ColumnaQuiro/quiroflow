<script setup lang="ts">
import { formatTime, formatWeekdayDate } from '~/utils/billing'

// "Anular citas futuras", from a patient's "More actions" menu: every visit
// still ahead of them, cancelled in one go -- someone who stops treatment, or
// moves away, used to mean opening and cancelling each one in the calendar.
//
// Listed first, all ticked, so the desk sees what goes and can keep one.
// Deliberately less than the calendar's cancel (components/calendar/
// CancelStep.vue): no cancellation fee, and the freed times are not offered
// to the waiting list -- both are a call made one visit at a time. Reminders
// already scheduled stop on their own once a visit is cancelled
// (automationEngine's appointmentGone).
//
// Telling the patient is opt-in, and it is ONE message: the clinic's
// "appointment cancelled" automation fired once, for the soonest visit.
// Fired per visit, someone with ten booked would get ten messages.

interface FutureAppointment {
  id: string
  starts_at: string
  ends_at: string
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
}

const props = defineProps<{ patientId: string; patientName: string }>()
const emit = defineEmits<{ close: []; done: [count: number] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const { fire } = useAutomations()
const t = useT()

const loading = ref(true)
const appointments = ref<FutureAppointment[]>([])
const picked = ref<Set<string>>(new Set())
const hasCancelRule = ref(false)
const notify = ref(false)
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, starts_at, ends_at, appointment_types(name), team_members(full_name)')
      .eq('patient_id', props.patientId)
      .is('deleted_at', null)
      .not('status', 'in', '(cancelled,completed,no_show)')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at'),
    supabase
      .from('automation_rules')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', store.accountId!)
      .eq('trigger_event', 'appointment.cancelled')
      .eq('enabled', true),
  ])
  appointments.value = (data as unknown as FutureAppointment[] | null) ?? []
  picked.value = new Set(appointments.value.map((a) => a.id))
  hasCancelRule.value = (count ?? 0) > 0
  loading.value = false
})

function toggle(id: string) {
  const next = new Set(picked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  picked.value = next
}

const n = computed(() => picked.value.size)

async function confirm() {
  if (!n.value) return
  busy.value = true
  error.value = ''
  // Only what is still not cancelled, and only what really changed: a visit a
  // colleague cancelled meanwhile is not counted, or followed up, twice.
  const { data: changed, error: e } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .in('id', [...picked.value])
    .neq('status', 'cancelled')
    .select('id, starts_at')
  busy.value = false
  if (e) {
    error.value = e.message
    return
  }
  const done = ((changed as { id: string; starts_at: string }[] | null) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  if (notify.value && done[0]) fire('appointment.cancelled', { patientId: props.patientId, appointmentId: done[0].id })
  emit('done', done.length)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/30 p-0 lg:items-center lg:p-6" @click.self="emit('close')">
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="t('Cancel future appointments', 'Anular citas futuras')"
      class="flex max-h-[92vh] w-full flex-col rounded-t-card border border-line bg-surface p-5 shadow-popover lg:max-w-[520px] lg:rounded-card"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      data-cy="cancel-future"
    >
      <h2 class="text-[17px] font-semibold tracking-tightTitle text-ink-900">{{ t('Cancel future appointments', 'Anular citas futuras') }}</h2>

      <div v-if="loading" class="mt-4 flex flex-col gap-2">
        <UiSkeleton v-for="i in 3" :key="i" class="h-9 w-full rounded" />
      </div>

      <p v-else-if="!appointments.length" class="mt-3 text-[13.5px] text-ink-700" data-cy="cancel-future-none">
        {{ t(`${patientName} has no appointments ahead.`, `${patientName} no tiene citas pendientes.`) }}
      </p>

      <template v-else>
        <p class="mt-2 text-[13.5px] leading-[1.55] text-ink-700">
          {{
            t(
              `${patientName}'s visits from today on. They stay in their history as cancelled; no fee is charged and the times are left free.`,
              `Las citas de ${patientName} a partir de hoy. Quedan en su historial como canceladas; no se cobra tarifa y los huecos quedan libres.`,
            )
          }}
        </p>
        <ul class="mt-3 min-h-0 flex-1 divide-y divide-line-divider overflow-y-auto rounded-ctl border border-line">
          <li v-for="a in appointments" :key="a.id">
            <label class="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-[13px] hover:bg-surface-subtle" data-cy="cancel-future-row">
              <input type="checkbox" :checked="picked.has(a.id)" class="rounded border-line-control text-brand focus:ring-brand" @change="toggle(a.id)" />
              <span class="flex min-w-0 flex-col">
                <span class="font-medium text-ink-900">{{ formatWeekdayDate(a.starts_at) }} · <span class="font-mono">{{ formatTime(a.starts_at) }}</span></span>
                <span class="truncate text-[12px] text-ink-muted">
                  {{ [a.appointment_types?.name, a.team_members?.full_name].filter(Boolean).join(' · ') }}
                </span>
              </span>
            </label>
          </li>
        </ul>

        <label v-if="hasCancelRule" class="mt-3 flex items-start gap-2 text-[13px] text-ink-700">
          <input v-model="notify" type="checkbox" class="mt-0.5 rounded border-line-control text-brand focus:ring-brand" data-cy="cancel-future-notify" />
          <span>
            {{ t('Let the patient know', 'Avisar al paciente') }}
            <span class="block text-[12px] text-ink-muted">{{ t('Your “appointment cancelled” automation runs once, for the soonest visit — one message, not one per visit.', 'Tu automatización de «cita cancelada» se ejecuta una vez, sobre la cita más próxima: un mensaje, no uno por cita.') }}</span>
          </span>
        </label>
      </template>

      <p v-if="error" role="alert" class="mt-3 text-[12.5px] text-danger-text">{{ error }}</p>

      <div class="mt-4 flex flex-col gap-2 lg:flex-row lg:justify-end">
        <button
          type="button"
          class="flex h-9 touch:h-11 items-center justify-center rounded-ctl border border-line-control px-3.5 text-[13.5px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus lg:h-[34px]"
          @click="emit('close')"
        >
          {{ appointments.length ? t('Keep them', 'No anular') : t('Close', 'Cerrar') }}
        </button>
        <button
          v-if="appointments.length"
          type="button"
          :disabled="!n || busy"
          class="flex h-9 touch:h-11 items-center justify-center rounded-ctl bg-danger-text px-3.5 text-[13.5px] font-semibold text-white outline-none focus-visible:shadow-focusDanger disabled:cursor-not-allowed disabled:opacity-50 lg:h-[34px]"
          data-cy="cancel-future-confirm"
          @click="confirm"
        >
          {{ busy ? t('Cancelling…', 'Anulando…') : t(`Cancel ${n} appointment${n === 1 ? '' : 's'}`, `Anular ${n} cita${n === 1 ? '' : 's'}`) }}
        </button>
      </div>
    </div>
  </div>
</template>
