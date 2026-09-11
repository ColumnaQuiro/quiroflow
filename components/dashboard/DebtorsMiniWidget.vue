<script setup lang="ts">
defineProps<{ dateRange?: unknown; practitionerId?: string; clinicId?: string }>()

interface PurchaseRow {
  id: string
  price_cents: number
  invoice_id: string | null
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
const paidByInvoice = ref<Map<string, number>>(new Map())

onMounted(async () => {
  const { data: p } = await supabase.from('package_purchases').select('id, price_cents, invoice_id, patients(first_name, last_name)')
  purchases.value = (p as unknown as PurchaseRow[]) ?? []
  const invoiceIds = purchases.value.map((x) => x.invoice_id).filter((x): x is string => !!x)

  const [{ data: invoices }, { data: schedules }, { data: payments }] = await Promise.all([
    invoiceIds.length > 0 ? supabase.from('invoices').select('id, status, total_cents').in('id', invoiceIds) : Promise.resolve({ data: [] as InvoiceRow[] }),
    supabase.from('payment_schedules').select('package_purchase_id, status').not('package_purchase_id', 'is', null),
    invoiceIds.length > 0
      ? supabase.from('payments').select('invoice_id, amount_cents').in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [] as { invoice_id: string; amount_cents: number }[] }),
  ])
  invoicesById.value = new Map((invoices ?? []).map((i) => [i.id, i as InvoiceRow]))
  schedulesByPurchase.value = new Map((schedules ?? []).map((s) => [s.package_purchase_id as string, s as ScheduleRow]))
  const byInvoice = new Map<string, number>()
  for (const row of payments ?? []) byInvoice.set(row.invoice_id, (byInvoice.get(row.invoice_id) ?? 0) + row.amount_cents)
  paidByInvoice.value = byInvoice
  loading.value = false
})

// What is actually still owed on the bono's invoice. Mirrors the debtors
// report -- see the reasoning there for why having no invoice is not a debt,
// and why this is the invoice's remaining balance rather than the bono price.
function owedCentsFor(p: PurchaseRow): number {
  const inv = p.invoice_id ? invoicesById.value.get(p.invoice_id) : null
  if (!inv || inv.status === 'paid' || inv.status === 'void') return 0
  return Math.max(0, inv.total_cents - (paidByInvoice.value.get(inv.id) ?? 0))
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
  return `€${(cents / 100).toFixed(2)}`
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
