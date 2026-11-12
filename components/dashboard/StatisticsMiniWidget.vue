<script setup lang="ts">
import { formatEurFromAmount } from '../../utils/billing'
import { isReceipt } from '../../utils/paymentReceipts'
import type { DateRange } from '../../composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface VisitStats { visits: number; patients: number; returning: number }
interface PaymentRow {
  amount_cents: number
  method: string
  invoice_id: string | null
  invoices?: { status: string; appointments?: { status: string; practitioner_id: string | null; clinic_id: string | null } | null } | null
}

const t = useT()
const supabase = useSupabaseClient()
const stats = ref<VisitStats>({ visits: 0, patients: 0, returning: 0 })
const payments = ref<PaymentRow[]>([])
const statsLoading = ref(true)
const paymentsLoading = ref(true)
const loading = computed(() => statsLoading.value || paymentsLoading.value)
const latestStats = useLatestRun()
const latestPayments = useLatestRun()

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

async function loadPayments() {
  const isStale = latestPayments.start()
  paymentsLoading.value = true
  const { from, to } = rangeBounds(props.dateRange)
  // With a practitioner or clinic chosen, a payment counts only when its
  // invoice is for a completed visit of theirs. The visit comes embedded
  // under the invoice; it used to be looked up in every completed visit and
  // every invoice the clinic has, both paged in full for this one walk.
  // Without a filter nothing reads the visit, so it is not asked for.
  const filtered = !!props.practitionerId || !!props.clinicId
  const invoice = filtered ? 'invoices!payments_invoice_id_fkey(status, appointments!invoices_appointment_id_fkey(status, practitioner_id, clinic_id))' : 'invoices!payments_invoice_id_fkey(status)'
  const p = await fetchAllRows<PaymentRow>((f, t) =>
    supabase
      .from('payments')
      .select(`amount_cents, method, invoice_id, ${invoice}`)
      .gte('paid_at', from.toISOString())
      .lte('paid_at', to.toISOString())
      .range(f, t) as unknown as PromiseLike<{ data: PaymentRow[] | null; error: unknown }>,
  )
  if (isStale()) return
  // The void rule moved out of the query when the join went from inner to
  // left: a payment with no invoice has nothing to void and must survive it.
  const notVoid = (row: PaymentRow) => row.invoices?.status !== 'void'
  // Credit and write-off rows settle an invoice without money arriving, and
  // this figure is money -- see utils/paymentReceipts. Dropped here rather
  // than at each total, because every number on this widget is takings.
  payments.value = p.filter((row) => notVoid(row) && isReceipt(row.method))
  paymentsLoading.value = false
}
// Returned, not just started: Vue's error handling reaches a hook's failure
// only through the promise the hook hands back. Started and dropped, a failed
// read (fetchAllRows throws supabase's error object) went out as a bare
// unhandled rejection -- "Object captured as promise rejection with keys:
// code, details, hint, message", no stack and no component, which is all
// QUIROFLOW-APP-5 had to go on from Google Play's test devices on /numbers.
// Every other widget passes its load straight to onMounted, so this is
// the one that was missing.
const load = () => Promise.all([loadStats(), loadPayments()])
onMounted(load)
// Both follow whose figures these are as well as the period now: the counts
// are per period, and the payments carry their visit only under a filter.
watch(() => [props.dateRange, props.practitionerId, props.clinicId], load, { deep: true })

const filteredPayments = computed(() => {
  if (!props.practitionerId && !props.clinicId) return payments.value
  return payments.value.filter((p) => {
    const appt = p.invoices?.appointments
    if (!appt || appt.status !== 'completed') return false
    if (props.practitionerId && appt.practitioner_id !== props.practitionerId) return false
    if (props.clinicId && appt.clinic_id !== props.clinicId) return false
    return true
  })
})

// Euros taken per completed visit. Not PVA: PVA is visits per new patient
// (Statistics), and this used to be called that too.
const incomePerVisit = computed(() => {
  const totalCents = filteredPayments.value.reduce((sum, p) => sum + p.amount_cents, 0)
  if (stats.value.visits === 0) return null
  return totalCents / 100 / stats.value.visits
})

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
      <span class="font-mono text-[12.5px] text-ink-900">{{ incomePerVisit !== null ? formatEurFromAmount(incomePerVisit) : '—' }}</span>
    </li>
    <li class="flex items-center justify-between py-1.5">
      <!-- What retentionRate measures: of the patients seen in the period,
           the share who had a completed visit before it. -->
      <span class="text-ink-700">{{ t('Returning patients', 'Pacientes que repiten') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ retentionRate !== null ? `${retentionRate}%` : '—' }}</span>
    </li>
  </ul>
</template>
