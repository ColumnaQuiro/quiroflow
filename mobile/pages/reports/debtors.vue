<script setup lang="ts">
// Deudores, on the phone: the web's pages/reports/debtors.vue, from the same
// source (useBonoDebts + utils/bonoOwed), so the total here is the total
// there. A row per bono with money owed on it now, each opening the patient.
import { useBonoDebts } from '../../../composables/useBonoOwedPayments'
import { formatEur } from '../../../utils/billing'
import { bonoDueNowCents, type BonoOwedPayment } from '../../../utils/bonoOwed'
import { installmentPlanOf } from '../../../utils/bonoInstallments'

definePageMeta({ layout: 'practitioner' })

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
  installments: number | null
  installment_cents: number | null
  external_reference: string | null
}
interface InvoiceRow { id: string; status: string; total_cents: number }
interface ScheduleRow { package_purchase_id: string | null; status: string }

const t = useT()
const { canOpen, context } = useReportAccess()
const { shown } = usePrivacyMode()
const loadBonoDebts = useBonoDebts()
const loading = ref(true)
const failed = ref(false)
const purchases = ref<PurchaseRow[]>([])
const invoicesById = ref<Map<string, InvoiceRow>>(new Map())
const names = ref<Map<string, string>>(new Map())
const schedulesByPurchase = ref<Map<string, ScheduleRow>>(new Map())
const allPayments = ref<BonoOwedPayment[]>([])

async function load() {
  loading.value = true
  failed.value = false
  try {
    const debts = await loadBonoDebts('newest')
    purchases.value = debts.purchases
    invoicesById.value = debts.invoicesById
    names.value = new Map(debts.purchases.filter((p) => p.patients).map((p) => [p.patient_id, `${p.patients!.first_name} ${p.patients!.last_name ?? ''}`.trim()]))
    schedulesByPurchase.value = debts.schedulesByPurchase
    allPayments.value = debts.payments
  } catch {
    failed.value = true
  }
  loading.value = false
}
// Only once the role is known to include it: a refused read would come back
// empty and read as "nobody owes anything".
watch(() => !!context.value && canOpen('/reports/debtors'), (ok) => { if (ok) load() }, { immediate: true })

function owedCentsFor(p: PurchaseRow): number {
  const inv = p.invoice_id ? invoicesById.value.get(p.invoice_id) : null
  return bonoDueNowCents({
    purchaseId: p.id,
    invoiceId: p.invoice_id,
    priceCents: p.price_cents,
    owedCents: p.owed_cents,
    invoice: inv ? { status: inv.status, total_cents: inv.total_cents } : null,
    payments: allPayments.value,
    plan: installmentPlanOf(p),
  })
}
// The web's rule: a Stripe schedule that is collecting is not a debt; a
// past_due one (a failed charge) is.
const debtors = computed(() =>
  purchases.value
    .filter((p) => {
      const schedule = schedulesByPurchase.value.get(p.id)
      if (schedule) return schedule.status === 'past_due' && owedCentsFor(p) > 0
      return owedCentsFor(p) > 0
    })
    .map((p) => ({ ...p, owed: owedCentsFor(p) })),
)
const totalOwed = computed(() => debtors.value.reduce((sum, p) => sum + p.owed, 0))

const locale = computed(() => t('en-GB', 'es-ES'))
function status(p: PurchaseRow) {
  if (schedulesByPurchase.value.get(p.id)) return t('Stripe charge failed', 'Cobro de Stripe fallido')
  return p.invoice_id ? (invoicesById.value.get(p.invoice_id)?.status ?? t('unknown', 'desconocido')) : t('no receipt', 'sin recibo')
}
</script>

<template>
  <ReportScreen :title="t('Debtors', 'Deudores')" path="/reports/debtors" :description="t('Bonos with money owed on them now. Includes any Stripe autopay charge that failed.', 'Bonos con dinero pendiente ahora. Incluye cualquier cobro automático de Stripe que haya fallado.')">
    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>
    <ReportsStat :label="t('Total outstanding', 'Total pendiente')" :loading="loading">
      <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="debtors-total">{{ formatEur(totalOwed) }}</p>
      <p class="text-[12px] text-ink-muted">{{ t(`Across ${debtors.length} purchase(s)`, `En ${debtors.length} compra(s)`) }}</p>
    </ReportsStat>

    <ReportsModule :title="t('Who owes', 'Quién debe')" :loading="loading" skeleton="list" :rows="6">
      <p v-if="debtors.length === 0" class="py-4 text-center text-[13.5px] text-ink-faint">{{ t("No debtors — everyone's paid up.", 'Sin deudores: todo el mundo ha pagado.') }}</p>
      <ul v-else class="mt-1" data-cy="debtors-list">
        <ReportRow
          v-for="p in debtors"
          :key="p.id"
          :to="`/patients/${p.patient_id}`"
          :title="shown(names.get(p.patient_id) ?? '—')"
          :subtitle="`${p.package_name} · ${new Date(p.purchased_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`"
          :value="formatEur(p.owed)"
          :value-note="status(p)"
          tone="danger"
        />
      </ul>
    </ReportsModule>
  </ReportScreen>
</template>
