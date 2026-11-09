<script setup lang="ts">
// Pendiente de terceros, on the phone: the web's pages/billing/third-parties/
// index.vue -- what each insurer, mutua and company owes the clinic, aged by
// the date of the visit (utils/thirdParties' agedOutstanding, the same pending
// charges and allocations), so the totals are the web's. Under the web's
// billing_access rule (ReportScreen's path is /billing/third-parties); the
// route here is /reports/third-parties, as the app has no Billing section.
// Reshaped for a phone: a card per third party with its four age bands
// inline, in place of the web's table and its link to each party's page
// (pages/billing/third-parties/[id], which the app does not have). From that
// page it also brings the payments each party has sent, shown under the
// card, read-only. Left out: recording or deleting a payment, statements and
// "Manage" (all on the web).
import { fetchAllRows } from '../../../composables/useFetchAllRows'
import { formatEur } from '../../../utils/billing'
import { AGE_BUCKETS, ageBucketLabel, agedOutstanding, allocatedCents, thirdPartyKindLabel, type AgedTotals } from '../../../utils/thirdParties'

definePageMeta({ layout: 'practitioner' })

// This is the insurers' debt, kept apart from patients': none of it is on a
// patient's invoices, so the Debtors report and every patient balance leave
// it out by construction.
interface ChargeRow {
  id: string
  third_party_id: string
  amount_cents: number
  status: string
  service_date: string
  allocations: { amount_cents: number }[]
}
interface PaymentRow {
  id: string
  third_party_id: string
  amount_cents: number
  received_on: string
  method: string
  reference: string | null
  allocations: { amount_cents: number }[]
}

const PATH = '/billing/third-parties'
const supabase = useSupabaseClient()
const t = useT()
const { canOpen, context } = useReportAccess()

const loading = ref(true)
const failed = ref(false)
const thirdParties = ref<{ id: string; name: string; kind: string; active: boolean }[]>([])
const charges = ref<ChargeRow[]>([])
const payments = ref<PaymentRow[]>([])

async function load() {
  loading.value = true
  failed.value = false
  try {
    const [{ data: tps, error }, rows, pays] = await Promise.all([
      supabase.from('third_parties').select('id, name, kind, active').order('name'),
      fetchAllRows<ChargeRow>(
        (from, to) =>
          supabase
            .from('third_party_charges')
            .select('id, third_party_id, amount_cents, status, service_date, allocations:third_party_payment_allocations(amount_cents)')
            .eq('status', 'pending')
            .order('id')
            .range(from, to) as unknown as PromiseLike<{ data: ChargeRow[] | null; error: unknown }>,
      ),
      // The payments received, as each party's own page lists them.
      fetchAllRows<PaymentRow>(
        (from, to) =>
          supabase
            .from('third_party_payments')
            .select('id, third_party_id, amount_cents, received_on, method, reference, allocations:third_party_payment_allocations(amount_cents)')
            .order('received_on', { ascending: false })
            .order('id')
            .range(from, to) as unknown as PromiseLike<{ data: PaymentRow[] | null; error: unknown }>,
      ),
    ])
    if (error) throw error
    thirdParties.value = tps ?? []
    charges.value = rows
    payments.value = pays
  } catch {
    failed.value = true
  }
  loading.value = false
}
// Only once the role is known to include it: a refused read would come back
// empty and read as "nobody owes anything".
watch(() => !!context.value && canOpen(PATH), (ok) => { if (ok) load() }, { immediate: true })

const today = new Date().toISOString().slice(0, 10)

const paymentsByParty = computed(() => {
  const out = new Map<string, PaymentRow[]>()
  for (const p of payments.value) {
    const list = out.get(p.third_party_id)
    if (list) list.push(p)
    else out.set(p.third_party_id, [p])
  }
  return out
})
const rows = computed(() =>
  thirdParties.value
    .map((tp) => ({ ...tp, aged: agedOutstanding(charges.value.filter((c) => c.third_party_id === tp.id), today), payments: paymentsByParty.value.get(tp.id) ?? [] }))
    .filter((r) => r.active || r.aged.total > 0)
    .sort((a, b) => b.aged.total - a.aged.total || a.name.localeCompare(b.name)),
)
const totals = computed<AgedTotals>(() => agedOutstanding(charges.value, today))

// Which party's payments are open, and how many of them are shown.
const open = ref<string | null>(null)
const PAYMENTS_PAGE = 10
const shownPayments = ref(PAYMENTS_PAGE)
function toggle(id: string) {
  open.value = open.value === id ? null : id
  shownPayments.value = PAYMENTS_PAGE
}

