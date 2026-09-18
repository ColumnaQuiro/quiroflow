<script setup lang="ts">
// PracticeHub-style unified ledger: invoices (debit) and payments/credits
// (credit) merged into one chronological table, replacing the old separate
// "Invoices" table + "creditHistory" list. See the plan notes on why a
// payment row's own "Balance" is always "—" rather than a PH-style
// per-event remaining amount: a payment taken at the desk is allocated to the
// charge it settles as it is entered, so it has no remaining amount to show.
// Since 0170 invoice_id can be null -- money on account, which is how
// PracticeHub records most of a bono patient's payments -- and such a row
// simply matches no invoice here.
import { normalizeSearchTerm } from '~/utils/searchText'

interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  total_cents: number
  created_at: string
  is_refund: boolean
  refunds_invoice_id: string | null
}
interface PaymentRow { id: string; invoice_id: string | null; amount_cents: number; method: string; paid_at: string; created_by?: string | null; stripe_payment_intent_id?: string | null; team_members?: { full_name: string | null } | null }
// A visit drawn from a package. Carries no debit or credit -- the money was
// already accounted for when the package was bought -- so it appears in the
// ledger purely so a visit is not silently absent from a patient's history.
interface PackageSessionRow { id: string; amount_cents: number; used_at: string; package_name: string | null }
interface CreditRow { id: string; amount_cents: number; reason: string | null; method: string | null; invoice_id: string | null; created_at: string }

const props = defineProps<{
  patientId: string
  invoices: InvoiceRow[]
  lineItemDescriptions: Record<string, string[]>
  payments: PaymentRow[]
  credits: CreditRow[]
  packageSessions: PackageSessionRow[]
  spendableCreditCents: number
  sendingInvoiceId: string
  sendResultInvoiceId: string
  sendResultMessage: string
  canDeleteInvoices: boolean
  // Removing a payment writes to `payments`, whose RLS requires
  // payments_allocate -- gating this on the invoice permission alone would
  // show the button to someone the database then refuses.
  canDeletePayments: boolean
  canWriteOff: boolean
  canRefund: boolean
}>()
const emit = defineEmits<{
  addCredit: []
  takePayment: []
  sendInvoice: [invoiceId: string]
  deleteInvoice: [invoiceId: string]
  deletePayment: [payload: { paymentId: string; invoiceId: string | null; amountCents: number }]
  writeOffInvoice: [invoiceId: string]
  refundInvoice: [payload: { invoiceId: string; amountCents: number; reason: string; method: string }]
  creditsChanged: []
}>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const expandedKey = ref<string | null>(null)
const menuOpen = ref(false)

function money(cents: number) {
  const amount = (Math.abs(cents) / 100).toFixed(2)
  return `${cents < 0 ? '-' : ''}€${amount}`
}
function invoiceRefFor(id: string | null) {
  if (!id) return null
  return props.invoices.find((i) => i.id === id)?.invoice_number ?? '(deleted invoice)'
}

/**
 * Who recorded a payment, distinguishing the three things a missing author
 * can mean.
 *
 * A name is a person at the desk. No author but a Stripe payment intent is
 * money that arrived on its own -- autopay on a bono, a membership renewal --
 * which is a real answer, not a gap, and the reason created_by is nullable at
 * all. No author and no Stripe reference is a row written before created_by
 * existed: nothing recorded it at the time and nothing can recover it now, so
 * it says so rather than implying the payment was automatic.
 */
function recordedBy(p: PaymentRow): string {
  const name = p.team_members?.full_name
  if (name) return name
  if (p.stripe_payment_intent_id) return t('Automatic (card on file)', 'Automático (tarjeta guardada)')
  return t('Not recorded', 'Sin registrar')
}

interface LedgerRow {
  key: string
  ref: string
  date: string
  description: string
  debitCents: number
  creditCents: number
  balanceText: string
  balanceTone: 'success' | 'danger' | 'neutral'
  voided: boolean
  invoiceId?: string
  paymentId?: string
  paymentAmountCents?: number
  paymentInvoiceId?: string | null
  invoiceOpenCents?: number
  refundableCents?: number
  isRefund?: boolean
  detail: { label: string; value: string }[]
}

