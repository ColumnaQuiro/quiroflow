<script setup lang="ts">
import { formatEur } from '~/utils/billing'
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
import { isReceipt } from '~/utils/paymentReceipts'
import { paymentRefundableCents } from '~/utils/paymentRefund'
import type { LedgerIconName } from './LedgerIcon.vue'

interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  total_cents: number
  created_at: string
  is_refund: boolean
  refunds_invoice_id: string | null
  refunds_payment_id: string | null
}
interface PaymentRow { id: string; invoice_id: string | null; amount_cents: number; method: string; paid_at: string; purpose?: string | null; package_purchase_id?: string | null; created_by?: string | null; stripe_payment_intent_id?: string | null; team_members?: { full_name: string | null } | null }
// A visit drawn from a package. Carries no debit or credit -- the money was
// already accounted for when the package was bought -- so it appears in the
// ledger purely so a visit is not silently absent from a patient's history.
interface PackageSessionRow { id: string; amount_cents: number; used_at: string; package_name: string | null }
interface CreditRow { id: string; amount_cents: number; reason: string | null; method: string | null; invoice_id: string | null; payment_id?: string | null; created_at: string }

const props = defineProps<{
  patientId: string
  /** Under age or "do not contact": the statement is not emailed to them. */
  contactBlocked?: boolean
  invoices: InvoiceRow[]
  lineItemDescriptions: Record<string, string[]>
  payments: PaymentRow[]
  /** Payments collected through GoCardless: refunding one by direct debit sends the money back through it. */
  gocardlessPaymentIds?: string[]
  /** GoCardless's payment id (PM…) of each payment it collected, by our payment id. */
  gocardlessPaymentRefs?: Record<string, string>
  credits: CreditRow[]
  packageSessions: PackageSessionRow[]
  spendableCreditCents: number
  /** Passed in rather than re-derived, so the footer and the Owed now card
   *  cannot drift apart about what the patient owes. */
  outstandingCents: number
  sendingInvoiceId: string
  sendResultInvoiceId: string
  sendResultMessage: string
  canDeleteInvoices: boolean
  // Removing a payment writes to `payments`, whose RLS requires
  // payments_allocate -- gating this on the invoice permission alone would
  // show the button to someone the database then refuses.
  canDeletePayments: boolean
  // Same gate as removing one: it is an edit to money already received, and
  // the update goes through the same payments_allocate RLS.
  canChangePaymentMethod: boolean
  canWriteOff: boolean
  canRefund: boolean
  // New Payment and Add Credit both write a `payments` row, which RLS only
  // allows with payments_allocate.
  canTakePayments: boolean
  /**
   * A receipt to open the refund modal for straight away, from
   * /billing/<id>'s Refund button. The receipt page deliberately does not
   * refund on its own: this modal issues a rectificativa and a matching
   * negative payment, and a second copy of that is the last thing fiscal
   * code needs. So it sends people here instead.
   */
  openRefundForInvoiceId?: string | null
}>()
const emit = defineEmits<{
  addCredit: []
  /** With a target, from a receipt's Collect: take payment on THAT receipt, for what is still open on it. */
  takePayment: [target?: { invoiceId: string; amountCents: number }]
  sendInvoice: [invoiceId: string]
  deleteInvoice: [invoiceId: string]
  deletePayment: [payload: { paymentId: string; invoiceId: string | null; amountCents: number }]
  changePaymentMethod: [payload: { paymentId: string; method: string }]
  correctPaymentAmount: [payload: { paymentId: string; amountCents: number; reason: string }]
  writeOffInvoice: [invoiceId: string]
  refundInvoice: [payload: { invoiceId: string | null; paymentId: string | null; amountCents: number; reason: string; method: string; restock: { productId: string; units: number }[] }]
  creditsChanged: []
}>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const expandedKey = ref<string | null>(null)
const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
useDismissOnOutside(menuRoot, menuOpen)

function money(cents: number) {
  const amount = formatEur(Math.abs(cents))
  // formatEur already carries the symbol, in the Spanish position.
  return `${cents < 0 ? '-' : ''}${amount}`
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
  if (props.gocardlessPaymentRefs?.[p.id]) return t('Automatic (direct debit)', 'Automático (domiciliación)')
  return t('Not recorded', 'Sin registrar')
}

/**
 * What a row is, which picks its icon tile and which filter it falls under.
 * Kept apart from the money columns on purpose: a refund receipt and a refund
 * payment both move money out, but one is a fiscal document and the other is
 * cash leaving the till.
 */
type LedgerKind = 'receipt' | 'refundReceipt' | 'paymentIn' | 'paymentOut' | 'bono' | 'credit'
type StatusTone = 'success' | 'danger' | 'neutral' | 'info'

interface LedgerRow {
  key: string
  kind: LedgerKind
  ref: string
  date: string
  description: string
  /** Shown beside the ref under the description: the receipt's first item. */
  sub?: string
  debitCents: number
  creditCents: number
  /** Replaces the old Balance column: what state this entry is in, as a pill. */
  statusText: string
  statusTone: StatusTone
  /** The pill carries a dot only for paid and owed, the two states a desk acts on. */
  statusDot?: boolean
  /** Hover text for the pill, e.g. the receipt a payment settles. */
  statusTitle?: string
  voided: boolean
  invoiceId?: string
  paymentId?: string
  paymentAmountCents?: number
  paymentInvoiceId?: string | null
  invoiceOpenCents?: number
  refundableCents?: number
  paymentRefundableCents?: number
  paymentMethod?: string
  /** Money recorded by hand, so its method is a choice somebody can correct. */
  paymentMethodChangeable?: boolean
  /** Money taken against a receipt, not processor-charged, refunded, a bono or a top-up: what correct_payment_amount() accepts. */
  paymentAmountCorrectable?: boolean
  isRefund?: boolean
  /** Deliberately moves no money -- renders an em dash in Debit and Credit. */
  noMoneyMoved?: boolean
  /** One short line under the movement, explaining a row that needs it. */
  note?: string
  detail: { label: string; value: string }[]
}