const locale = computed(() => t('en-GB', 'es-ES'))
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(locale.value, { day: 'numeric', month: 'short', year: 'numeric' })
const methodLabel = (m: string) =>
  ({ transfer: t('Transfer', 'Transferencia'), card: t('Card', 'Tarjeta'), cash: t('Cash', 'Efectivo'), cheque: t('Cheque', 'Cheque'), other: t('Other', 'Otro') })[m] ?? m
</script>

<template>
  <ReportScreen :title="t('Third parties owed', 'Pendiente de terceros')" path="/billing/third-parties" :description="t('What insurers, mutuas and companies owe, aged by the date of the visit.', 'Lo que deben aseguradoras, mutuas y empresas, por antigüedad desde la visita.')">
    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>

    <ReportsStat :label="t('Owed by third parties, not by patients', 'Pendiente de terceros, no de pacientes')" :loading="loading">
      <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-third-parties-total">{{ formatEur(totals.total) }}</p>
    </ReportsStat>

    <ReportsModule :title="t('By third party', 'Por tercero')" :loading="loading" skeleton="list" :rows="4">
      <p v-if="rows.length === 0" class="py-4 text-center text-[13.5px] text-ink-faint">
        {{ t('No third parties yet. Add them on the web, under Settings → Third parties.', 'Aún no hay terceros. Añádelos en la web, en Ajustes → Terceros.') }}
      </p>
      <ul v-else class="mt-1" data-cy="report-third-parties-list">
        <li v-for="r in rows" :key="r.id" class="border-b border-line-divider py-2.5 last:border-b-0" data-cy="report-third-parties-row">
          <div class="flex items-center gap-3">
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate text-[14.5px] font-medium text-ink-900">{{ r.name }}</span>
              <span class="text-[12.5px] text-ink-muted">{{ thirdPartyKindLabel(r.kind, t) }}</span>
            </span>
            <span class="shrink-0 font-mono text-[14.5px] font-semibold tabular-nums text-ink-900" data-cy="report-third-parties-row-total">{{ formatEur(r.aged.total) }}</span>
          </div>
          <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-ctl bg-surface-subtle px-3 py-2 md:grid-cols-4">
            <div v-for="b in AGE_BUCKETS" :key="b" class="flex items-baseline justify-between gap-2">
              <dt class="text-[11.5px] text-ink-muted">{{ ageBucketLabel(b, t) }}</dt>
              <dd class="font-mono text-[12.5px] tabular-nums" :class="r.aged[b] ? (b === 'over_90' ? 'text-danger-text' : 'text-ink-900') : 'text-ink-faint2'">{{ formatEur(r.aged[b]) }}</dd>
            </div>
          </dl>
          <button
            type="button"
            class="mt-1 flex min-h-[44px] w-full items-center justify-between text-[13px] font-semibold text-brand-text"
            :aria-expanded="open === r.id"
            data-cy="report-third-parties-payments-toggle"
            @click="toggle(r.id)"
          >
            {{ t(`Payments received (${r.payments.length})`, `Cobros recibidos (${r.payments.length})`) }}
            <AppChevron :dir="open === r.id ? 'down' : 'right'" :size="16" />
          </button>
          <template v-if="open === r.id">
            <p v-if="r.payments.length === 0" class="pb-1 text-[12.5px] text-ink-faint">{{ t('No payments yet.', 'Aún no hay cobros.') }}</p>
            <ul v-else class="rounded-ctl border border-line" data-cy="report-third-parties-payments">
              <ReportRow
                v-for="p in r.payments.slice(0, shownPayments)"
                :key="p.id"
                class="px-3"
                :title="fmtDate(p.received_on)"
                :subtitle="[methodLabel(p.method), p.reference].filter(Boolean).join(' · ')"
                :value="formatEur(p.amount_cents)"
                :value-note="t(`${formatEur(allocatedCents(p))} applied to visits`, `${formatEur(allocatedCents(p))} aplicado a visitas`)"
              />
            </ul>
            <AppButton v-if="r.payments.length > shownPayments" class="mt-2 w-full" @click="shownPayments += PAYMENTS_PAGE">
              {{ t(`Show more (${r.payments.length - shownPayments})`, `Ver más (${r.payments.length - shownPayments})`) }}
            </AppButton>
          </template>
        </li>
      </ul>
    </ReportsModule>
  </ReportScreen>
</template>
