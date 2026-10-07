<script setup lang="ts">
import { formatEurFromAmount } from '~/utils/billing'
import { isReceipt } from '~/utils/paymentReceipts'
import type { DateRange } from '~/composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface ApptRow { id: string; patient_id: string; starts_at: string; practitioner_id: string | null; clinic_id: string | null }
interface PaymentRow { amount_cents: number; method: string; invoice_id: string | null; invoices?: { status: string } | null }
interface InvoiceRow { id: string; appointment_id: string | null }

const t = useT()
const supabase = useSupabaseClient()
const allCompleted = ref<ApptRow[]>([])
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const historyLoading = ref(true)
const paymentsLoading = ref(true)
const loading = computed(() => historyLoading.value || paymentsLoading.value)
const latestHistory = useLatestRun()
const latestPayments = useLatestRun()

// Two loads, because only one of them is about the period. The completed
// visits are all-time -- retention compares against visits from before the
// range -- and every figure below cuts the range out of them in memory, so
// they used to be paged in full again on every change of dates for an
// identical answer. They now reload only when whose figures these are
// changes, and a new period costs only its payments.
async function loadHistory() {
  const isStale = latestHistory.start()
  historyLoading.value = true
  // Invoices are only read to walk payment -> invoice -> appointment when a
  // practitioner/clinic filter is set (filteredPayments short-circuits
  // without one), so an unfiltered dashboard was paging the whole invoices
  // table for nothing.
  const needsInvoices = !!props.practitionerId || !!props.clinicId
  // Narrowed in the query to the practitioner/clinic filteredCompleted keeps
  // anyway. The payment walk below reads appointmentById unfiltered, but a
  // visit that fails the filter makes its payment drop out there exactly as
  // an absent one does, so no figure moves.
  let completedQuery = supabase.from('appointments').select('id, patient_id, starts_at, practitioner_id, clinic_id').eq('status', 'completed')
  let completedCount = supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('status', 'completed')
  if (props.practitionerId) {
    completedQuery = completedQuery.eq('practitioner_id', props.practitionerId)
    completedCount = completedCount.eq('practitioner_id', props.practitionerId)
  }
  if (props.clinicId) {
    completedQuery = completedQuery.eq('clinic_id', props.clinicId)
    completedCount = completedCount.eq('clinic_id', props.clinicId)
  }
  const [completed, inv] = await Promise.all([
    fetchAllRows<ApptRow>((f, t) => completedQuery.range(f, t), { total: completedCount }),
    needsInvoices
      ? fetchAllRows<InvoiceRow>(
          (f, t) => supabase.from('invoices').select('id, appointment_id').range(f, t),
          { total: supabase.from('invoices').select('id', { count: 'exact', head: true }) },
        )
      : Promise.resolve([] as InvoiceRow[]),
  ])
  if (isStale()) return
  allCompleted.value = completed
  invoices.value = inv
  historyLoading.value = false
}

async function loadPayments() {
  const isStale = latestPayments.start()
  paymentsLoading.value = true
  const { from, to } = rangeBounds(props.dateRange)
  const p = await fetchAllRows<PaymentRow>((f, t) =>
    supabase
      .from('payments')
      .select('amount_cents, method, invoice_id, invoices!payments_invoice_id_fkey(status)')
      .gte('paid_at', from.toISOString())
      .lte('paid_at', to.toISOString())
      .range(f, t),
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
onMounted(() => {
  loadHistory()
  loadPayments()
})
watch(() => [props.practitionerId, props.clinicId], loadHistory)
watch(() => props.dateRange, loadPayments, { deep: true })

const filteredCompleted = computed(() => {
  if (!props.practitionerId && !props.clinicId) return allCompleted.value
  return allCompleted.value.filter((a) => {
    if (props.practitionerId && a.practitioner_id !== props.practitionerId) return false
    if (props.clinicId && a.clinic_id !== props.clinicId) return false
    return true
  })
})

const rangeStart = computed(() => rangeBounds(props.dateRange).from)
const rangeEnd = computed(() => rangeBounds(props.dateRange).to)
const inRange = computed(() => filteredCompleted.value.filter((a) => new Date(a.starts_at) >= rangeStart.value && new Date(a.starts_at) <= rangeEnd.value))

const appointmentById = computed(() => new Map(allCompleted.value.map((a) => [a.id, a])))
const invoiceById = computed(() => new Map(invoices.value.map((i) => [i.id, i])))
const filteredPayments = computed(() => {
  if (!props.practitionerId && !props.clinicId) return payments.value
  return payments.value.filter((p) => {
    const appt = appointmentById.value.get((p.invoice_id ? invoiceById.value.get(p.invoice_id) : undefined)?.appointment_id ?? '')
    if (!appt) return false
    if (props.practitionerId && appt.practitioner_id !== props.practitionerId) return false
    if (props.clinicId && appt.clinic_id !== props.clinicId) return false
    return true
  })
})

// Euros taken per completed visit. Not PVA: PVA is visits per new patient
// (Statistics), and this used to be called that too.
const incomePerVisit = computed(() => {
  const totalCents = filteredPayments.value.reduce((sum, p) => sum + p.amount_cents, 0)
  if (inRange.value.length === 0) return null
  return totalCents / 100 / inRange.value.length
})

const retentionRate = computed(() => {
  const beforeRange = new Set(filteredCompleted.value.filter((a) => new Date(a.starts_at) < rangeStart.value).map((a) => a.patient_id))
  const patientsInRange = new Set(inRange.value.map((a) => a.patient_id))
  if (patientsInRange.size === 0) return null
  const returning = [...patientsInRange].filter((id) => beforeRange.has(id)).length
  return Math.round((returning / patientsInRange.size) * 100)
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
      <span class="font-mono text-[12.5px] text-ink-900">{{ inRange.length }}</span>
    </li>
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('Average income per visit', 'Ingreso medio por visita') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ incomePerVisit !== null ? formatEurFromAmount(incomePerVisit) : '—' }}</span>
    </li>
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('Retention', 'Retención') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ retentionRate !== null ? `${retentionRate}%` : '—' }}</span>
    </li>
  </ul>
</template>