/** Whether any row on screen is one the footer's bono note explains. */
const hasNoMoneyRows = computed(() => rows.value.some((r) => r.noMoneyMoved))

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
      // A refund of a payment that never had a receipt -- most imported
      // PracticeHub money -- names the payment instead. Reading
      // refunds_invoice_id alone called every one of those a "deleted receipt".
      const refundedPayment = !inv.refunds_invoice_id && inv.refunds_payment_id ? props.payments.find((p) => p.id === inv.refunds_payment_id) : undefined
      const against = refundedPayment
        ? `${t('payment of', 'pago de')} ${formatDate(refundedPayment.paid_at)}`
        : (invoiceRefFor(inv.refunds_invoice_id) ?? t('deleted receipt', 'recibo eliminado'))
      return {
        key: `invoice-${inv.id}`,
        kind: 'refundReceipt' as const,
        ref: inv.invoice_number,
        date: inv.created_at,
        description: `${t('Refund', 'Reembolso')} — ${against}`,
        debitCents: 0,
        creditCents: refundedCents,
        statusText: t('Rectifying', 'Rectificativa'),
        statusTone: 'info' as const,
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
    //
    // This counts refunds made against a single PAYMENT too: those set
    // refunds_invoice_id as well as refunds_payment_id precisely so this sum
    // keeps working. Refund EUR 20 against the card payment and the receipt's
    // own refundable total drops by EUR 20 with it.
    //
    // Only money that came in, which is the rule a single payment already
    // followed: a write-off settles a receipt without collecting anything, and
    // a 'credit' row spends a balance paid in (and refundable) elsewhere.
    // Summing every payment let a written-off receipt be refunded in cash --
    // money out of the till for a debt that was forgiven, not paid.
    const alreadyRefunded = props.invoices
      .filter((r) => r.is_refund && r.refunds_invoice_id === inv.id)
      .reduce((sum, r) => sum + Math.abs(r.total_cents), 0)
    const receivedForInvoice = props.payments
      .filter((p) => p.invoice_id === inv.id && isReceipt(p.method))
      .reduce((sum, p) => sum + p.amount_cents, 0)
    const refundableCents = inv.status === 'void' ? 0 : Math.max(0, receivedForInvoice - alreadyRefunded)

    // A negative total_cents invoice that isn't flagged is_refund happens
    // for imported data (e.g. a PracticeHub refund record) rather than one
    // created through the app's own refund flow above -- same shape, just
    // missing the flag. Split by sign the same way, or it falls through as
    // a negative debitCents that the template hides (debitCents > 0 only).
    const isUnflaggedRefund = inv.total_cents < 0

    const voided = inv.status === 'void'
    const status: Pick<LedgerRow, 'statusText' | 'statusTone' | 'statusDot'> = voided
      ? { statusText: t('Void', 'Anulado'), statusTone: 'neutral' }
      : isUnflaggedRefund
        ? { statusText: t('Refund', 'Reembolso'), statusTone: 'info' }
        : openCents > 0
          ? { statusText: `${t('Unpaid', 'Pendiente')} ${money(openCents)}`, statusTone: 'danger', statusDot: true }
          : { statusText: t('Paid', 'Pagado'), statusTone: 'success', statusDot: true }

    return {
      key: `invoice-${inv.id}`,
      kind: isUnflaggedRefund ? ('refundReceipt' as const) : ('receipt' as const),
      ref: inv.invoice_number,
      date: inv.created_at,
      description: voided ? t('Receipt (void)', 'Recibo (anulado)') : isUnflaggedRefund ? t('Receipt (refund)', 'Recibo (reembolso)') : t('Receipt', 'Recibo'),
      sub: items[0],
      debitCents: voided ? 0 : Math.max(inv.total_cents, 0),
      creditCents: voided ? 0 : Math.max(-inv.total_cents, 0),
      ...status,
      voided,
      invoiceId: inv.id,
      invoiceOpenCents: inv.status === 'void' ? 0 : openCents,
      refundableCents,
      detail: items.length > 0 ? items.map((d) => ({ label: t('Item', 'Artículo'), value: d })) : [{ label: t('Items', 'Artículos'), value: '—' }],
    }
  })

  // What can still go back out on ONE payment -- utils/paymentRefund, which
  // createRefund re-derives on the write, so the two cannot disagree. A
  // payment an account_credits row names is a top-up, and stays unrefundable
  // here: its credit row would outlive the refund and stay spendable.
  const creditPaymentIds = new Set(props.credits.map((c) => c.payment_id).filter((id): id is string => !!id))
  function paymentRefundableCentsFor(p: PaymentRow): number {
    return paymentRefundableCents(p, props.invoices, props.payments, creditPaymentIds)
  }

  // Same rule as usePatientFinancialSummary, unconditionally now: a 'credit'
  // payment is never money, void invoice or not, because most of what it pays
  // for (a bono, a membership) raises no invoice at all to be void or
  // otherwise -- see that composable for why the narrower, invoice-only
  // version of this rule still let a credit-method payment inflate the
  // running balance whenever the credit being spent was never its own
  // account_credits row (one patient, EUR 240, 24 Sep 2026). Leaving the
  // payment in the Credit column here shows a credit line with nothing
  // facing it and a running balance that disagrees with the summary strip;
  // what actually happened is still visible, on its own account_credits row
  // a few lines below ("Applied to ..."), which this filter does not touch.
  const countablePayments = props.payments.filter((p) => p.method !== 'credit')

  const paymentRows: LedgerRow[] = countablePayments.map((p) => ({
    key: `payment-${p.id}`,
    kind: p.amount_cents < 0 ? ('paymentOut' as const) : ('paymentIn' as const),
    ref: '',
    // A direct debit names GoCardless's payment id (PM…) under its
    // description: the handle GoCardless's dashboard and support know the
    // collection by. Not in Ref, which numbers every payment PAY-n.
    note: props.gocardlessPaymentRefs?.[p.id] ? `GoCardless ${props.gocardlessPaymentRefs[p.id]}` : undefined,
    paymentId: p.id,
    paymentAmountCents: p.amount_cents,
    // Deliberately NOT `invoiceId`: that field gates the invoice action block
    // below, and a payment row offering "Delete invoice" would delete the
    // wrong thing entirely.
    paymentInvoiceId: p.invoice_id,
    paymentRefundableCents: paymentRefundableCentsFor(p),
    paymentMethod: p.method,
    // Not a Stripe charge (that was card, as a matter of fact) and not credit
    // or a write-off (not money at all). The payments_method_change trigger
    // refuses the same three; this only keeps the button off rows it would
    // refuse.
    paymentMethodChangeable: !p.stripe_payment_intent_id && p.method !== 'credit' && p.method !== 'write_off',
    // The same refusals correct_payment_amount() makes, so the button is only
    // on rows it would accept. A bono payment or a top-up keeps books of its
    // own that a changed amount would leave behind; a refunded payment is
    // already corrected by its refund's rectificativa.
    paymentAmountCorrectable:
      !!p.invoice_id &&
      !p.package_purchase_id &&
      !p.stripe_payment_intent_id &&
      p.method !== 'credit' &&
      p.method !== 'write_off' &&
      p.amount_cents > 0 &&
      !creditPaymentIds.has(p.id) &&
      !props.invoices.some((i) => i.refunds_payment_id === p.id),
    date: p.paid_at,
    // Negative only for the payments row createRefund() inserts alongside a
    // refund invoice, so this money goes back out belongs in Debit like any
    // other outgoing entry -- a plain Credit column can't show a negative
    // value at all (see the row.creditCents > 0 guard below), which is what
    // made this row render with no amount before this handled the sign.
    // The method's name, not its key: rows used to read "Payment — write_off".
    description: p.amount_cents < 0 ? `${t('Refund payment', 'Pago de reembolso')} — ${methodLabel(p.method)}` : `${t('Payment', 'Pago')} — ${methodLabel(p.method)}`,
    debitCents: p.amount_cents < 0 ? -p.amount_cents : 0,
    creditCents: p.amount_cents > 0 ? p.amount_cents : 0,
    // Which receipt it settles stays OUT of the pill's text and in its hover
    // title: rows are found by their receipt number, and a payment row
    // carrying the same number would be found first.
    ...(p.amount_cents < 0
      ? { statusText: t('Refunded', 'Devuelto'), statusTone: 'neutral' as const }
      : p.invoice_id
        ? { statusText: t('Applied', 'Aplicado'), statusTone: 'neutral' as const, statusTitle: `${t('Applied to', 'Aplicado a')} ${invoiceRefFor(p.invoice_id)}` }
        : p.package_purchase_id
          ? { statusText: t('Bono', 'Bono'), statusTone: 'neutral' as const }
          : { statusText: t('On account', 'A cuenta'), statusTone: 'neutral' as const }),
    voided: false,
    detail: [
      { label: t('Method', 'Método'), value: methodLabel(p.method) },
      { label: t('Applied to', 'Aplicado a'), value: invoiceRefFor(p.invoice_id) ?? '—' },
      // Shown for every payment, including the ones with no author, because
      // "Automatic" and "not recorded" are different answers and a row that
      // simply omits the line can't tell them apart. Rows written before
      // created_by existed are the honest third case: nothing recorded it.
      { label: t('Recorded by', 'Registrado por'), value: recordedBy(p) },
      // The collection as GoCardless names it, which is what its dashboard
      // and support search by.
      ...(props.gocardlessPaymentRefs?.[p.id] ? [{ label: t('GoCardless payment', 'Cobro de GoCardless'), value: props.gocardlessPaymentRefs[p.id]! }] : []),
    ],
  }))

  const sessionRows: LedgerRow[] = props.packageSessions.map((ps) => ({
    key: `pkgsession-${ps.id}`,
    kind: 'bono' as const,
    ref: '',
    date: ps.used_at,
    description: ps.package_name
      ? `${t('Visit from', 'Visita del bono')} ${ps.package_name}`
      : t('Visit from a bono', 'Visita de un bono'),
    // Zero on both sides on purpose: this is a record of consumption, not a
    // charge. Showing it as a debit would bill the patient twice for a visit
    // their package already covered.
    debitCents: 0,
    creditCents: 0,
    statusText: `${money(ps.amount_cents)} ${t('from bono', 'del bono')}`,
    statusTone: 'info' as const,
    voided: false,
    // Em dashes rather than blanks in Debit and Credit, plus a note: this
    // row moves no money, and a blank cell reads as "not filled in yet"
    // rather than "deliberately nothing".
    noMoneyMoved: true,
    note: t('Paid when the bono was bought.', 'Pagado al comprar el bono.'),
    detail: [
      { label: t('Bono', 'Bono'), value: ps.package_name ?? '—' },
      { label: t('Value used', 'Valor consumido'), value: money(ps.amount_cents) },
      // "Cobrado" is collected; this row is what was billed, which is facturado.
      { label: t('Charged', 'Facturado'), value: t('Nothing. The bono already covered it.', 'Nada: ya lo cubría el bono.') },
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
      kind: 'credit' as const,
      ref: '',
      date: c.created_at,
      description: c.reason ?? t('Account credit', 'Crédito en cuenta'),
      debitCents: c.amount_cents < 0 ? -c.amount_cents : 0,
      creditCents: c.amount_cents > 0 ? c.amount_cents : 0,
      statusText: `${money(creditRunning)} ${t('in credit', 'de crédito')}`,
      statusTone: creditRunning < 0 ? ('danger' as const) : ('info' as const),
      voided: false,
      detail: [
        ...(c.method ? [{ label: t('Method', 'Método'), value: methodLabel(c.method) }] : []),
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

// --- Filter ---------------------------------------------------------------
type LedgerFilter = 'all' | 'receipts' | 'payments' | 'bonos'
const filter = ref<LedgerFilter>('all')
function filterOf(kind: LedgerKind): Exclude<LedgerFilter, 'all'> {
  if (kind === 'receipt' || kind === 'refundReceipt') return 'receipts'
  if (kind === 'paymentIn' || kind === 'paymentOut') return 'payments'
  return 'bonos'
}
const visibleRows = computed(() => (filter.value === 'all' ? rows.value : rows.value.filter((r) => filterOf(r.kind) === filter.value)))
const filters = computed(() => {
  const count = (f: LedgerFilter) => (f === 'all' ? rows.value.length : rows.value.filter((r) => filterOf(r.kind) === f).length)
  return ([
    { key: 'all', label: t('All', 'Todo') },
    { key: 'receipts', label: t('Receipts', 'Recibos') },
    { key: 'payments', label: t('Payments', 'Pagos') },
    { key: 'bonos', label: t('Bonos & credit', 'Bonos y crédito') },
  ] as const).map((f) => ({ ...f, count: count(f.key) }))
})

const KIND_TILE: Record<LedgerKind, { icon: LedgerIconName; tone: string }> = {
  receipt: { icon: 'receipt', tone: 'bg-chip-bg text-chip-text' },
  refundReceipt: { icon: 'rectifying', tone: 'bg-chip-bg text-chip-text' },
  paymentIn: { icon: 'money-in', tone: 'bg-success-bg text-success-accent' },
  paymentOut: { icon: 'money-out', tone: 'bg-danger-bg text-danger-text' },
  bono: { icon: 'bono', tone: 'bg-info-bg text-info-accent' },
  credit: { icon: 'credit', tone: 'bg-info-bg text-info-accent' },
}

// --- Actions ----------------------------------------------------------------
// One list per row, drawn twice: as buttons in the expanded panel and as the
// row's "…" menu. They used to be faint text links in the panel only, set in
// the same grey as the facts above them, so a person looking for "Change
// method" read straight past it -- and a collapsed row showed none of them.
// Each one appears under exactly the conditions it always did.
interface LedgerAction {
  key: string
  label: string
  icon: LedgerIconName
  /** Mono figure after the label: what the action will move. */
  amount?: string
  tone?: 'primary' | 'default' | 'danger'
  /** A link rather than a button (Open receipt). */
  to?: string
  disabled?: boolean
  /** Plain text standing where the action was, e.g. "Receipt sent". */
  textOnly?: boolean
  dataCy?: string
  run?: () => void
}
interface ActionGroup {
  key: string
  danger?: boolean
  /** One line under the group, for an action whose effect is not obvious. */
  hint?: string
  actions: LedgerAction[]
}

function actionGroups(row: LedgerRow): ActionGroup[] {
  const groups: ActionGroup[] = []
  const push = (g: ActionGroup) => {
    if (g.actions.length > 0) groups.push(g)
  }

  if (row.paymentId) {
    const paymentId = row.paymentId
    push({
      key: 'correct',
      actions: [
        ...(props.canChangePaymentMethod && row.paymentMethodChangeable
          ? [{ key: 'method', label: t('Change method…', 'Cambiar método…'), icon: 'swap' as const, dataCy: 'payment-change-method', run: () => openMethodModal(paymentId, row.paymentMethod ?? '') }]
          : []),
        ...(props.canChangePaymentMethod && row.paymentAmountCorrectable
          ? [{ key: 'amount', label: t('Correct amount…', 'Corregir importe…'), icon: 'pencil' as const, dataCy: 'payment-correct-amount', run: () => openAmountModal(paymentId, row.paymentAmountCents ?? 0) }]
          : []),
      ],
    })
    // Refunds THIS payment: capped at what came in on it and pre-set to the
    // method it came in on. Removing a payment says it never happened and
    // reopens the receipt; this says it happened and went back.
    push({
      key: 'refund',
      actions:
        props.canRefund && (row.paymentRefundableCents ?? 0) > 0
          ? [{ key: 'refund', label: t('Refund…', 'Reembolsar…'), icon: 'refund', amount: money(row.paymentRefundableCents ?? 0), run: () => openPaymentRefundModal(paymentId, row.paymentInvoiceId ?? null, row.paymentRefundableCents ?? 0, row.paymentMethod ?? '') }]
          : [],
    })
    push({
      key: 'remove',
      danger: true,
      hint: t('Refunds nothing. The receipt reopens if it is no longer fully paid.', 'No reembolsa nada. El recibo se reabre si deja de estar pagado.'),
      actions: props.canDeletePayments
        ? [{ key: 'remove', label: t('Remove payment', 'Eliminar pago'), icon: 'trash', tone: 'danger', run: () => emit('deletePayment', { paymentId, invoiceId: row.paymentInvoiceId ?? null, amountCents: row.paymentAmountCents ?? 0 }) }]
        : [],
    })
  }

  if (row.invoiceId) {
    const invoiceId = row.invoiceId
    const open = row.invoiceOpenCents ?? 0
    push({
      key: 'collect',
      actions:
        props.canTakePayments && !row.voided && !row.isRefund && open > 0
          ? [{ key: 'collect', label: t('Collect', 'Cobrar'), icon: 'collect', amount: money(open), tone: 'primary', run: () => emit('takePayment', { invoiceId, amountCents: open }) }]
          : [],
    })
    push({
      key: 'documents',
      actions: [
        { key: 'open', label: t('Open receipt', 'Abrir recibo'), icon: 'open', to: `/billing/${invoiceId}` },
        props.sendResultInvoiceId === invoiceId
          ? { key: 'email', label: props.sendResultMessage, icon: 'mail', textOnly: true }
          : {
              key: 'email',
              label: props.sendingInvoiceId === invoiceId ? t('Sending…', 'Enviando…') : t('Email receipt', 'Enviar recibo por correo'),
              icon: 'mail',
              disabled: props.sendingInvoiceId === invoiceId,
              run: () => emit('sendInvoice', invoiceId),
            },
      ],
    })
    push({
      key: 'money',
      actions: [
        ...(props.canWriteOff && !row.voided && open > 0
          ? [{ key: 'writeoff', label: t('Write off', 'Condonar'), icon: 'write-off' as const, amount: money(open), run: () => writeOffInvoice(invoiceId) }]
          : []),
        ...(props.canRefund && !row.isRefund && (row.refundableCents ?? 0) > 0
          ? [{ key: 'refund', label: t('Refund…', 'Reembolsar…'), icon: 'refund' as const, run: () => openRefundModal(invoiceId, row.refundableCents ?? 0) }]
          : []),
      ],
    })
    push({
      key: 'delete',
      danger: true,
      actions: props.canDeleteInvoices ? [{ key: 'delete', label: t('Delete receipt', 'Eliminar recibo'), icon: 'trash', tone: 'danger', run: () => emit('deleteInvoice', invoiceId) }] : [],
    })
  }

  if (row.kind === 'credit' && props.spendableCreditCents > 0) {
    push({ key: 'credit', actions: [{ key: 'transfer', label: t('Transfer credit', 'Transferir crédito'), icon: 'transfer', run: openTransferCredit }] })
  }

  return groups
}
const rowActions = computed(() => Object.fromEntries(visibleRows.value.map((r) => [r.key, actionGroups(r)])))

function actionButtonClass(a: LedgerAction) {
  const base =
    'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-ctl border px-2.5 text-[12.5px] font-medium outline-none transition-colors focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 touch:h-10'
  if (a.tone === 'primary') return `${base} border-brand bg-brand text-brand-on hover:bg-brand-hover`
  if (a.tone === 'danger') return `${base} border-transparent text-danger-text hover:border-danger-border hover:bg-danger-bg`
  return `${base} border-line-control bg-surface text-ink-500 hover:border-line-controlHover hover:bg-surface-subtle`
}
function menuItemClass(a: LedgerAction) {
  const base = 'flex h-9 w-full items-center gap-2.5 rounded-ctlSm px-2.5 text-left text-[13px] outline-none disabled:opacity-50 touch:h-11'
  if (a.tone === 'primary') return `${base} font-semibold text-brand-text hover:bg-brand-tint focus-visible:bg-brand-tint`
  if (a.tone === 'danger') return `${base} text-danger-text hover:bg-danger-bg focus-visible:bg-danger-bg`
  return `${base} text-ink-700 hover:bg-surface-subtle focus-visible:bg-surface-subtle`
}

// --- The row's "…" menu -----------------------------------------------------
// Fixed to the viewport rather than absolute in its cell: the ledger scrolls
// inside a 420px box, and an absolute menu on one of the last rows opened
// below the box's edge and was clipped.
const rowMenuKey = ref<string | null>(null)
const rowMenuStyle = ref<Record<string, string>>({})
const rowMenuRoot = ref<HTMLElement | null>(null)
const rowMenuOpen = computed({
  get: () => rowMenuKey.value !== null,
  set: (open: boolean) => {
    if (!open) rowMenuKey.value = null
  },
})
useDismissOnOutside(rowMenuRoot, rowMenuOpen)
function setRowMenuRoot(key: string, el: unknown) {
  if (key === rowMenuKey.value) rowMenuRoot.value = el as HTMLElement | null
}
function toggleRowMenu(key: string, e: MouseEvent) {
  if (rowMenuKey.value === key) {
    rowMenuKey.value = null
    return
  }
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const viewport = document.documentElement
  const right = `${viewport.clientWidth - box.right}px`
  // Opens upwards when there is not room for a full menu below the button.
  rowMenuStyle.value = viewport.clientHeight - box.bottom < 320 && box.top > viewport.clientHeight - box.bottom ? { bottom: `${viewport.clientHeight - box.top + 4}px`, right } : { top: `${box.bottom + 4}px`, right }
  rowMenuKey.value = key
  nextTick(() => rowMenuRoot.value?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true }))
}
function runMenuAction(a: LedgerAction) {
  rowMenuKey.value = null
  a.run?.()
}
function onRowMenuKeydown(e: KeyboardEvent) {
  const items = Array.from(rowMenuRoot.value?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])
  if (items.length === 0) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  const go = (i: number) => {
    e.preventDefault()
    items[(i + items.length) % items.length]?.focus()
  }
  if (e.key === 'ArrowDown') go(at + 1)
  else if (e.key === 'ArrowUp') go(at - 1)
  else if (e.key === 'Home') go(0)
  else if (e.key === 'End') go(items.length - 1)
  else if (e.key === 'Tab') rowMenuKey.value = null
}
// A fixed menu stays where it opened while the ledger scrolls under it, so
// any scroll closes it.
function closeRowMenu() {
  rowMenuKey.value = null
}
onMounted(() => window.addEventListener('scroll', closeRowMenu, true))
onBeforeUnmount(() => window.removeEventListener('scroll', closeRowMenu, true))
// In the staff member's language. toLocaleDateString(undefined) took the
// browser's, so a Spanish front desk on an English-language Mac read "28 Oct".
const { formatShortDateYear } = useDates()
function formatDate(iso: string) {
  return formatShortDateYear(iso)
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
const refundModalOpen = ref(false)
const refundModalInvoiceId = ref<string | null>(null)
const refundModalPaymentId = ref<string | null>(null)
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
const { methods: paymentMethods, ensureLoaded: ensurePaymentMethodsLoaded, defaultMethod, labelFor: methodLabel } = usePaymentMethods()
// Which method the money physically went back through -- the account's own
// list, same as taking one. It used to offer card/cash/"Other (e.g. bank
// transfer)" and was the ONLY screen that mentioned bank transfer at all.
const refundMethod = ref<string>('card')

// The receipt's own Refund refunds no payment in particular, so it could never
// send anything back through GoCardless: a direct-debit membership refunded
// from its receipt was recorded, given its rectificativa, and the patient's
// bank never saw a cent of it. Only the payment row's Refund went through
// GoCardless, and nothing on the receipt said so. When GoCardless collected
// the receipt's money on its own, the receipt's Refund now IS that payment's
// refund. When the receipt was split with another method, there is no single
// payment to pick, so the modal says where the GoCardless part is refunded.
const refundReceiptGoCardless = ref(false)
function openRefundModal(invoiceId: string, maxCents: number) {
  const received = props.payments.filter((p) => p.invoice_id === invoiceId && p.amount_cents > 0 && isReceipt(p.method))
  const collected = received.filter((p) => props.gocardlessPaymentIds?.includes(p.id))
  const only = collected.length === 1 && received.length === 1 ? collected[0]! : null
  const onlyRefundable = only ? (rows.value.find((r) => r.paymentId === only.id)?.paymentRefundableCents ?? 0) : 0
  if (only && onlyRefundable > 0) {
    openPaymentRefundModal(only.id, invoiceId, Math.min(maxCents, onlyRefundable), only.method)
    return
  }
  refundReceiptGoCardless.value = collected.length > 0
  menuOpen.value = false
  ensurePaymentMethodsLoaded()
  refundModalOpen.value = true
  refundModalInvoiceId.value = invoiceId
  refundModalPaymentId.value = null
  refundMaxCents.value = maxCents
  refundAmount.value = (maxCents / 100).toFixed(2)
  refundReason.value = ''
  refundMethod.value = defaultMethod.value
}

// Refunding one payment. The method defaults to the one the money arrived on
// rather than the account default: sending EUR 20 back out by the route it
// came in is the ordinary case, and it is the whole reason this action exists
// -- the receipt-level refund can only offer a free choice, which is how
// "EUR 50 back to card" could be recorded against EUR 20 of card. Still a
// dropdown, because a card refund genuinely does sometimes go back as cash.
function openPaymentRefundModal(paymentId: string, invoiceId: string | null, maxCents: number, method: string) {
  refundReceiptGoCardless.value = false
  menuOpen.value = false
  ensurePaymentMethodsLoaded()
  refundModalOpen.value = true
  refundModalInvoiceId.value = invoiceId
  refundModalPaymentId.value = paymentId
  refundMaxCents.value = maxCents
  refundAmount.value = (maxCents / 100).toFixed(2)
  refundReason.value = ''
  refundMethod.value = method || defaultMethod.value
}

// Waits for `rows`, which are derived from invoices/payments loaded by the
// parent -- landing here from a deep link means arriving before they exist.
// Refuses silently if the receipt turns out not to be refundable after all
// (already refunded, voided, or no longer visible to this reader) rather than
// opening a modal capped at zero.
watch(
  [() => props.openRefundForInvoiceId, rows],
  ([invoiceId]) => {
    if (!invoiceId || !props.canRefund || refundModalOpen.value) return
    const row = rows.value.find((r) => r.invoiceId === invoiceId && !r.isRefund)
    if (!row || (row.refundableCents ?? 0) <= 0) return
    expandedKey.value = row.key
    openRefundModal(invoiceId, row.refundableCents ?? 0)
  },
  { immediate: true },
)

// Correcting how a payment came in -- taken as cash, really card. Changes
// nothing but the method: same amount, same date, same receipt, so the
// receipt never reopens and a factura issued for it still matches. Offered
// only for methods on the clinic's own list; a payment on a method since
// deactivated can still be moved OFF it, but the dropdown will not offer it
// back.
const methodModalPaymentId = ref<string | null>(null)
const methodModalCurrent = ref('')
const methodModalChoice = ref('')

function openMethodModal(paymentId: string, current: string) {
  ensurePaymentMethodsLoaded()
  methodModalPaymentId.value = paymentId
  methodModalCurrent.value = current
  methodModalChoice.value = current
}

function closeMethodModal() {
  methodModalPaymentId.value = null
}

function submitMethodChange() {
  if (!methodModalPaymentId.value || !methodModalChoice.value || methodModalChoice.value === methodModalCurrent.value) return
  emit('changePaymentMethod', { paymentId: methodModalPaymentId.value, method: methodModalChoice.value })
  closeMethodModal()
}

// Correcting the amount of a payment typed in wrongly -- 50 recorded, 40
// taken. correct_payment_amount() changes the payment and, when a factura was
// issued for it, issues a rectificativa for the difference naming it. The
// factura itself is never edited: a fiscal record is corrected by another
// one, so the reason is required -- it is printed on the rectificativa.
const amountModalPaymentId = ref<string | null>(null)
const amountModalCurrentCents = ref(0)
const amountModalValue = ref('')
const amountModalReason = ref('')

function openAmountModal(paymentId: string, currentCents: number) {
  amountModalPaymentId.value = paymentId
  amountModalCurrentCents.value = currentCents
  amountModalValue.value = (currentCents / 100).toFixed(2)
  amountModalReason.value = ''
}

function closeAmountModal() {
  amountModalPaymentId.value = null
}

const amountModalCents = computed(() => {
  const n = Number(String(amountModalValue.value).replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
})
const amountModalValid = computed(
  () => amountModalCents.value > 0 && amountModalCents.value !== amountModalCurrentCents.value && amountModalReason.value.trim().length > 0,
)

function submitAmountCorrection() {
  if (!amountModalPaymentId.value || !amountModalValid.value) return
  emit('correctPaymentAmount', { paymentId: amountModalPaymentId.value, amountCents: amountModalCents.value, reason: amountModalReason.value.trim() })
  closeAmountModal()
}

// A receipt that sold products (Settings > Products & stock): what can still
// come back to the shelf -- sold on it, less returned against it already --
// offered with the refund, all of it by default. Read from the receipt's own
// stock movements, which is what return_product_stock() checks too.
const refundProducts = ref<{ productId: string; name: string; returnable: number; units: number }[]>([])
watch(refundModalInvoiceId, async (invoiceId) => {
  refundProducts.value = []
  if (!invoiceId) return
  const { data } = await supabase
    .from('product_stock_movements')
    .select('product_id, kind, delta, services_products(name)')
    .eq('invoice_id', invoiceId)
    .in('kind', ['sale', 'return'])
  const byProduct = new Map<string, { name: string; returnable: number }>()
  for (const m of (data as unknown as { product_id: string; delta: number; services_products: { name: string } | null }[] | null) ?? []) {
    const p = byProduct.get(m.product_id) ?? { name: m.services_products?.name ?? '', returnable: 0 }
    p.returnable -= m.delta
    byProduct.set(m.product_id, p)
  }
  if (refundModalInvoiceId.value !== invoiceId) return
  refundProducts.value = [...byProduct.entries()].filter(([, p]) => p.returnable > 0).map(([productId, p]) => ({ productId, name: p.name, returnable: p.returnable, units: p.returnable }))
})

// A direct-debit payment GoCardless collected, refunded "via" direct debit:
// the money really goes back, through /api/gocardless/refunds/create.
const refundThroughGoCardless = computed(() => Boolean(refundModalPaymentId.value && refundMethod.value === 'direct_debit' && props.gocardlessPaymentIds?.includes(refundModalPaymentId.value)))

function closeRefundModal() {
  refundModalOpen.value = false
  refundModalInvoiceId.value = null
  refundModalPaymentId.value = null
}

function submitRefund() {
  if (!refundModalOpen.value) return
  const amountCents = Math.round((parseFloat(refundAmount.value) || 0) * 100)
  if (amountCents <= 0 || amountCents > refundMaxCents.value) return
  emit('refundInvoice', {
    invoiceId: refundModalInvoiceId.value,
    paymentId: refundModalPaymentId.value,
    amountCents,
    reason: refundReason.value,
    method: refundMethod.value,
    restock: refundProducts.value.map((p) => ({ productId: p.productId, units: Math.max(0, Math.min(p.returnable, Math.floor(Number(p.units) || 0))) })).filter((p) => p.units > 0),
  })
  closeRefundModal()
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
    transferError.value = t(
      `Enter an amount above 0, up to the ${formatEur(props.spendableCreditCents)} available.`,
      `Escribe un importe mayor que 0 y de hasta ${formatEur(props.spendableCreditCents)}, lo disponible.`,
    )
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
    statementMessage.value = e?.data?.statusMessage ?? e?.data?.message ?? t('Failed to send statement.', 'No se pudo enviar el extracto.')
  }
  statementSending.value = false
  setTimeout(() => (statementMessage.value = ''), 4000)
}

// Modal dialogs on this screen: focus stays inside while open, Escape closes,
// focus returns to what opened it (useFocusTrap, following each v-if).
const transferTitleId = useId()
const transferPanel = ref<HTMLElement | null>(null)
useFocusTrap(transferPanel, () => (transferModalOpen.value = false), () => transferModalOpen.value)
const methodTitleId = useId()
const methodPanel = ref<HTMLElement | null>(null)
useFocusTrap(methodPanel, closeMethodModal, () => !!methodModalPaymentId.value)
const amountTitleId = useId()
const amountPanel = ref<HTMLElement | null>(null)
useFocusTrap(amountPanel, closeAmountModal, () => !!amountModalPaymentId.value)
const refundTitleId = useId()
const refundPanel = ref<HTMLElement | null>(null)
useFocusTrap(refundPanel, closeRefundModal, () => refundModalOpen.value)

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()
</script>

<template>
  <section class="rounded-card border border-line bg-surface shadow-card" :aria-label="t('Account ledger', 'Libro de cuenta')">
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-3.5">
      <p class="text-[14.5px] font-semibold tracking-[-0.012em] text-ink-900">{{ t('Account ledger', 'Libro de cuenta') }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <!-- The ledger stays here, on the record, because "what does this
             person owe" is a patient-context question asked with the patient
             on the phone or at the desk. This is the way OUT to the clinic's
             receipt list scoped to them, for the rarer "show me all their
             paperwork" -- not a replacement for the ledger. -->
        <NuxtLink
          :to="`/billing?patient=${patientId}`"
          class="inline-flex h-8 items-center gap-1 rounded-ctl px-2 text-[12.5px] font-medium text-brand-text outline-none hover:text-brand-hover focus-visible:shadow-focus touch:h-10"
        >
          {{ t('All receipts', 'Todos los recibos') }}
          <PatientsLedgerIcon name="chevron" class="h-3.5 w-3.5" />
        </NuxtLink>
        <span v-if="statementMessage" class="text-[12px] text-ink-faint">{{ statementMessage }}</span>
        <!-- Secondary, not primary: the Owed now card above already carries
             this screen's one primary action, Cobrar. -->
        <UiBtn size="sm" @click="newInvoice">{{ t('New receipt', 'Nuevo recibo') }}</UiBtn>
        <UiBtn v-if="canTakePayments" size="sm" @click="takePayment">{{ t('New payment', 'Nuevo pago') }}</UiBtn>
        <div ref="menuRoot" class="relative">
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-ctl border border-line-control bg-surface text-ink-500 outline-none hover:border-line-controlHover hover:bg-surface-subtle focus-visible:shadow-focus touch:h-10 touch:w-10"
            :class="menuOpen ? 'border-line-controlHover bg-chip-bg' : ''"
            data-cy="ledger-menu"
            :aria-label="t('More actions', 'Más acciones')"
            :aria-expanded="menuOpen"
            @click="menuOpen = !menuOpen"
          >
            <PatientsLedgerIcon name="dots" class="h-[18px] w-[18px]" />
          </button>
          <div v-if="menuOpen" class="absolute right-0 z-10 mt-1 w-52 rounded-ctl border border-line bg-surface p-1 shadow-popover">
            <button v-if="canTakePayments" type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left text-[13px] text-ink-700 hover:bg-surface-subtle" @click="addCredit">{{ t('Add credit', 'Añadir crédito') }}</button>
            <button v-if="spendableCreditCents > 0" type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left text-[13px] text-ink-700 hover:bg-surface-subtle" @click="openTransferCredit">
              {{ t('Transfer credit', 'Transferir crédito') }}
            </button>
            <div v-if="canTakePayments || spendableCreditCents > 0" class="my-1 border-t border-line-divider"></div>
            <button type="button" class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left text-[13px] text-ink-700 hover:bg-surface-subtle" @click="downloadStatement">{{ t('Download statement', 'Descargar extracto') }}</button>
            <button
              type="button"
              class="block w-full rounded-ctlSm px-2.5 py-1.5 text-left text-[13px] text-ink-700 hover:bg-surface-subtle disabled:opacity-50"
              data-cy="send-statement"
              :disabled="statementSending || contactBlocked"
              :title="contactBlocked ? t('Not sent to a patient who is under age or marked do not contact', 'No se envía a un paciente menor de edad o marcado como no contactar') : undefined"
              @click="sendStatement"
            >
              {{ statementSending ? t('Sending…', 'Enviando…') : t('Send statement', 'Enviar extracto') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="rows.length > 0" class="px-4 pb-3">
      <div role="group" :aria-label="t('Show', 'Mostrar')" class="inline-flex max-w-full flex-wrap gap-0.5 rounded-ctl bg-chip-bg p-[3px]">
        <button
          v-for="f in filters"
          :key="f.key"
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-ctlSm px-2.5 text-[12.5px] font-medium outline-none focus-visible:shadow-focus touch:h-9"
          :class="filter === f.key ? 'bg-surface text-ink-700 shadow-card ring-1 ring-line' : 'text-ink-muted hover:text-ink-700'"
          :aria-pressed="filter === f.key"
          :data-cy="`ledger-filter-${f.key}`"
          @click="filter = f.key"
        >
          {{ f.label }}
          <span class="font-mono text-[11.5px] text-ink-faint">{{ f.count }}</span>
        </button>
      </div>
    </div>

    <div v-if="rows.length === 0" class="border-t border-line-divider p-8 text-center text-[13px] text-ink-faint">{{ t('Nothing on this account yet.', 'Aún no hay movimientos en esta cuenta.') }}</div>
    <!-- Scrolls sideways on a phone rather than squeezing every column:
         squeezed, "PAY-11" broke after the hyphen and each date took two
         lines. The actions column stays pinned to the right edge, so the
         "…" button is reachable without scrolling across. -->
    <div v-else class="max-h-[460px] overflow-auto border-t border-line">
      <table class="w-full min-w-[760px] text-[13px]">
        <thead class="sticky top-0 z-[1] border-b border-line-divider bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">
          <tr>
            <th class="py-2 pl-4 pr-2 font-[640]"><span class="pl-6">{{ t('Entry', 'Concepto') }}</span></th>
            <th class="w-[112px] px-2 py-2 font-[640]">{{ t('Date', 'Fecha') }}</th>
            <th class="w-[104px] px-2 py-2 text-right font-[640]">{{ t('Debit', 'Debe') }}</th>
            <th class="w-[104px] px-2 py-2 text-right font-[640]">{{ t('Credit', 'Haber') }}</th>
            <th class="w-[184px] px-3 py-2 font-[640]">{{ t('Status', 'Estado') }}</th>
            <th class="sticky right-0 w-[56px] bg-surface-subtle py-2 pl-2 pr-4"><span class="sr-only">{{ t('Actions', 'Acciones') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="visibleRows.length === 0">
            <td colspan="6" class="p-6 text-center text-[13px] text-ink-faint">{{ t('Nothing of this kind on this account.', 'No hay movimientos de este tipo en esta cuenta.') }}</td>
          </tr>
          <template v-for="row in visibleRows" :key="row.key">
            <tr
              class="group cursor-pointer border-t border-line-row first:border-t-0"
              :class="expandedKey === row.key ? 'bg-surface-subtle' : 'hover:bg-surface-subtle'"
              @click="toggleExpanded(row.key)"
            >
              <td class="py-2 pl-4 pr-2">
                <!-- The whole row toggles on click; this button is what a
                     keyboard and a screen reader reach it by. Its click
                     bubbles to the row, so it carries no handler of its own. -->
                <button type="button" class="flex w-full min-w-0 items-center gap-2.5 rounded-ctlSm text-left outline-none focus-visible:shadow-focus" :aria-expanded="expandedKey === row.key">
                  <PatientsLedgerIcon name="chevron" class="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform" :class="expandedKey === row.key ? 'rotate-90' : ''" />
                  <span class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-ctlSm" :class="[KIND_TILE[row.kind].tone, row.voided ? 'opacity-60' : '']">
                    <PatientsLedgerIcon :name="KIND_TILE[row.kind].icon" class="h-4 w-4" />
                  </span>
                  <span class="flex min-w-0 flex-col" :class="row.voided ? 'opacity-60' : ''">
                    <span class="font-medium text-ink-700">{{ row.description }}</span>
                    <span class="truncate text-[11.5px] text-ink-faint" :title="[row.ref, row.sub, row.note].filter(Boolean).join(' · ')"><span class="font-mono">{{ row.ref }}</span><template v-if="row.sub"> · {{ row.sub }}</template><template v-if="row.note"> · {{ row.note }}</template></span>
                  </span>
                </button>
              </td>
              <td class="whitespace-nowrap px-2 text-[12.5px] text-ink-muted" :class="row.voided ? 'opacity-60' : ''">{{ formatDate(row.date) }}</td>
              <td data-cy="ledger-debit" class="whitespace-nowrap px-2 text-right font-mono" :class="row.noMoneyMoved ? 'text-ink-faint' : row.voided ? 'text-ink-faint' : 'text-ink-700'">{{ row.noMoneyMoved ? '—' : row.debitCents > 0 ? money(row.debitCents) : '' }}</td>
              <td data-cy="ledger-credit" class="whitespace-nowrap px-2 text-right font-mono" :class="row.noMoneyMoved ? 'text-ink-faint' : 'text-success-text'">{{ row.noMoneyMoved ? '—' : row.creditCents > 0 ? money(row.creditCents) : '' }}</td>
              <td class="px-3">
                <UiPill :tone="row.statusTone" :dot="row.statusDot" :title="row.statusTitle">{{ row.statusText }}</UiPill>
              </td>
              <!-- Pinned right with its own background, so on a narrow
                   screen it sits over the columns scrolled beneath it.
                   .stop on everything in it: a click here is never "open
                   this row".
                   A sticky cell is its own stacking context, so the menu's
                   z-index only counts inside it: without z-20 on the open
                   row's cell, every later row's pinned cell painted over the
                   menu's right-hand side. -->
              <td
                class="sticky right-0 py-2 pl-2 pr-4 text-right"
                :class="[expandedKey === row.key ? 'bg-surface-subtle' : 'bg-surface group-hover:bg-surface-subtle', rowMenuKey === row.key ? 'z-20' : '']"
                @click.stop
              >
                <div v-if="rowActions[row.key]?.length" :ref="(el) => setRowMenuRoot(row.key, el)" class="inline-block">
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-ctl border border-line-control bg-surface text-ink-500 outline-none hover:border-line-controlHover hover:bg-surface-subtle focus-visible:shadow-focus touch:h-10 touch:w-10"
                    :class="rowMenuKey === row.key ? 'border-line-controlHover bg-chip-bg' : ''"
                    data-cy="ledger-row-actions"
                    aria-haspopup="menu"
                    :aria-expanded="rowMenuKey === row.key"
                    :aria-label="`${t('Actions for', 'Acciones de')} ${row.ref}`"
                    @click="toggleRowMenu(row.key, $event)"
                  >
                    <PatientsLedgerIcon name="dots" class="h-[18px] w-[18px]" />
                  </button>
                  <div
                    v-if="rowMenuKey === row.key"
                    role="menu"
                    :aria-label="`${t('Actions for', 'Acciones de')} ${row.ref}`"
                    class="fixed z-30 w-64 rounded-ctl border border-line bg-surface p-1.5 text-left shadow-popover"
                    :style="rowMenuStyle"
                    @keydown="onRowMenuKeydown"
                  >
                    <p class="flex items-center justify-between px-2.5 pb-1.5 pt-1 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">
                      <span class="truncate">{{ row.description }}</span>
                      <span class="font-mono normal-case tracking-normal">{{ row.ref }}</span>
                    </p>
                    <template v-for="(g, gi) in rowActions[row.key]" :key="g.key">
                      <div v-if="gi > 0" role="separator" class="mx-1 my-1 border-t border-line-divider"></div>
                      <template v-for="a in g.actions" :key="a.key">
                        <NuxtLink v-if="a.to" role="menuitem" :to="a.to" :class="menuItemClass(a)" @click="rowMenuKey = null">
                          <PatientsLedgerIcon :name="a.icon" class="h-4 w-4 shrink-0 text-ink-muted" />{{ a.label }}
                        </NuxtLink>
                        <p v-else-if="a.textOnly" class="px-2.5 py-2 text-[12.5px] text-ink-faint">{{ a.label }}</p>
                        <button v-else type="button" role="menuitem" :disabled="a.disabled" :class="menuItemClass(a)" @click="runMenuAction(a)">
                          <PatientsLedgerIcon :name="a.icon" class="h-4 w-4 shrink-0" :class="a.tone ? '' : 'text-ink-muted'" />
                          <span>{{ a.label }}</span>
                          <span v-if="a.amount" class="ml-auto font-mono text-[12px] opacity-80">{{ ` ${a.amount}` }}</span>
                        </button>
                      </template>
                    </template>
                  </div>
                </div>
              </td>
            </tr>
            <tr v-if="expandedKey === row.key">
              <td colspan="6" class="bg-surface-subtle pb-4 pl-[74px] pr-4 pt-0.5" data-cy="ledger-row-detail">
                <dl class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-7 gap-y-2.5">
                  <div v-for="(d, i) in row.detail" :key="i" class="min-w-0">
                    <dt class="text-[11px] font-medium text-ink-faint">{{ d.label }}</dt>
                    <dd class="mt-0.5 break-words text-[13px] text-ink-700">{{ d.value }}</dd>
                  </div>
                </dl>
                <div v-if="rowActions[row.key]?.length" class="mt-3.5 flex flex-wrap items-start gap-2.5 border-t border-line pt-3.5">
                  <template v-for="(g, gi) in rowActions[row.key]" :key="g.key">
                    <span v-if="gi > 0 && !g.danger" class="mt-1.5 h-5 w-px shrink-0 bg-line-control" aria-hidden="true"></span>
                    <div class="flex flex-col gap-1.5" :class="g.danger ? 'ml-auto items-end' : ''">
                      <div class="flex flex-wrap items-center gap-2">
                        <template v-for="a in g.actions" :key="a.key">
                          <NuxtLink v-if="a.to" :to="a.to" :class="actionButtonClass(a)">
                            <PatientsLedgerIcon :name="a.icon" class="h-4 w-4 shrink-0 text-ink-muted" />{{ a.label }}
                          </NuxtLink>
                          <span v-else-if="a.textOnly" class="inline-flex h-8 items-center text-[12px] text-ink-faint touch:h-10">{{ a.label }}</span>
                          <button v-else type="button" :disabled="a.disabled" :data-cy="a.dataCy" :class="actionButtonClass(a)" @click="a.run?.()">
                            <PatientsLedgerIcon :name="a.icon" class="h-4 w-4 shrink-0" :class="a.tone ? '' : 'text-ink-muted'" />
                            <span>{{ a.label }}</span>
                            <!-- The space is inside the expression on purpose: a
                                 leading literal space here is trimmed by the
                                 template compiler, and the button's text then
                                 reads "Refund…45,00 €" to a screen reader and
                                 to anything matching on it. -->
                            <span v-if="a.amount" class="font-mono text-[12px]">{{ ` ${a.amount}` }}</span>
                          </button>
                        </template>
                      </div>
                      <p v-if="g.hint" class="max-w-[300px] text-[11.5px] leading-snug text-ink-faint" :class="g.danger ? 'text-right' : ''">{{ g.hint }}</p>
                    </div>
                  </template>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <!-- The footer states the bono rule once, so a reader who meets an
      em-dash row anywhere in the table has somewhere to resolve it, and
      says what is on screen versus what is owed. -->
      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <p class="text-[11.5px] text-ink-faint">
          {{ visibleRows.length }} {{ visibleRows.length === 1 ? t('entry', 'movimiento') : t('entries', 'movimientos') }}
          <template v-if="hasNoMoneyRows">
            · {{ t('A bono visit shows — in both columns: the money moved when the bono was bought.', 'Una visita de bono muestra — en ambas columnas: el dinero se movió al comprar el bono.') }}
          </template>
        </p>
        <p class="inline-flex items-center gap-1.5 rounded-ctl px-2.5 py-1 text-[12.5px] font-semibold" :class="outstandingCents > 0 ? 'bg-danger-bg text-danger-text' : 'text-ink-muted'">
          {{ t('Outstanding', 'Pendiente') }} <span class="font-mono">{{ money(outstandingCents) }}</span>
        </p>
      </div>
    </div>
  </section>

  <div v-if="transferModalOpen" class="fixed inset-0 z-20 flex items-center justify-center bg-scrim/40 p-4" @click.self="transferModalOpen = false">
    <div ref="transferPanel" role="dialog" aria-modal="true" :aria-labelledby="transferTitleId" class="max-h-full w-full max-w-sm overflow-y-auto rounded-card border border-line bg-surface p-4 shadow-popover">
      <p :id="transferTitleId" class="text-[13.5px] font-semibold text-ink-700">{{ t('Transfer credit', 'Transferir crédito') }}</p>
      <p class="mt-1 text-[12px] text-ink-faint">{{ t('Moves an amount from this patient\'s credit', 'Mueve un importe del crédito de este paciente') }} ({{ formatEur(spendableCreditCents) }} {{ t('available', 'disponible') }}) {{ t('to another patient\'s account.', 'a la cuenta de otro paciente.') }}</p>

      <div class="mt-3">
        <label class="block text-[11px] text-ink-muted">{{ t('To patient', 'Al paciente') }}</label>
        <div v-if="transferTarget" class="mt-0.5 flex items-center justify-between rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]">
          <span>{{ transferTarget.first_name }} {{ transferTarget.last_name }}</span>
          <button type="button" :aria-label="t('Choose another patient', 'Elegir otro paciente')" class="flex h-6 w-6 shrink-0 items-center justify-center rounded-ctlSm text-ink-faint outline-none hover:text-danger-text focus-visible:shadow-focus touch:h-10 touch:w-10" @click="transferTarget = null"><UiCloseIcon /></button>
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
        <label :for="`${fieldId}-transferAmount`" class="block text-[11px] text-ink-muted">{{ t('Amount (€)', 'Importe (€)') }}</label>
        <input :id="`${fieldId}-transferAmount`" v-model="transferAmount" type="number" min="0" step="0.01" class="mt-0.5 w-32 rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]" />
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

  <div v-if="methodModalPaymentId" class="fixed inset-0 z-20 flex items-center justify-center bg-scrim/40 p-4" @click.self="closeMethodModal">
    <div ref="methodPanel" role="dialog" aria-modal="true" :aria-labelledby="methodTitleId" class="max-h-full w-full max-w-sm overflow-y-auto rounded-card border border-line bg-surface p-4 shadow-popover" data-cy="payment-method-modal">
      <p :id="methodTitleId" class="text-[13.5px] font-semibold text-ink-700">{{ t('Change payment method', 'Cambiar método de pago') }}</p>
      <p class="mt-1 text-[12px] text-ink-faint">
        {{
          t(
            'For a payment recorded with the wrong method. The amount, date and receipt stay as they are; the change is logged with your name.',
            'Para un pago registrado con el método equivocado. El importe, la fecha y el recibo no cambian; el cambio queda registrado con tu nombre.',
          )
        }}
      </p>
      <div class="mt-3">
        <label :for="`${fieldId}-methodModalChoice`" class="block text-[11px] text-ink-muted">{{ t('Paid with', 'Pagado con') }}</label>
        <select :id="`${fieldId}-methodModalChoice`" v-model="methodModalChoice" data-cy="payment-method-select" class="bg-surface mt-0.5 w-full rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]">
          <option v-if="!paymentMethods.some((m) => m.key === methodModalCurrent)" :value="methodModalCurrent" disabled>{{ methodModalCurrent }}</option>
          <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
        </select>
      </div>
      <div class="mt-4 flex items-center justify-end gap-2">
        <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="closeMethodModal">{{ t('Cancel', 'Cancelar') }}</button>
        <UiBtn variant="primary" size="sm" data-cy="payment-method-save" :disabled="!methodModalChoice || methodModalChoice === methodModalCurrent" @click="submitMethodChange">
          {{ t('Save', 'Guardar') }}
        </UiBtn>
      </div>
    </div>
  </div>

  <div v-if="amountModalPaymentId" class="fixed inset-0 z-20 flex items-center justify-center bg-scrim/40 p-4" @click.self="closeAmountModal">
    <div ref="amountPanel" role="dialog" aria-modal="true" :aria-labelledby="amountTitleId" class="max-h-full w-full max-w-sm overflow-y-auto rounded-card border border-line bg-surface p-4 shadow-popover" data-cy="payment-amount-modal">
      <p :id="amountTitleId" class="text-[13.5px] font-semibold text-ink-700">{{ t('Correct payment amount', 'Corregir importe del pago') }}</p>
      <p class="mt-1 text-[12px] text-ink-faint">
        {{
          t(
            'For a payment recorded with the wrong amount. If a factura was issued for it, a rectifying factura is issued for the difference; the original factura does not change. If money went back to the patient, record a refund instead.',
            'Para un pago registrado con un importe equivocado. Si se emitió factura, se emite una factura rectificativa por la diferencia; la factura original no cambia. Si se devolvió dinero al paciente, registra un reembolso.',
          )
        }}
      </p>
      <div class="mt-3">
        <label :for="`${fieldId}-amountModalValue`" class="block text-[11px] text-ink-muted">
          {{ t(`Amount actually received (recorded: ${money(amountModalCurrentCents)})`, `Importe cobrado de verdad (registrado: ${money(amountModalCurrentCents)})`) }}
        </label>
        <input
          :id="`${fieldId}-amountModalValue`"
          v-model="amountModalValue"
          type="number"
          min="0.01"
          step="0.01"
          data-cy="payment-amount-input"
          class="mt-0.5 w-32 rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]"
        />
      </div>
      <div class="mt-3">
        <label :for="`${fieldId}-amountModalReason`" class="block text-[11px] text-ink-muted">{{ t('Reason (on the rectifying factura)', 'Motivo (aparece en la rectificativa)') }}</label>
        <input
          :id="`${fieldId}-amountModalReason`"
          v-model="amountModalReason"
          type="text"
          maxlength="200"
          data-cy="payment-amount-reason"
          :placeholder="t('e.g. typed 50 instead of 40', 'p. ej. se registró 50 en vez de 40')"
          class="mt-0.5 w-full rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]"
        />
      </div>
      <p v-if="amountModalCents > 0 && amountModalCents !== amountModalCurrentCents" class="mt-2 text-[12px] text-ink-muted">
        {{
          t(
            `Difference: ${amountModalCents > amountModalCurrentCents ? '+' : '−'}${money(Math.abs(amountModalCents - amountModalCurrentCents))}`,
            `Diferencia: ${amountModalCents > amountModalCurrentCents ? '+' : '−'}${money(Math.abs(amountModalCents - amountModalCurrentCents))}`,
          )
        }}
      </p>
      <div class="mt-4 flex items-center justify-end gap-2">
        <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="closeAmountModal">{{ t('Cancel', 'Cancelar') }}</button>
        <UiBtn variant="primary" size="sm" data-cy="payment-amount-save" :disabled="!amountModalValid" @click="submitAmountCorrection">
          {{ t('Correct amount', 'Corregir importe') }}
        </UiBtn>
      </div>
    </div>
  </div>

  <div v-if="refundModalOpen" class="fixed inset-0 z-20 flex items-center justify-center bg-scrim/40 p-4" @click.self="closeRefundModal">
    <div ref="refundPanel" role="dialog" aria-modal="true" :aria-labelledby="refundTitleId" class="max-h-full w-full max-w-sm overflow-y-auto rounded-card border border-line bg-surface p-4 shadow-popover">
      <p :id="refundTitleId" class="text-[13.5px] font-semibold text-ink-700">{{ t('Refund', 'Reembolso') }}</p>
      <p v-if="refundThroughGoCardless" class="mt-1 text-[12px] text-ink-muted2" data-cy="refund-through-gocardless">
        {{ t("Sends the money back to the patient's bank through GoCardless, then records the refund and its rectifying invoice here. If GoCardless refuses, nothing is recorded.", 'Devuelve el dinero al banco del paciente a través de GoCardless y después registra aquí el reembolso y su factura rectificativa. Si GoCardless lo rechaza, no se registra nada.') }}
      </p>
      <p v-else class="mt-1 text-[12px] text-ink-faint">
        {{
          refundModalPaymentId
            ? t(
                "Records a refund against this one payment and reduces the patient's balance -- doesn't call any real refund API, so process the actual refund (cash, Stripe, etc.) separately.",
                'Registra un reembolso contra este pago concreto y reduce el saldo del paciente -- no llama a ninguna API de reembolso real, así que procesa el reembolso real (efectivo, Stripe, etc.) por separado.',
              )
            : t(
                "Records a refund against this invoice and reduces the patient's balance -- doesn't call any real refund API, so process the actual refund (cash, Stripe, etc.) separately.",
                'Registra un reembolso contra esta factura y reduce el saldo del paciente -- no llama a ninguna API de reembolso real, así que procesa el reembolso real (efectivo, Stripe, etc.) por separado.',
              )
        }}
      </p>

      <div class="mt-3">
        <label :for="`${fieldId}-refundAmount`" class="block text-[11px] text-ink-muted">{{ t(`Amount (€), up to ${money(refundMaxCents)}`, `Importe (€), hasta ${money(refundMaxCents)}`) }}</label>
        <input :id="`${fieldId}-refundAmount`" v-model="refundAmount" type="number" min="0" :max="refundMaxCents / 100" step="0.01" class="mt-0.5 w-32 rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]" />
      </div>
      <div class="mt-3">
        <label :for="`${fieldId}-refundMethod`" class="block text-[11px] text-ink-muted">{{ t('Refunded via', 'Reembolsado vía') }}</label>
        <select :id="`${fieldId}-refundMethod`" v-model="refundMethod" class="bg-surface mt-0.5 w-full rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]">
          <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
        </select>
        <p v-if="refundReceiptGoCardless && refundMethod === 'direct_debit'" class="mt-1.5 text-[11.5px] text-warning-text" data-cy="refund-receipt-gocardless">
          {{ t("This receipt was paid partly through GoCardless, so this only records the refund. To send the money back through GoCardless, refund the direct-debit payment's own row.", 'Este recibo se pagó en parte con GoCardless, así que esto solo registra el reembolso. Para devolver el dinero a través de GoCardless, reembolsa desde la fila del pago por domiciliación.') }}
        </p>
      </div>
      <div v-if="refundProducts.length" class="mt-3" data-cy="refund-restock">
        <p class="text-[11px] text-ink-muted">{{ t('Back to stock (units)', 'Vuelve al stock (unidades)') }}</p>
        <label v-for="p in refundProducts" :key="p.productId" class="mt-1 flex items-center justify-between gap-2 text-[13px] text-ink-700">
          <span class="min-w-0 truncate">{{ p.name }}</span>
          <span class="flex items-center gap-1.5">
            <input v-model.number="p.units" type="number" min="0" :max="p.returnable" class="w-16 rounded-ctlSm border border-line-control px-2 py-1 text-right text-[13px]" :data-cy="`refund-restock-${p.name}`" />
            <span class="text-[12px] text-ink-faint">/ {{ p.returnable }}</span>
          </span>
        </label>
        <p class="mt-1 text-[11.5px] text-ink-faint">{{ t('0 if it is not coming back (opened, broken).', '0 si no vuelve (abierto, roto).') }}</p>
      </div>
      <div class="mt-3">
        <label :for="`${fieldId}-refundReason`" class="block text-[11px] text-ink-muted">{{ t('Reason (optional)', 'Motivo (opcional)') }}</label>
        <input :id="`${fieldId}-refundReason`"
          v-model="refundReason"
          type="text"
          class="mt-0.5 w-full rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]"
          :placeholder="t('e.g. patient cancelled the bono', 'p. ej. el paciente canceló el bono')"
        />
      </div>

      <div class="mt-4 flex items-center justify-end gap-2">
        <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="closeRefundModal">{{ t('Cancel', 'Cancelar') }}</button>
        <UiBtn
          variant="primary"
          size="sm"
          :disabled="!refundAmount || Math.round((parseFloat(refundAmount) || 0) * 100) <= 0 || Math.round((parseFloat(refundAmount) || 0) * 100) > refundMaxCents"
          @click="submitRefund"
        >
          {{ t('Refund', 'Reembolsar') }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>