const rows = computed<LedgerRow[]>(() => {
  const invoiceRows: LedgerRow[] = props.invoices.map((inv) => {
    const paidForInvoice = props.payments.filter((p) => p.invoice_id === inv.id).reduce((sum, p) => sum + p.amount_cents, 0)
    // A receipt marked paid is settled even with no payment rows behind it:
    // that is what a visit covered by a prepaid bono looks like, and what
    // settle_imported_invoices() left across the migrated history. Subtracting
    // payments alone showed the full amount outstanding, in red, on visits the
    // patient had already paid for.
    const openCents = inv.status === 'paid' ? 0 : inv.total_cents - paidForInvoice
    const items = props.lineItemDescriptions[inv.id] ?? []

    // A refund invoice reads as a credit against the original, not a
    // charge -- same "Ref" lookup already used for a payment's "Applied
    // to" detail line, reused here for the description itself.
    if (inv.is_refund) {
      const refundedCents = Math.abs(inv.total_cents)
      return {
        key: `invoice-${inv.id}`,
        ref: inv.invoice_number,
        date: inv.created_at,
        description: `${t('Refund', 'Reembolso')} — ${invoiceRefFor(inv.refunds_invoice_id) ?? t('deleted receipt', 'recibo eliminado')}`,
        debitCents: 0,
        creditCents: refundedCents,
        balanceText: '—',
        balanceTone: 'neutral' as const,
        voided: false,
        invoiceId: inv.id,
        isRefund: true,
        detail: items.length > 0 ? items.map((d) => ({ label: t('Item', 'Artículo'), value: d })) : [{ label: t('Items', 'Artículos'), value: '—' }],
      }
    }

    // How much of what's actually been paid on this invoice hasn't already
    // been refunded -- caps both whether the Refund action shows at all and
    // the amount pre-filled into the modal, so staff can't refund money
    // that was never collected or double-refund the same invoice.
    const alreadyRefunded = props.invoices
      .filter((r) => r.is_refund && r.refunds_invoice_id === inv.id)
      .reduce((sum, r) => sum + Math.abs(r.total_cents), 0)
    const refundableCents = inv.status === 'void' ? 0 : Math.max(0, paidForInvoice - alreadyRefunded)

    // A negative total_cents invoice that isn't flagged is_refund happens
    // for imported data (e.g. a PracticeHub refund record) rather than one
    // created through the app's own refund flow above -- same shape, just
    // missing the flag. Split by sign the same way, or it falls through as
    // a negative debitCents that the template hides (debitCents > 0 only).
    const isUnflaggedRefund = inv.total_cents < 0

    return {
      key: `invoice-${inv.id}`,
      ref: inv.invoice_number,
      date: inv.created_at,
      description: inv.status === 'void' ? t('Receipt (void)', 'Recibo (anulado)') : isUnflaggedRefund ? t('Receipt (refund)', 'Recibo (reembolso)') : t('Receipt', 'Recibo'),
      debitCents: inv.status === 'void' ? 0 : Math.max(inv.total_cents, 0),
      creditCents: inv.status === 'void' ? 0 : Math.max(-inv.total_cents, 0),
      balanceText: inv.status === 'void' ? '—' : money(openCents),
      balanceTone: inv.status === 'void' ? 'neutral' : openCents > 0 ? 'danger' : 'neutral',
      voided: inv.status === 'void',
      invoiceId: inv.id,
      invoiceOpenCents: inv.status === 'void' ? 0 : openCents,
      refundableCents,
      detail: items.length > 0 ? items.map((d) => ({ label: t('Item', 'Artículo'), value: d })) : [{ label: t('Items', 'Artículos'), value: '—' }],
    }
  })

  // Same rule as usePatientFinancialSummary: a 'credit' payment against a
  // voided invoice is not money. Its invoice contributes no debit (see
  // debitCents above), so leaving the payment in the Credit column shows a
  // credit line with nothing facing it and a running balance that disagrees
  // with the summary strip. Cash/card on a void invoice still shows -- that is
  // real money collected against a cancelled charge, and it should be visible.
  const countablePayments = props.payments.filter(
    (p) => !(p.method === 'credit' && props.invoices.find((i) => i.id === p.invoice_id)?.status === 'void'),
  )

  const paymentRows: LedgerRow[] = countablePayments.map((p) => ({
    key: `payment-${p.id}`,
    ref: '',
    paymentId: p.id,
    paymentAmountCents: p.amount_cents,
    // Deliberately NOT `invoiceId`: that field gates the invoice action block
    // below, and a payment row offering "Delete invoice" would delete the
    // wrong thing entirely.
    paymentInvoiceId: p.invoice_id,
    date: p.paid_at,
    // Negative only for the payments row createRefund() inserts alongside a
    // refund invoice, so this money goes back out belongs in Debit like any
    // other outgoing entry -- a plain Credit column can't show a negative
    // value at all (see the row.creditCents > 0 guard below), which is what
    // made this row render with no amount before this handled the sign.
    description: p.amount_cents < 0 ? `${t('Refund payment', 'Pago de reembolso')} — ${p.method}` : `${t('Payment', 'Pago')} — ${p.method}`,
    debitCents: p.amount_cents < 0 ? -p.amount_cents : 0,
    creditCents: p.amount_cents > 0 ? p.amount_cents : 0,
    balanceText: '—',
    balanceTone: 'neutral' as const,
    voided: false,
    detail: [
      { label: t('Method', 'Método'), value: p.method },
      { label: t('Applied to', 'Aplicado a'), value: invoiceRefFor(p.invoice_id) ?? '—' },
      // Shown for every payment, including the ones with no author, because
      // "Automatic" and "not recorded" are different answers and a row that
      // simply omits the line can't tell them apart. Rows written before
      // created_by existed are the honest third case: nothing recorded it.
      { label: t('Recorded by', 'Registrado por'), value: recordedBy(p) },
    ],
  }))

  const sessionRows: LedgerRow[] = props.packageSessions.map((ps) => ({
    key: `pkgsession-${ps.id}`,
    ref: '',
    date: ps.used_at,
    description: ps.package_name
      ? `${t('Visit from', 'Visita del bono')} ${ps.package_name}`
      : t('Visit from package', 'Visita de un bono'),
    // Zero on both sides on purpose: this is a record of consumption, not a
    // charge. Showing it as a debit would bill the patient twice for a visit
    // their package already covered.
    debitCents: 0,
    creditCents: 0,
    balanceText: `${money(ps.amount_cents)} ${t('from package', 'del bono')}`,
    balanceTone: 'neutral' as const,
    voided: false,
    detail: [
      { label: t('Package', 'Bono'), value: ps.package_name ?? '—' },
      { label: t('Value used', 'Valor consumido'), value: money(ps.amount_cents) },
      // "Cobrado" is collected; this row is what was billed, which is facturado.
      { label: t('Charged', 'Facturado'), value: t('Nothing -- already covered by the package', 'Nada -- ya cubierto por el bono') },
    ],
  }))

  // Credit-ledger rows show a running balance of that sub-ledger only --
  // labeled precisely so it isn't mistaken for PH's per-event remaining
  // amount (we have no allocation table tracking which top-up funded which
  // later spend).
  let creditRunning = 0
  const creditRows: LedgerRow[] = props.credits.map((c) => {
    creditRunning += c.amount_cents
    return {
      key: `credit-${c.id}`,
      ref: '',
      date: c.created_at,
      description: c.reason ?? t('Account credit', 'Crédito en cuenta'),
      debitCents: c.amount_cents < 0 ? -c.amount_cents : 0,
      creditCents: c.amount_cents > 0 ? c.amount_cents : 0,
      balanceText: `${money(creditRunning)} ${t('ledger bal.', 'saldo cta.')}`,
      balanceTone: creditRunning < 0 ? ('danger' as const) : ('neutral' as const),
      voided: false,
      detail: [
        ...(c.method ? [{ label: t('Method', 'Método'), value: c.method }] : []),
        ...(c.invoice_id ? [{ label: t('Linked receipt', 'Recibo vinculado'), value: invoiceRefFor(c.invoice_id) ?? '—' }] : []),
      ],
    }
  })

  // Payments/credits don't carry their own reference number -- assign one
  // per kind in chronological order (oldest = 1) before sorting the merged
  // list newest-first for display.
  const withSyntheticRefs = (list: LedgerRow[], prefix: string) =>
    [...list]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((row, i) => ({ ...row, ref: `${prefix}-${i + 1}` }))

  const allRows = [...invoiceRows, ...withSyntheticRefs(paymentRows, 'PAY'), ...withSyntheticRefs(creditRows, 'CR'), ...withSyntheticRefs(sessionRows, 'PKG')]
  return allRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
})

