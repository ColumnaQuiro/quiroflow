<script setup lang="ts">
import { formatEurFromAmount } from '../../utils/billing'
import { averageVisitValueCents, visitValues, type VisitInvoiceRow, type VisitSessionRow } from '../../utils/visitValue'
import type { DateRange } from '../../composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface VisitStats { visits: number; patients: number; returning: number }

const t = useT()
const supabase = useSupabaseClient()
const stats = ref<VisitStats>({ visits: 0, patients: 0, returning: 0 })
const incomePerVisitCents = ref<number | null>(null)
const statsLoading = ref(true)
const valuesLoading = ref(true)
const loading = computed(() => statsLoading.value || valuesLoading.value)
const latestStats = useLatestRun()
const latestValues = useLatestRun()

// The visits, the patients in them and how many had been before are counted
// in the database (dashboard_visit_stats). They used to be cut in memory out
// of every completed visit the clinic has ever had -- retention compares
// against visits from before the range -- which was a page of rows per
// thousand visits, growing every month, for three numbers.
async function loadStats() {
  const isStale = latestStats.start()
  statsLoading.value = true
  const { from, to } = rangeBounds(props.dateRange)
  const { data, error } = await supabase.rpc(
    'dashboard_visit_stats' as never,
    { p_from: from.toISOString(), p_to: to.toISOString(), p_practitioner_id: props.practitionerId || null, p_clinic_id: props.clinicId || null } as never,
  )
  if (isStale()) return
  if (error) throw error
  stats.value = (data ?? { visits: 0, patients: 0, returning: 0 }) as unknown as VisitStats
  statsLoading.value = false
}

// What the period's completed visits were worth -- the bono session each one
// used, else its invoice -- rather than what was taken in the period, which
// counted a bono's money in the month it was bought and its visits in the
// months it was used. See utils/visitValue.ts; the Reports metric of the
// same name reads the same rule.
async function loadVisitValues() {
  const isStale = latestValues.start()
  valuesLoading.value = true
  const { from, to } = rangeBounds(props.dateRange)
  const visitsOf = <Q extends { eq: (c: string, v: string) => Q; gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q; is: (c: string, v: null) => Q }>(q: Q) => {
    let out = q.eq('appointments.status', 'completed').is('appointments.deleted_at', null).gte('appointments.starts_at', from.toISOString()).lte('appointments.starts_at', to.toISOString())
    if (props.practitionerId) out = out.eq('appointments.practitioner_id', props.practitionerId)
    if (props.clinicId) out = out.eq('appointments.clinic_id', props.clinicId)
    return out
  }
  const [sessions, invoices] = await Promise.all([
    fetchAllRows<VisitSessionRow>(
      (f, t) =>
        visitsOf(supabase.from('package_sessions').select('appointment_id, amount_cents, appointments!package_sessions_appointment_id_fkey!inner(id)'))
          .order('id')
          .range(f, t) as unknown as PromiseLike<{ data: VisitSessionRow[] | null; error: unknown }>,
    ),
    fetchAllRows<VisitInvoiceRow>(
      (f, t) =>
        visitsOf(supabase.from('invoices').select('appointment_id, total_cents, status, appointments!invoices_appointment_id_fkey!inner(id)'))
          .neq('status', 'void')
          .order('id')
          .range(f, t) as unknown as PromiseLike<{ data: VisitInvoiceRow[] | null; error: unknown }>,
    ),
  ])
  if (isStale()) return
  const values = visitValues(sessions, invoices)
  incomePerVisitCents.value = averageVisitValueCents(values.keys(), values)
  valuesLoading.value = false
}
// Returned, not just started: Vue's error handling reaches a hook's failure
// only through the promise the hook hands back. Started and dropped, a failed
// read (fetchAllRows throws supabase's error object) went out as a bare
// unhandled rejection -- "Object captured as promise rejection with keys:
// code, details, hint, message", no stack and no component, which is all
// QUIROFLOW-APP-5 had to go on from Google Play's test devices on /numbers.
// Every other widget passes its load straight to onMounted, so this is
// the one that was missing.
const load = () => Promise.all([loadStats(), loadVisitValues()])
onMounted(load)
// Both follow whose figures these are as well as the period now.
watch(() => [props.dateRange, props.practitionerId, props.clinicId], load, { deep: true })

const retentionRate = computed(() => {
  if (stats.value.patients === 0) return null
  return Math.round((stats.value.returning / stats.value.patients) * 100)
})
</script>

<template>
  <div v-if="loading" class="space-y-2">
    <div v-for="i in 3" :key="i" class="flex items-center justify-between py-1.5">
      <UiSkeleton class="h-3 w-24 rounded-ctlSm" />
      <UiSkeleton class="h-3 w-8 rounded-ctlSm" />
    </div>
  </div>
  <ul v-else class="divide-y divide-line-row2 text-[13px]">
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('Visits', 'Visitas') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ stats.visits }}</span>
    </li>
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('Average income per visit', 'Ingreso medio por visita') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ incomePerVisitCents !== null ? formatEurFromAmount(incomePerVisitCents / 100) : '—' }}</span>
    </li>
    <li class="flex items-center justify-between py-1.5">
      <!-- What retentionRate measures: of the patients seen in the period,
           the share who had a completed visit before it. -->
      <span class="text-ink-700">{{ t('Returning patients', 'Pacientes que repiten') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ retentionRate !== null ? `${retentionRate}%` : '—' }}</span>
    </li>
  </ul>
</template>
