<script setup lang="ts">
import { carePlanCadenceLabel } from '../../utils/carePlanCadence'
import { patientPlanProgress } from '../../utils/patientPlanProgress'

// The patient's care plan, in the app and the portal: how far along they
// are, which of its visits are booked, and a way to change one.
//
// The app's home used to show the staff record's card here (PhaseStats with
// editing off), which spoke to the clinic -- "No plan set up for this
// patient yet" -- and stopped at a progress bar. A patient's question is
// "when am I next in, and how many are left", so this lists the dates.
//
// Changing a time goes through the app's slot picker when the clinic lets
// patients move visits and it is far enough off (rescheduleTo; the portal
// has none). Otherwise it becomes a message to the clinic, written for them
// and waiting in Messages to send.
const props = defineProps<{
  patientId: string
  messagesTo: string
  /** Where "Change time" goes for one visit; omitted where there is no slot picker. */
  rescheduleTo?: (appointmentId: string) => string
  /** Where "Book" goes when the clinic takes bookings; null to ask the clinic instead. */
  bookTo?: string | null
}>()

const t = useT()
const supabase = useSupabaseClient()
const { settings, zoneOf } = usePatientAppInfo()
const { draft } = usePatientMessageDraft()
const locale = computed(() => t('en-GB', 'es-ES'))

interface Plan {
  id: string
  name: string
  frequency_value: number
  frequency_unit: 'week' | 'month'
  visits_per_period: number | null
  total_visits: number
  started_at: string
}
interface Visit {
  id: string
  starts_at: string
  status: string
  clinic_id: string | null
  appointment_types: { name: string } | null
}

const loading = ref(true)
const plan = ref<Plan | null>(null)
const visits = ref<Visit[]>([])

async function load() {
  if (!props.patientId) return
  loading.value = true
  const { data: plans } = await supabase
    .from('care_plans')
    .select('id, name, frequency_value, frequency_unit, visits_per_period, total_visits, started_at')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
    .limit(1)
  plan.value = (plans as Plan[] | null)?.[0] ?? null
  if (plan.value) {
    const { data } = await supabase
      .from('appointments')
      .select('id, starts_at, status, clinic_id, appointment_types(name)')
      .eq('patient_id', props.patientId)
      .is('deleted_at', null)
      .gte('starts_at', plan.value.started_at)
      .order('starts_at')
    visits.value = (data as unknown as Visit[] | null) ?? []
  }
  loading.value = false
}
watch(() => props.patientId, load, { immediate: true })

const progress = computed(() => (plan.value ? patientPlanProgress(plan.value, visits.value, new Date()) : null))
const cadence = computed(() => (plan.value ? carePlanCadenceLabel({ ...plan.value, visits_per_period: plan.value.visits_per_period ?? 1 }, t) : ''))
// The next few; the Visits tab has the rest.
const SHOWN = 4
const shown = computed(() => progress.value?.booked.slice(0, SHOWN) ?? [])
const more = computed(() => Math.max(0, (progress.value?.booked.length ?? 0) - SHOWN))

function when(v: Visit) {
  return new Date(v.starts_at).toLocaleString(locale.value, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: zoneOf(v.clinic_id) })
}
// The same rule the Visits tab applies (usePatientAppointments.canChange):
// the RPC refuses a move inside the clinic's notice window anyway.
function canMove(v: Visit) {
  return !!props.rescheduleTo && settings.value.rescheduleEnabled && new Date(v.starts_at).getTime() >= Date.now() + settings.value.changeNoticeHours * 3600_000
}
function changeTime(v: Visit) {
  if (canMove(v)) return navigateTo(props.rescheduleTo!(v.id))
  draft.value = t(
    `Hello, could I change my visit on ${when(v)} to another time? `,
    `Hola, ¿podría cambiar mi cita del ${when(v)} a otro momento? `,
  )
  return navigateTo(props.messagesTo)
}
function askToBook() {
  const n = progress.value?.toBook ?? 0
  draft.value = n === 1
    ? t('Hello, I would like to book the visit left in my plan. ', 'Hola, me gustaría reservar la visita que me queda del plan. ')
    : t(`Hello, I would like to book the ${n} visits left in my plan. `, `Hola, me gustaría reservar las ${n} visitas que me quedan del plan. `)
  return navigateTo(props.messagesTo)
}
</script>