function toggleExpanded(key: string) {
  expandedKey.value = expandedKey.value === key ? null : key
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
function newInvoice() {
  menuOpen.value = false
  navigateTo(`/billing/new?patient_id=${props.patientId}`)
}
function addCredit() {
  menuOpen.value = false
  emit('addCredit')
}
function takePayment() {
  menuOpen.value = false
  emit('takePayment')
}

// --- Write-off: settles an invoice's remaining balance without collecting
// money, via the parent (which owns the `invoices` array and the same
// paidCents->status flip logic used by every other payment path). ---------
function writeOffInvoice(invoiceId: string) {
  menuOpen.value = false
  emit('writeOffInvoice', invoiceId)
}

// --- Refund: opens with the full refundable amount pre-filled (the common
// case, a full refund), staff can lower it for a partial one. -------------
const refundModalInvoiceId = ref<string | null>(null)
const refundAmount = ref('')
const refundReason = ref('')
const refundMaxCents = ref(0)
// Which method the money physically went back through -- distinct from "this
// doesn't move money itself" below, which is about this app never calling a
// real refund API. Without this, the refund never showed up in the Income
// report's "By payment method" breakdown or reduced "Total paid" there
// (both read only from `payments`, which a refund never touched), which is
// also what let a refunded, fully-paid invoice leave a phantom credit on the
// patient's balance -- see createRefund's matching payments insert.
const { methods: paymentMethods, ensureLoaded: ensurePaymentMethodsLoaded, defaultMethod } = usePaymentMethods()
// Which method the money physically went back through -- the account's own
// list, same as taking one. It used to offer card/cash/"Other (e.g. bank
// transfer)" and was the ONLY screen that mentioned bank transfer at all.
const refundMethod = ref<string>('card')

function openRefundModal(invoiceId: string, maxCents: number) {
  menuOpen.value = false
  ensurePaymentMethodsLoaded()
  refundModalInvoiceId.value = invoiceId
  refundMaxCents.value = maxCents
  refundAmount.value = (maxCents / 100).toFixed(2)
  refundReason.value = ''
  refundMethod.value = defaultMethod.value
}
function submitRefund() {
  if (!refundModalInvoiceId.value) return
  const amountCents = Math.round((parseFloat(refundAmount.value) || 0) * 100)
  if (amountCents <= 0 || amountCents > refundMaxCents.value) return
  emit('refundInvoice', { invoiceId: refundModalInvoiceId.value, amountCents, reason: refundReason.value, method: refundMethod.value })
  refundModalInvoiceId.value = null
}

// --- Transfer credit: moves an amount from this patient's credit ledger to
// another patient's (e.g. a cancelled package's refund redirected to a
// family member) -- a linked pair of account_credits rows, mirroring the
// existing package-sharing search pattern in BillingTab.vue. ---------------
interface PatientOption { id: string; first_name: string; last_name: string | null }
const transferModalOpen = ref(false)
const transferSearch = ref('')
const transferResults = ref<PatientOption[]>([])
const transferTarget = ref<PatientOption | null>(null)
const transferAmount = ref('')
const transferring = ref(false)
const transferError = ref('')
let transferDebounce: ReturnType<typeof setTimeout> | undefined

function openTransferCredit() {
  menuOpen.value = false
  transferModalOpen.value = true
  transferSearch.value = ''
  transferResults.value = []
  transferTarget.value = null
  transferAmount.value = ''
  transferError.value = ''
}
watch(transferSearch, (value) => {
  clearTimeout(transferDebounce)
  if (!value.trim()) {
    transferResults.value = []
    return
  }
  transferDebounce = setTimeout(async () => {
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .neq('id', props.patientId)
      .ilike('search_name', `%${normalizeSearchTerm(value.trim())}%`)
      .limit(8)
    transferResults.value = data ?? []
  }, 250)
})
function selectTransferTarget(patient: PatientOption) {
  transferTarget.value = patient
  transferSearch.value = ''
  transferResults.value = []
}
async function submitTransferCredit() {
  transferError.value = ''
  if (!transferTarget.value) return
  const amountCents = Math.round((parseFloat(transferAmount.value) || 0) * 100)
  if (amountCents <= 0 || amountCents > props.spendableCreditCents) {
    transferError.value = t('Amount must be positive and not exceed available credit.', 'El importe debe ser positivo y no superar el crédito disponible.')
    return
  }
  transferring.value = true
  const targetName = `${transferTarget.value.first_name} ${transferTarget.value.last_name ?? ''}`.trim()
  await supabase.from('account_credits').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    amount_cents: -amountCents,
    reason: `Transferred to ${targetName}`,
    created_by: store.teamMember?.id ?? null,
  })
  await supabase.from('account_credits').insert({
    account_id: store.accountId!,
    patient_id: transferTarget.value.id,
    amount_cents: amountCents,
    reason: 'Transferred credit',
    created_by: store.teamMember?.id ?? null,
  })
  transferring.value = false
  transferModalOpen.value = false
  emit('creditsChanged')
}

