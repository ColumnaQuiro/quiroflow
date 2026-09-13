<script setup lang="ts">
interface PurchaseRow {
  id: string
  patient_id: string
  package_name: string
  sessions_total: number
  sessions_used: number
  price_cents: number
  purchased_at: string
  invoice_id: string | null
}
interface InvoiceRow { id: string; status: string; total_cents: number }
interface PatientRow { id: string; first_name: string; last_name: string }
interface ScheduleRow { package_purchase_id: string | null; status: string }

const supabase = useSupabaseClient()
const t = useT()
const loading = ref(true)
const purchases = ref<PurchaseRow[]>([])
const invoicesById = ref<Map<string, InvoiceRow>>(new Map())
const patientsById = ref<Map<string, PatientRow>>(new Map())
const schedulesByPurchase = ref<Map<string, ScheduleRow>>(new Map())
const paidByInvoice = ref<Map<string, number>>(new Map())

onMounted(async () => {
  const { data: p } = await supabase
    .from('package_purchases')
    .select('id, patient_id, package_name, sessions_total, sessions_used, price_cents, purchased_at, invoice_id')
    .order('purchased_at', { ascending: false })
  purchases.value = p ?? []

  const invoiceIds = purchases.value.map((x) => x.invoice_id).filter((x): x is string => !!x)
  const patientIds = [...new Set(purchases.value.map((x) => x.patient_id))]

  const [{ data: invoices }, { data: patients }, { data: schedules }, { data: payments }] = await Promise.all([
    invoiceIds.length > 0
      ? supabase.from('invoices').select('id, status, total_cents').in('id', invoiceIds)
      : Promise.resolve({ data: [] as InvoiceRow[] }),
    patientIds.length > 0
      ? supabase.from('patients').select('id, first_name, last_name').in('id', patientIds)
      : Promise.resolve({ data: [] as PatientRow[] }),
    supabase.from('payment_schedules').select('package_purchase_id, status').not('package_purchase_id', 'is', null),
    invoiceIds.length > 0
      ? supabase.from('payments').select('invoice_id, amount_cents').in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [] as { invoice_id: string | null; amount_cents: number }[] }),
  ])
  invoicesById.value = new Map((invoices ?? []).map((i) => [i.id, i as InvoiceRow]))
  patientsById.value = new Map((patients ?? []).map((p2) => [p2.id, p2 as PatientRow]))
  schedulesByPurchase.value = new Map((schedules ?? []).map((s) => [s.package_purchase_id as string, s as ScheduleRow]))
  const byInvoice = new Map<string, number>()
  for (const row of payments ?? []) if (row.invoice_id) byInvoice.set(row.invoice_id, (byInvoice.get(row.invoice_id) ?? 0) + row.amount_cents)
  paidByInvoice.value = byInvoice

  loading.value = false
})

// A debt needs an invoice that is actually unpaid. An active/completed Stripe
// schedule means it is being (or was) collected automatically; a past_due one
// means a scheduled charge failed, which IS a debt.
//
// No invoice is NOT a debt. It used to be -- `!inv` counted the bono's whole
// price as owed -- and on the live account that was 427 migrated bonos and
// 210,147 EUR of money nobody owed. Those were paid in PracticeHub, whose
// payments came across as their own PH-{id} invoices and were never linked
// back to the bono, so the bono simply has no billing record here. "We have no
// invoice" and "they have not paid" are different things. Where a migrated
// bono genuinely does owe something, the bonos importer raises an invoice for
// it, which is what puts it back on this list.
//
// A voided invoice is a cancelled charge, so nothing is owed on it either.
function owedCentsFor(p: PurchaseRow): number {
  const inv = p.invoice_id ? invoicesById.value.get(p.invoice_id) : null
  if (!inv || inv.status === 'paid' || inv.status === 'void') return 0
  return Math.max(0, inv.total_cents - (paidByInvoice.value.get(inv.id) ?? 0))
}