<template>
  <section v-if="loading || plan" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-plan">
    <div v-if="loading" class="space-y-2">
      <UiSkeleton class="h-3.5 w-32 rounded-ctlSm" />
      <UiSkeleton class="h-[6px] w-full rounded-full" />
    </div>
    <template v-else-if="plan && progress">
      <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ t('Your care plan', 'Tu plan de tratamiento') }}</p>
      <div class="mt-1.5 flex items-baseline justify-between gap-3">
        <p class="min-w-0 truncate text-[15px] font-[640] text-ink-900">{{ plan.name }}</p>
        <p class="shrink-0 text-[13px] text-ink-muted" data-cy="patient-plan-count">
          <span class="text-[15px] font-[640] text-ink-900">{{ progress.done }}</span>
          {{ t(`of ${plan.total_visits}`, `de ${plan.total_visits}`) }}
        </p>
      </div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-subtle">
        <div class="h-full rounded-pill bg-brand transition-all" :style="{ width: `${progress.pct}%` }" />
      </div>
      <p class="mt-1.5 text-[12.5px] text-ink-muted">
        <template v-if="progress.left === 0">{{ t('Plan complete. Well done!', '¡Plan completado! Buen trabajo.') }}</template>
        <template v-else>
          {{ progress.left === 1 ? t('1 visit left', 'Te queda 1 visita') : t(`${progress.left} visits left`, `Te quedan ${progress.left} visitas`) }}
          <template v-if="cadence"> &middot; {{ cadence }}</template>
        </template>
      </p>

      <ul v-if="shown.length > 0" class="mt-3 divide-y divide-line-divider border-t border-line-divider" data-cy="patient-plan-booked">
        <li v-for="v in shown" :key="v.id" class="flex items-center justify-between gap-3 py-2.5">
          <div class="min-w-0">
            <p class="text-[13.5px] font-medium text-ink-900 first-letter:uppercase">{{ when(v) }}</p>
            <p v-if="v.appointment_types?.name" class="truncate text-[12px] text-ink-faint">{{ v.appointment_types.name }}</p>
          </div>
          <button type="button" class="min-h-9 shrink-0 rounded-ctl border border-line-control bg-surface px-3 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle active:bg-surface-subtle" data-cy="patient-plan-change" @click="changeTime(v)">
            {{ canMove(v) ? t('Change time', 'Cambiar hora') : t('Ask to change', 'Pedir cambio') }}
          </button>
        </li>
      </ul>
      <p v-if="more > 0" class="mt-1 text-[12px] text-ink-faint">{{ more === 1 ? t('and 1 more booked', 'y 1 más reservada') : t(`and ${more} more booked`, `y ${more} más reservadas`) }}</p>

      <div v-if="progress.toBook > 0" class="mt-3 flex items-center justify-between gap-3 rounded-ctl bg-surface-subtle px-3 py-2.5" data-cy="patient-plan-to-book">
        <p class="text-[12.5px] text-ink-700">
          {{ progress.toBook === 1 ? t('1 visit still has no date', '1 visita aún sin fecha') : t(`${progress.toBook} visits still have no date`, `${progress.toBook} visitas aún sin fecha`) }}
        </p>
        <NuxtLink v-if="bookTo" :to="bookTo" class="shrink-0 text-[12.5px] font-semibold text-brand-text">{{ t('Book', 'Reservar') }}</NuxtLink>
        <button v-else type="button" class="shrink-0 text-[12.5px] font-semibold text-brand-text" data-cy="patient-plan-ask-book" @click="askToBook">{{ t('Ask the clinic', 'Pedir a la clínica') }}</button>
      </div>
    </template>
  </section>
</template>