// --- Statement: a PDF of this whole ledger, mirroring the invoice
// download/send pattern (pages/billing/[id].vue, server/utils/invoiceData.ts). ---
const statementSending = ref(false)
const statementMessage = ref('')
async function downloadStatement() {
  menuOpen.value = false
  const blob = await useStaffFetch<Blob>(`/api/patients/${props.patientId}/statement`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `statement-${props.patientId}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
async function sendStatement() {
  menuOpen.value = false
  statementSending.value = true
  statementMessage.value = ''
  try {
    await useStaffFetch(`/api/patients/${props.patientId}/statement/send`, { method: 'POST' })
    statementMessage.value = t('Statement emailed.', 'Extracto enviado por correo.')
  } catch (e: any) {
    statementMessage.value = e?.data?.message ?? t('Failed to send statement.', 'No se pudo enviar el extracto.')
  }
  statementSending.value = false
  setTimeout(() => (statementMessage.value = ''), 4000)
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card">
    <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
      <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Account Ledger', 'Libro de cuenta') }}</p>
      <div class="flex items-center gap-2">
        <span v-if="statementMessage" class="text-[12px] text-ink-faint">{{ statementMessage }}</span>
        <div class="relative">
          <button type="button" class="rounded-ctlSm px-1.5 py-1 text-ink-faint hover:bg-surface-subtle hover:text-ink-700" @click="menuOpen = !menuOpen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          <div v-if="menuOpen" class="absolute right-0 z-10 mt-1 w-44 rounded-ctl border border-line bg-surface py-1 shadow-popover">
            <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="newInvoice">{{ t('New receipt', 'Nuevo recibo') }}</button>
            <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="takePayment">{{ t('New Payment', 'Nuevo pago') }}</button>
            <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="addCredit">{{ t('Add Credit', 'Añadir crédito') }}</button>
            <button v-if="spendableCreditCents > 0" type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="openTransferCredit">
              {{ t('Transfer Credit', 'Transferir crédito') }}
            </button>
            <div class="my-1 border-t border-line-divider"></div>
            <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="downloadStatement">{{ t('Download Statement', 'Descargar extracto') }}</button>
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle disabled:opacity-50"
              :disabled="statementSending"
              @click="sendStatement"
            >
              {{ statementSending ? t('Sending…', 'Enviando…') : t('Send Statement', 'Enviar extracto') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="rows.length === 0" class="p-8 text-center text-[13px] text-ink-faint">{{ t('No transactions yet.', 'Aún no hay transacciones.') }}</div>
    <div v-else class="max-h-[420px] overflow-y-auto">
      <table class="w-full text-[13px]">
        <thead class="sticky top-0 border-b border-line-divider bg-surface text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          <tr>
            <th class="w-6 px-2 py-2"></th>
            <th class="px-2 py-2">{{ t('Ref', 'Ref.') }}</th>
            <th class="px-2 py-2">{{ t('Date', 'Fecha') }}</th>
            <th class="px-2 py-2">{{ t('Description', 'Descripción') }}</th>
            <th class="px-2 py-2 text-right">{{ t('Debit', 'Debe') }}</th>
            <th class="px-2 py-2 text-right">{{ t('Credit', 'Haber') }}</th>
            <th class="px-4 py-2 text-right">{{ t('Balance', 'Saldo') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line-row">
          <template v-for="row in rows" :key="row.key">
            <tr class="h-[42px] cursor-pointer hover:bg-surface-subtle" :class="row.voided ? 'opacity-60' : ''" @click="toggleExpanded(row.key)">
              <td class="px-2 text-ink-faint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="transition-transform" :class="expandedKey === row.key ? 'rotate-90' : ''">
                  <path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </td>
              <td class="px-2 font-mono text-[12px] text-ink-muted">{{ row.ref }}</td>
              <td class="px-2 text-ink-muted">{{ formatDate(row.date) }}</td>
              <td class="px-2 text-ink-700">{{ row.description }}</td>
              <td class="px-2 text-right font-mono text-ink-700">{{ row.debitCents > 0 ? money(row.debitCents) : '' }}</td>
              <td class="px-2 text-right font-mono text-success-text">{{ row.creditCents > 0 ? money(row.creditCents) : '' }}</td>
              <td class="px-4 text-right font-mono" :class="row.balanceTone === 'danger' ? 'text-danger-text' : 'text-ink-muted'">{{ row.balanceText }}</td>
            </tr>
            <tr v-if="expandedKey === row.key">
              <td colspan="7" class="bg-surface-subtle px-8 py-3">
                <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
                  <template v-for="(d, i) in row.detail" :key="i">
                    <dt class="text-ink-faint">{{ d.label }}</dt>
                    <dd class="text-ink-muted2">{{ d.value }}</dd>
                  </template>
                </dl>
                <div v-if="row.paymentId && canDeletePayments" class="mt-2 flex items-center gap-3 border-t border-line-divider pt-2 text-[12px]">
                  <button
                    type="button"
                    class="text-ink-faint hover:text-danger-text"
                    @click="emit('deletePayment', { paymentId: row.paymentId!, invoiceId: row.paymentInvoiceId ?? null, amountCents: row.paymentAmountCents ?? 0 })"
                  >
                    {{ t('Remove payment', 'Eliminar pago') }}
                  </button>
                  <span class="text-ink-faint2">{{ t('Reopens the receipt so it can be billed again', 'Reabre el recibo para poder facturarlo de nuevo') }}</span>
                </div>
                <div v-if="row.invoiceId" class="mt-2 flex items-center gap-3 border-t border-line-divider pt-2 text-[12px]">
                  <NuxtLink :to="`/billing/${row.invoiceId}`" class="font-medium text-brand-text hover:text-brand-hover">{{ t('Open receipt', 'Abrir recibo') }}</NuxtLink>
                  <span v-if="sendResultInvoiceId === row.invoiceId" class="text-ink-faint">{{ sendResultMessage }}</span>
                  <button
                    v-else
                    type="button"
                    class="text-ink-faint hover:text-brand-text disabled:opacity-50"
                    :disabled="sendingInvoiceId === row.invoiceId"
                    @click="emit('sendInvoice', row.invoiceId)"
                  >
                    {{ sendingInvoiceId === row.invoiceId ? t('Sending…', 'Enviando…') : t('Email receipt', 'Enviar recibo por correo') }}
                  </button>
                  <UiIconBtn v-if="canDeleteInvoices" icon="trash" tone="danger" :label="t('Delete', 'Eliminar')" @click="emit('deleteInvoice', row.invoiceId)" />
                  <button
                    v-if="canWriteOff && !row.voided && (row.invoiceOpenCents ?? 0) > 0"
                    type="button"
                    class="text-ink-faint hover:text-warning-text"
                    @click="writeOffInvoice(row.invoiceId)"
                  >
                    {{ t('Write off', 'Condonar') }} {{ money(row.invoiceOpenCents ?? 0) }}
                  </button>
                  <button
                    v-if="canRefund && !row.isRefund && (row.refundableCents ?? 0) > 0"
                    type="button"
                    class="text-ink-faint hover:text-danger-text"
                    @click="openRefundModal(row.invoiceId, row.refundableCents ?? 0)"
                  >
                    {{ t('Refund…', 'Reembolsar…') }}
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="transferModalOpen" class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/40 p-4" @click.self="transferModalOpen = false">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-4 shadow-popover">
      <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Transfer credit', 'Transferir crédito') }}</p>
      <p class="mt-1 text-[12px] text-ink-faint">{{ t('Moves an amount from this patient\'s credit', 'Mueve un importe del crédito de este paciente') }} (€{{ (spendableCreditCents / 100).toFixed(2) }} {{ t('available', 'disponible') }}) {{ t('to another patient\'s account.', 'a la cuenta de otro paciente.') }}</p>

      <div class="mt-3">
        <label class="block text-[11px] text-ink-muted">{{ t('To patient', 'Al paciente') }}</label>
        <div v-if="transferTarget" class="mt-0.5 flex items-center justify-between rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]">
          <span>{{ transferTarget.first_name }} {{ transferTarget.last_name }}</span>
          <button type="button" class="text-ink-faint hover:text-danger-text" @click="transferTarget = null">✕</button>
        </div>
        <div v-else class="relative mt-0.5">
          <input
            v-model="transferSearch"
            type="text"
            :placeholder="t('Search a patient…', 'Buscar un paciente…')"
            class="w-full rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]"
          />
          <ul v-if="transferResults.length" class="absolute z-10 mt-1 w-full rounded-ctlSm border border-line bg-surface shadow-popover">
            <li
              v-for="p in transferResults"
              :key="p.id"
              class="cursor-pointer px-2 py-1.5 text-[13px] text-ink-700 hover:bg-surface-subtle"
              @click="selectTransferTarget(p)"
            >
              {{ p.first_name }} {{ p.last_name }}
            </li>
          </ul>
        </div>
      </div>

      <div class="mt-3">
        <label class="block text-[11px] text-ink-muted">{{ t('Amount (€)', 'Importe (€)') }}</label>
        <input v-model="transferAmount" type="number" min="0" step="0.01" class="mt-0.5 w-32 rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]" />
      </div>

      <p v-if="transferError" class="mt-2 text-[12px] text-danger-text">{{ transferError }}</p>

      <div class="mt-4 flex items-center justify-end gap-2">
        <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="transferModalOpen = false">{{ t('Cancel', 'Cancelar') }}</button>
        <UiBtn variant="primary" size="sm" :disabled="!transferTarget || !transferAmount || transferring" @click="submitTransferCredit">
          {{ transferring ? t('Transferring…', 'Transfiriendo…') : t('Transfer', 'Transferir') }}
        </UiBtn>
      </div>
    </div>
  </div>

  <div v-if="refundModalInvoiceId" class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/40 p-4" @click.self="refundModalInvoiceId = null">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-4 shadow-popover">
      <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Refund', 'Reembolso') }}</p>
      <p class="mt-1 text-[12px] text-ink-faint">
        {{
          t(
            "Records a refund against this invoice and reduces the patient's balance -- doesn't call any real refund API, so process the actual refund (cash, Stripe, etc.) separately.",
            'Registra un reembolso contra esta factura y reduce el saldo del paciente -- no llama a ninguna API de reembolso real, así que procesa el reembolso real (efectivo, Stripe, etc.) por separado.',
          )
        }}
      </p>

      <div class="mt-3">
        <label class="block text-[11px] text-ink-muted">{{ t('Amount (€)', 'Importe (€)') }} -- {{ t('up to', 'hasta') }} {{ money(refundMaxCents) }}</label>
        <input v-model="refundAmount" type="number" min="0" :max="refundMaxCents / 100" step="0.01" class="mt-0.5 w-32 rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]" />
      </div>
      <div class="mt-3">
        <label class="block text-[11px] text-ink-muted">{{ t('Refunded via', 'Reembolsado vía') }}</label>
        <select v-model="refundMethod" class="bg-surface mt-0.5 w-full rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]">
          <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
        </select>
      </div>
      <div class="mt-3">
        <label class="block text-[11px] text-ink-muted">{{ t('Reason (optional)', 'Motivo (opcional)') }}</label>
        <input
          v-model="refundReason"
          type="text"
          class="mt-0.5 w-full rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]"
          :placeholder="t('e.g. patient cancelled package', 'p. ej. el paciente canceló el bono')"
        />
      </div>

      <div class="mt-4 flex items-center justify-end gap-2">
        <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="refundModalInvoiceId = null">{{ t('Cancel', 'Cancelar') }}</button>
        <UiBtn
          variant="primary"
          size="sm"
          :disabled="!refundAmount || Math.round((parseFloat(refundAmount) || 0) * 100) <= 0 || Math.round((parseFloat(refundAmount) || 0) * 100) > refundMaxCents"
          @click="submitRefund"
        >
          {{ t('Refund', 'Reembolso') }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>