const debtors = computed(() =>
  purchases.value.filter((p) => {
    const schedule = schedulesByPurchase.value.get(p.id)
    if (schedule) return schedule.status === 'past_due' && owedCentsFor(p) > 0
    return owedCentsFor(p) > 0
  }),
)

// What is left on the invoice, not the bono's price. The importer bills only
// the outstanding part of a part-paid bono, so the price overstates the debt --
// 44,318 EUR of bono prices against 22,854 EUR actually outstanding.
const totalOwed = computed(() => debtors.value.reduce((sum, p) => sum + owedCentsFor(p), 0))

function patientName(id: string) {
  const p = patientsById.value.get(id)
  return p ? `${p.first_name} ${p.last_name}` : '—'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Debtors', 'Deudores')" :meta="t('Package/bono purchases with no paid receipt', 'Compras de bonos/paquetes sin recibo pagado')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <p class="text-[13px] text-ink-muted2">{{ t('Includes any Stripe autopay charge that failed.', 'Incluye cualquier cobro automático de Stripe que haya fallado.') }}</p>

      <div v-if="loading">
        <div class="mt-4 space-y-1.5 rounded-card border border-line bg-surface p-4 shadow-card">
          <UiSkeleton class="h-[23px] w-24 rounded-ctlSm" />
          <UiSkeleton class="h-3 w-48 rounded-ctlSm" />
        </div>
        <div class="mt-4 space-y-3 overflow-hidden rounded-card border border-line bg-surface p-4 shadow-card">
          <UiSkeleton v-for="i in 4" :key="i" class="h-3.5 w-full rounded-ctlSm" />
        </div>
      </div>
      <template v-else>
        <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
          <p class="font-mono text-[23px] font-semibold text-ink-900">€{{ (totalOwed / 100).toFixed(2) }}</p>
          <p class="text-[12px] text-ink-muted2">{{ t(`Total outstanding across ${debtors.length} purchase(s)`, `Total pendiente en ${debtors.length} compra(s)`) }}</p>
        </div>

        <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <table class="w-full text-[13px]">
            <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
              <tr>
                <th class="px-4 py-2">{{ t('Patient', 'Paciente') }}</th>
                <th class="px-4 py-2">{{ t('Package', 'Paquete') }}</th>
                <th class="px-4 py-2">{{ t('Purchased', 'Comprado') }}</th>
                <th class="px-4 py-2">{{ t('Amount owed', 'Importe adeudado') }}</th>
                <th class="px-4 py-2">{{ t('Status', 'Estado') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-row">
              <tr v-if="debtors.length === 0">
                <td colspan="5" class="px-4 py-6 text-center text-ink-faint2">{{ t("No debtors — everyone's paid up.", 'Sin deudores: todo el mundo ha pagado.') }}</td>
              </tr>
              <tr v-for="p in debtors" :key="p.id">
                <td class="px-4 py-2.5 text-ink-900">
                  <NuxtLink :to="`/patients/${p.patient_id}`" class="hover:text-brand-text">{{ patientName(p.patient_id) }}</NuxtLink>
                </td>
                <td class="px-4 py-2.5 text-ink-muted2">{{ p.package_name }}</td>
                <td class="px-4 py-2.5 text-ink-muted2">{{ new Date(p.purchased_at).toLocaleDateString() }}</td>
                <td class="px-4 py-2.5 font-mono text-ink-900">€{{ (owedCentsFor(p) / 100).toFixed(2) }}</td>
                <td class="px-4 py-2.5">
                  <span v-if="schedulesByPurchase.get(p.id)" class="rounded-pill bg-danger-bg px-1.5 py-0.5 text-[11px] font-medium text-danger-text">{{ t('stripe charge failed', 'cobro de stripe fallido') }}</span>
                  <span v-else class="rounded-pill px-1.5 py-0.5 text-[11px] font-medium" :class="p.invoice_id ? 'bg-danger-bg text-danger-text' : 'bg-chip-bg text-chip-text'">
                    {{ p.invoice_id ? (invoicesById.get(p.invoice_id)?.status ?? t('unknown', 'desconocido')) : t('no receipt', 'sin recibo') }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>
