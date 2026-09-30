<script setup lang="ts">
import { useBonoDebts } from '~/composables/useBonoOwedPayments'
import { formatEur } from '~/utils/billing'
import { bonoOwedCents, type BonoOwedPayment } from '~/utils/bonoOwed'
interface PurchaseRow {
  id: string
  patient_id: string
  package_name: string
  sessions_total: number
  sessions_used: number
  price_cents: number
  purchased_at: string
  invoice_id: string | null
  owed_cents: number | null
  external_reference: string | null
}
interface InvoiceRow { id: string; status: string; total_cents: number }
interface PatientRow { id: string; first_name: string; last_name: string }
interface ScheduleRow { package_purchase_id: string | null; status: string }

const loadBonoDebts = useBonoDebts()
const t = useT()
const loading = ref(true)
const purchases = ref<PurchaseRow[]>([])
const invoicesById = ref<Map<string, InvoiceRow>>(new Map())
const patientsById = ref<Map<string, PatientRow>>(new Map())
const schedulesByPurchase = ref<Map<string, ScheduleRow>>(new Map())
const allPayments = ref<BonoOwedPayment[]>([])

onMounted(async () => {
  const debts = await loadBonoDebts('newest')
  purchases.value = debts.purchases
  invoicesById.value = debts.invoicesById
  patientsById.value = new Map(debts.purchases.filter((p) => p.patients).map((p) => [p.patient_id, { id: p.patient_id, first_name: p.patients!.first_name, last_name: p.patients!.last_name as string }]))
  schedulesByPurchase.value = debts.schedulesByPurchase
  allPayments.value = debts.payments

  loading.value = false
})

// A debt needs an invoice that is actually unpaid, OR an outstanding figure on
// the bono itself. An active/completed Stripe schedule means it is being (or
// was) collected automatically; a past_due one means a scheduled charge
// failed, which IS a debt.
//
// This used to read the sale invoice and nothing else, which was right when a
// bono's debt was an invoice. It is not any more: a migrated bono never had
// one, and a bono sold here no longer raises one, so 518 of 522 bonos were
// invisible on this report while 21,930 EUR sat outstanding on them.
//
// utils/bonoOwed is the single answer, shared with the patient's Billing tab
// and the dashboard widget -- all three used to compute this differently.
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
  purchases.value.filter((p) => {
    const schedule = schedulesByPurchase.value.get(p.id)
    if (schedule) return schedule.status === 'past_due' && owedCentsFor(p) > 0
    return owedCentsFor(p) > 0
  }),
)

// What is actually outstanding, never the bono's price: a part-paid bono's
// price overstates the debt -- 44,318 EUR of prices against 22,854 EUR really
// owed.
const totalOwed = computed(() => debtors.value.reduce((sum, p) => sum + owedCentsFor(p), 0))

function patientName(id: string) {
  const p = patientsById.value.get(id)
  return p ? `${p.first_name} ${p.last_name}` : '—'
}

// What "Download PDF" reads: the sections below marked data-pdf-block,
// and the figure tiles (components/reports/Stat.vue).
const pdfRoot = ref<HTMLElement | null>(null)
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Debtors', 'Deudores')" :meta="t('Package/bono purchases with no paid receipt', 'Compras de bonos/paquetes sin recibo pagado')">
      <div class="flex items-center gap-3">
        <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
        <ReportsPdfButton :target="pdfRoot" :title="t('Debtors', 'Deudores')" />
      </div>
    </PageHeader>

    <div ref="pdfRoot" class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <p class="text-[13px] text-ink-muted2">{{ t('Includes any Stripe autopay charge that failed.', 'Incluye cualquier cobro automático de Stripe que haya fallado.') }}</p>

      <div class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card" :aria-busy="loading || undefined" data-pdf-kpi>
        <template v-if="loading">
          <div class="flex items-center font-mono text-[23px]" aria-hidden="true">&#8203;<UiSkeleton class="h-[23px] w-24 rounded-ctlSm" /></div>
          <p class="text-[12px] text-ink-muted2">{{ t('Total outstanding', 'Total pendiente') }}</p>
        </template>
        <template v-else>
          <p class="font-mono text-[23px] font-semibold text-ink-900" data-pdf-value>{{ formatEur(totalOwed) }}</p>
          <p class="text-[12px] text-ink-muted2" data-pdf-label>{{ t(`Total outstanding across ${debtors.length} purchase(s)`, `Total pendiente en ${debtors.length} compra(s)`) }}</p>
        </template>
      </div>

      <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card" data-pdf-block="table" :data-pdf-title="t('Package/bono purchases with no paid receipt', 'Compras de bonos/paquetes sin recibo pagado')">
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
            <ReportsTableSkeletonRows v-if="loading" :cols="5" />
            <tr v-else-if="debtors.length === 0">
              <td colspan="5" class="px-4 py-6 text-center text-ink-faint2">{{ t("No debtors — everyone's paid up.", 'Sin deudores: todo el mundo ha pagado.') }}</td>
            </tr>
            <tr v-for="p in loading ? [] : debtors" :key="p.id">
              <td class="px-4 py-2.5 text-ink-900">
                <NuxtLink :to="`/patients/${p.patient_id}`" class="hover:text-brand-text">{{ patientName(p.patient_id) }}</NuxtLink>
              </td>
              <td class="px-4 py-2.5 text-ink-muted2">{{ p.package_name }}</td>
              <td class="px-4 py-2.5 text-ink-muted2">{{ new Date(p.purchased_at).toLocaleDateString() }}</td>
              <td class="px-4 py-2.5 font-mono text-ink-900">{{ formatEur(owedCentsFor(p)) }}</td>
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
    </div>
  </div>
</template>
