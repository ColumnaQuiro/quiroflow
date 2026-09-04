<script setup lang="ts">
import type { DateRange } from '~/composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface ApptRow { id: string; patient_id: string; starts_at: string; practitioner_id: string | null; clinic_id: string | null }
interface PaymentRow { amount_cents: number; invoice_id: string }
interface InvoiceRow { id: string; appointment_id: string | null }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const allCompleted = ref<ApptRow[]>([])
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(props.dateRange)
  // Invoices are only read to walk payment -> invoice -> appointment when a
  // practitioner/clinic filter is set (filteredPayments short-circuits
  // without one), so an unfiltered dashboard was paging the whole invoices
  // table for nothing. The completed-appointments fetch below genuinely is
  // all-time: retention compares against visits from before the range.
  const needsInvoices = !!props.practitionerId || !!props.clinicId

  const [completed, p, inv] = await Promise.all([
    fetchAllRows<ApptRow>((f, t) =>
      supabase.from('appointments').select('id, patient_id, starts_at, practitioner_id, clinic_id').eq('status', 'completed').range(f, t),
    ),
    fetchAllRows<PaymentRow>((f, t) =>
      supabase.from('payments').select('amount_cents, invoice_id').gte('paid_at', from.toISOString()).lte('paid_at', to.toISOString()).range(f, t),
    ),
    needsInvoices
      ? fetchAllRows<InvoiceRow>((f, t) => supabase.from('invoices').select('id, appointment_id').range(f, t))
      : Promise.resolve([] as InvoiceRow[]),
  ])
  allCompleted.value = completed
  payments.value = p
  invoices.value = inv
  loading.value = false
}
onMounted(load)
watch(() => [props.dateRange, props.practitionerId, props.clinicId], load, { deep: true })

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
    const appt = appointmentById.value.get(invoiceById.value.get(p.invoice_id)?.appointment_id ?? '')
    if (!appt) return false
    if (props.practitionerId && appt.practitioner_id !== props.practitionerId) return false
    if (props.clinicId && appt.clinic_id !== props.clinicId) return false
    return true
  })
})

const pva = computed(() => {
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
      <span class="text-ink-700">{{ t('Per-visit average', 'Media por visita') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ pva !== null ? `€${pva.toFixed(2)}` : '—' }}</span>
    </li>
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('Retention', 'Retención') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ retentionRate !== null ? `${retentionRate}%` : '—' }}</span>
    </li>
  </ul>
</template>
