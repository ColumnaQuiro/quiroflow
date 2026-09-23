<script setup lang="ts">
import { fetchByIds } from '~/composables/useFetchAllRows'
import { formatEur } from '~/utils/billing'
import { bonoOwedCents, type BonoOwedPayment } from '~/utils/bonoOwed'
defineProps<{ dateRange?: unknown; practitionerId?: string; clinicId?: string }>()

interface PurchaseRow {
  id: string
  price_cents: number
  invoice_id: string | null
  owed_cents: number | null
  external_reference: string | null
  patients: { first_name: string; last_name: string | null } | null
}
interface InvoiceRow { id: string; status: string; total_cents: number }
interface ScheduleRow { package_purchase_id: string | null; status: string }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const purchases = ref<PurchaseRow[]>([])
const invoicesById = ref<Map<string, InvoiceRow>>(new Map())
const schedulesByPurchase = ref<Map<string, ScheduleRow>>(new Map())
const allPayments = ref<BonoOwedPayment[]>([])

onMounted(async () => {
  const { data: p } = await supabase.from('package_purchases').select('id, price_cents, invoice_id, owed_cents, external_reference, patients(first_name, last_name)')
  purchases.value = (p as unknown as PurchaseRow[]) ?? []
  const invoiceIds = purchases.value.map((x) => x.invoice_id).filter((x): x is string => !!x)

  const [invoices, { data: schedules }, { data: payments }] = await Promise.all([
    fetchByIds<InvoiceRow>(invoiceIds, (chunk) => supabase.from('invoices').select('id, status, total_cents').in('id', chunk)),
    supabase.from('payment_schedules').select('package_purchase_id, status').not('package_purchase_id', 'is', null),
    // All of them: a bono sold here has no invoice now, and a migrated one
    // never had -- its payments hang off the purchase.
    supabase.from('payments').select('invoice_id, amount_cents, package_purchase_id, external_reference, purpose'),
  ])
  invoicesById.value = new Map(invoices.map((i) => [i.id, i]))
  schedulesByPurchase.value = new Map((schedules ?? []).map((s) => [s.package_purchase_id as string, s as ScheduleRow]))
  allPayments.value = (payments ?? []) as BonoOwedPayment[]
  loading.value = false
})

// Same answer as the Debtors report and the patient's Billing tab, because
// it is literally the same function now -- see utils/bonoOwed for why a bono
// sold here and a bono migrated from PracticeHub record their debt
// differently, and why all three used to disagree.
function owedCentsFor(p: PurchaseRow): number {
  const inv = p.invoice_id ? invoicesById.value.get(p.invoice_id) : null
  return bonoOwedCents({
    purchaseId: p.id,
    invoiceId: p.invoice_id,
    priceCents: p.price_cents,
    owedCents: p.owed_cents,
    invoice: inv ? { status: inv.status, total_cents: inv.total_cents } : null,
    payments: allPayments.value,
  })
}

const debtors = computed(() =>
  purchases.value
    .filter((p) => {
      const schedule = schedulesByPurchase.value.get(p.id)
      if (schedule) return schedule.status === 'past_due' && owedCentsFor(p) > 0
      return owedCentsFor(p) > 0
    })
    .sort((a, b) => owedCentsFor(b) - owedCentsFor(a)),
)
const totalOwed = computed(() => debtors.value.reduce((sum, p) => sum + owedCentsFor(p), 0))

function patientName(p: PurchaseRow) {
  return p.patients ? `${p.patients.first_name} ${p.patients.last_name ?? ''}`.trim() : t('Unknown patient', 'Paciente desconocido')
}
function euros(cents: number) {
  return `${formatEur(cents)}`
}
</script>

<template>
  <div v-if="loading" class="space-y-2">
    <div v-for="i in 3" :key="i" class="flex items-center gap-2 py-1.5">
      <UiSkeleton class="h-3 w-32 rounded-ctlSm" />
      <UiSkeleton class="ml-auto h-3 w-12 rounded-ctlSm" />
    </div>
  </div>
  <div v-else>
    <p v-if="debtors.length === 0" class="text-[13px] text-ink-faint">{{ t('No outstanding balances.', 'No hay saldos pendientes.') }}</p>
    <template v-else>
      <ul class="divide-y divide-line-row2">
        <li v-for="p in debtors.slice(0, 5)" :key="p.id" class="flex items-center gap-2 py-1.5 text-[13px] first:pt-0">
          <span class="min-w-0 flex-1 truncate text-ink-700">{{ patientName(p) }}</span>
          <span class="shrink-0 font-mono text-[12.5px] text-danger-text">{{ euros(owedCentsFor(p)) }}</span>
        </li>
      </ul>
      <p class="mt-1.5 border-t border-line-row2 pt-1.5 text-[11.5px] text-ink-muted2">{{ t(`${debtors.length} outstanding · ${euros(totalOwed)} total`, `${debtors.length} pendientes · ${euros(totalOwed)} en total`) }}</p>
    </template>
  </div>
</template>
