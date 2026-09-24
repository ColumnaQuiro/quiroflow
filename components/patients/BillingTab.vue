<script setup lang="ts">
import { formatEur, formatLongDate } from '~/utils/billing'
import { normalizeSearchTerm } from '~/utils/searchText'
import { bonoOwedCents } from '~/utils/bonoOwed'
import { settleInvoiceIfCovered } from '~/utils/settleInvoice'

const props = defineProps<{ patientId: string; openPaymentTrigger?: boolean; refundInvoiceId?: string | null }>()
const emit = defineEmits<{ paymentTriggerConsumed: [] }>()

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
interface PackagePurchaseRow {
  id: string
  package_name: string
  sessions_total: number
  sessions_used: number
  price_cents: number
  purchased_at: string
  invoice_id: string | null
  // What PracticeHub said was still outstanding on this bono when it was
  // imported (0174). Null on a bono created here, where the invoice is the
  // record of what is owed.
  owed_cents: number | null
  // PracticeHub has deactivated this bono. It keeps whatever was on its
  // counter, and it is still listed here -- the visits it paid for are real
  // history -- but it is not money the patient can draw on and no session
  // comes off it. See the is_closed migration.
  is_closed?: boolean
  // Set only for a bono shared TO this patient (they're a beneficiary, not
  // the owner) -- see loadPackages(). Owner-only actions (Share, Delete,
  // collecting payment against the owner's own invoice) are hidden for
  // these; only using a session is something a beneficiary can do too.
  shared?: boolean
  ownerName?: string
}
interface PatientMembershipRow {
  id: string
  membership_name: string
  price_cents: number
  status: string
  started_at: string
}
interface MembershipPaymentRow {
  id: string
  patient_membership_id: string
  period_start: string
  amount_cents: number
  status: string
}
interface StripeCustomerRow { stripe_customer_id: string; default_payment_method_id: string | null }
interface PaymentScheduleRow {
  id: string
  package_purchase_id: string | null
  patient_membership_id: string | null
  interval: string
  interval_count: number
  installments_total: number | null
  installments_paid: number
  status: string
}
interface StripeEventRow { id: string; payment_schedule_id: string; period_start: string; amount_cents: number; status: string }
interface LedgerPaymentRow { id: string; invoice_id: string | null; amount_cents: number; method: string; paid_at: string; package_purchase_id: string | null; external_reference: string | null; purpose: string | null; created_by: string | null; stripe_payment_intent_id: string | null; team_members: { full_name: string | null } | null }
interface LedgerCreditRow { id: string; amount_cents: number; reason: string | null; method: string | null; invoice_id: string | null; created_at: string }

const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const { fire } = useAutomations()
const t = useT()

// outstandingCents is what "Owed now" shows. It was computed here as
// -balanceCents, which made this one card contradict itself: it printed
// "174,00 EUR" directly above "Nothing outstanding.", because oldestUnpaid
// below was already reading invoice status while the figure above it was
// reading paid-minus-invoiced. See utils/owing.ts.
const { balanceCents, outstandingCents, creditLedgerCents, bonoValueCents, lifetimeCents, refresh: refreshCreditSummary } =
  usePatientFinancialSummary(() => props.patientId)
const { issueFactura, issueRectificativa } = useFacturas()
const { methods: paymentMethods, ensureLoaded: ensurePaymentMethodsLoaded, defaultMethod } = usePaymentMethods()

// The documents the patient has actually been given, as opposed to the charges
// that drive their balance. Kept as its own list rather than mixed into the
// ledger: one is a fiscal record and the other is arithmetic, and the whole
// point of separating them was that conflating the two is what caused the
// confusion in the first place.
interface FacturaRow {
  id: string
  number: string
  kind: string
  description: string
  amount_cents: number
  issued_at: string
  recipient_nif: string | null
  // Null once the payment this documented has been deleted. The factura still
  // stands -- a number issued in a correlative series cannot just disappear --
  // but it no longer matches any money, which someone has to resolve.
  payment_id: string | null
}
const facturas = ref<FacturaRow[]>([])
const sendingFacturaId = ref('')
const facturaSendResult = ref<Record<string, string>>({})

async function loadFacturas() {
  const { data: patientRow } = await supabase.from('patients').select('national_id, default_practitioner_id').eq('id', props.patientId).maybeSingle()
  patientNationalId.value = patientRow?.national_id ?? null
  patientDefaultPractitionerId.value = patientRow?.default_practitioner_id ?? null
  const { data } = await supabase
    .from('facturas')
    .select('id, number, kind, description, amount_cents, issued_at, recipient_nif, payment_id')
    .eq('patient_id', props.patientId)
    .order('issued_at', { ascending: false })
  facturas.value = data ?? []
}

async function sendFactura(id: string) {
  sendingFacturaId.value = id
  try {
    await useStaffFetch(`/api/facturas/${id}/send`, { method: 'POST' })
    facturaSendResult.value = { ...facturaSendResult.value, [id]: t('Sent', 'Enviada') }
  } catch (e: any) {
    facturaSendResult.value = { ...facturaSendResult.value, [id]: e?.data?.statusMessage ?? t('Failed', 'Error') }
  }
  sendingFacturaId.value = ''
}

// A full invoice needs a NIF. It is deliberately not collected at the counter
// -- nothing should stop a payment being taken -- so this is where reception
// is told it is still missing, and the document picks it up the moment it is
// added to the patient record.
const patientNationalId = ref<string | null>(null)
// Who a logged session belongs to when it has to invent the visit.
const patientDefaultPractitionerId = ref<string | null>(null)
const facturasMissingNif = computed(() =>
  patientNationalId.value ? [] : facturas.value.filter((f) => f.kind === 'full' && !f.recipient_nif),
)
const { packageTemplates, membershipTemplates, ensureLoaded: ensureBillingTemplatesLoaded } = useBillingTemplates()
const addCreditAmount = ref('')
const addCreditReason = ref('')
const addCreditMethod = ref<string>('cash')
const addingCredit = ref(false)
const applyCreditInvoiceId = ref('')
const applyCreditAmount = ref('')
const applyingCredit = ref(false)
const creditError = ref('')

// Which quick-action panel (if any) is expanded below the summary strip.
const activePanel = ref<'credit' | 'payment' | null>(null)

async function addCredit() {
  const amountCents = Math.round((parseFloat(addCreditAmount.value) || 0) * 100)
  if (amountCents <= 0) return
  creditError.value = ''
  addingCredit.value = true
  // Money in is a payment, and a payment gets a factura -- whatever the
  // method, whatever the reason. This used to write the credit row alone, so
  // cash handed over here reached no payments ledger and no fiscal document:
  // Alonso Varela's 150 EUR came in this way and had neither. The gap then
  // compounded, because spending that credit issues no factura either, on the
  // stated grounds that the money "was already documented when it was paid
  // in" -- which only becomes true now.
  //
  // The credit row is still what the patient can draw on; the payment is the
  // record that the money arrived.
  const { data: creditPayment } = await supabase
    .from('payments')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      invoice_id: null,
      amount_cents: amountCents,
      method: addCreditMethod.value,
      purpose: 'on_account' as const,
    })
    .select('id')
    .single()
  await supabase.from('account_credits').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    amount_cents: amountCents,
    reason: addCreditReason.value || null,
    method: addCreditMethod.value,
    // The row restates the payment above rather than adjusting anything, and
    // says so -- otherwise the balance counts the same euros twice, once as
    // money in and once as credit. See the column comment.
    payment_id: creditPayment?.id ?? null,
    created_by: store.teamMember?.id ?? null,
  })
  if (creditPayment) {
    await issueFactura({
      accountId: store.accountId!,
      patientId: props.patientId,
      paymentId: creditPayment.id,
      amountCents,
      purpose: 'on_account',
    })
  }
  addCreditAmount.value = ''
  addCreditReason.value = ''
  addCreditMethod.value = 'cash'
  addingCredit.value = false
  activePanel.value = null
  await Promise.all([loadAll(), refreshCreditSummary(), loadFacturas()])
}

async function applyCreditToInvoice() {
  const invoice = invoices.value.find((i) => i.id === applyCreditInvoiceId.value)
  if (!invoice) return
  const amountCents = Math.round((parseFloat(applyCreditAmount.value) || 0) * 100)
  if (amountCents <= 0 || amountCents > spendableCreditCents.value) {
    creditError.value = t('Amount must be positive and not exceed available credit.', 'El importe debe ser positivo y no superar el crédito disponible.')
    return
  }
  creditError.value = ''
  applyingCredit.value = true

  await supabase.from('payments').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    invoice_id: invoice.id,
    amount_cents: amountCents,
    method: 'credit',
  })
  await supabase.from('account_credits').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    amount_cents: -amountCents,
    reason: `Applied to invoice ${invoice.invoice_number}`,
    invoice_id: invoice.id,
    created_by: store.teamMember?.id ?? null,
  })

  await settleInvoiceIfCovered(supabase, invoice.id)

  applyCreditInvoiceId.value = ''
  applyCreditAmount.value = ''
  applyingCredit.value = false
  await Promise.all([refreshCreditSummary(), loadAll()])
}

// -- Take a payment against an unpaid invoice (cash/card/credit, optionally
// split across several methods in one go -- e.g. part cash, part card) -----
const paymentInvoiceId = ref('')
const takingPayment = ref(false)
const paymentError = ref('')
const { rows: paymentRows, reset: resetPaymentRows, addRow: addPaymentRow, removeRow: removePaymentRow, centsOf: paymentRowCents, totalCents: paymentTotalCents, creditCents: paymentCreditCents } = useSplitPayment('cash', computed(() => paymentMethods.value.map((m) => m.key)))

function openTakePayment() {
  activePanel.value = 'payment'
  paymentError.value = ''
  const firstUnpaid = unpaidInvoices.value[0]
  paymentInvoiceId.value = firstUnpaid?.id ?? ''
  resetPaymentRows(firstUnpaid ? (firstUnpaid.total_cents / 100).toFixed(2) : '')
}

async function takePayment() {
  const invoice = invoices.value.find((i) => i.id === paymentInvoiceId.value)
  if (!invoice) return
  const rows = paymentRows.value.filter((r) => paymentRowCents(r) > 0)
  if (rows.length === 0) return
  paymentError.value = ''
  // balanceCents is negative when the patient owes money, so this must only
  // run when a credit row actually exists -- otherwise 0 > a negative
  // balance reads as "exceeded" and blocks a plain cash/card payment.
  // Capped by what is spendable, not by the raw balance. Since the
  // re-migration a balance carries prepaid bono money -- pay 264 for a bono
  // and the balance reads 264 until visits draw it down -- and that money is
  // not spendable twice: it buys the sessions. Offering it here as "credit on
  // account" would let it be spent again while the counter still holds the
  // visits, which is exactly the double-count migration 0161 removed.
  // spendableCreditCents is that rule written down: it was the credit LEDGER
  // here, which held the line but counted only account_credits rows and so
  // also refused genuine overpayments.
  if (paymentCreditCents.value > 0 && paymentCreditCents.value > spendableCreditCents.value) {
    paymentError.value = t('Amount exceeds available credit.', 'El importe supera el crédito disponible.')
    return
  }
  takingPayment.value = true

  const { data: insertedPayments } = await supabase
    .from('payments')
    .insert(
      rows.map((r) => ({
        account_id: store.accountId!,
        patient_id: props.patientId,
        invoice_id: invoice.id,
        amount_cents: paymentRowCents(r),
        method: r.method,
        purpose: 'visit' as const,
      })),
    )
    .select('id, amount_cents, method')

  // A factura for the money that actually came in. 'credit' rows are excluded:
  // spending account credit moves no money and was already documented when
  // that credit was paid in, so issuing a second document would count one
  // payment twice in the fiscal series.
  for (const p of insertedPayments ?? []) {
    if (p.method === 'credit') continue
    await issueFactura({
      accountId: store.accountId!,
      patientId: props.patientId,
      paymentId: p.id,
      amountCents: p.amount_cents,
      purpose: 'visit',
    })
  }
  const creditRows = rows.filter((r) => r.method === 'credit')
  if (creditRows.length > 0) {
    await supabase.from('account_credits').insert(
      creditRows.map((r) => ({
        account_id: store.accountId!,
        patient_id: props.patientId,
        amount_cents: -paymentRowCents(r),
        reason: `Applied to invoice ${invoice.invoice_number}`,
        invoice_id: invoice.id,
        created_by: store.teamMember?.id ?? null,
      })),
    )
  }

  // An instalment on a bono used to be banked as spendable account credit,
  // because a visit then spent that credit back down. Visits no longer do: a
  // bono visit is a package_sessions row and is not billed at all, so the
  // remaining value lives in the sessions counter. Banking it as credit too
  // would represent the same prepaid money in two places -- which is what
  // 0161 retired for the bonos that were already sold.

  if (await settleInvoiceIfCovered(supabase, invoice.id)) {
    // Matches the appointment dialog's recordPayment() -- paying off an
    // invoice auto-sends it the same way regardless of which screen it
    // happened from, when the patient has opted in.
    const { data: patient } = await supabase.from('patients').select('invoice_email_enabled, email').eq('id', props.patientId).maybeSingle()
    if (patient?.invoice_email_enabled && patient.email) {
      useStaffFetch(`/api/invoices/${invoice.id}/send`, { method: 'POST' }).catch(() => {})
    }
  }

  takingPayment.value = false
  activePanel.value = null
  await Promise.all([refreshCreditSummary(), loadAll()])
}

const showCardModal = ref(false)
const copyingCardLink = ref(false)
const removingCard = ref(false)
const { showToast } = useToast()
async function copyCardLink() {
  copyingCardLink.value = true
  try {
    const { url } = await useStaffFetch<{ url: string }>('/api/stripe/create-card-link', { method: 'POST', body: { patientId: props.patientId } })
    await navigator.clipboard.writeText(url)
    showToast('Card link copied -- send it to the patient')
  } catch (err: any) {
    showToast(err?.data?.statusMessage ?? 'Could not create card link', 'error')
  } finally {
    copyingCardLink.value = false
  }
}
async function removeCard() {
  if (!confirm('Remove the saved card for this patient?')) return
  removingCard.value = true
  try {
    await useStaffFetch('/api/stripe/remove-card', { method: 'POST', body: { patientId: props.patientId } })
    showToast('Card removed')
    await loadAll()
  } catch (err: any) {
    showToast(err?.data?.statusMessage ?? 'Could not remove card', 'error')
  } finally {
    removingCard.value = false
  }
}
const stripeCustomer = ref<StripeCustomerRow | null>(null)
const schedules = ref<PaymentScheduleRow[]>([])
const stripeEvents = ref<StripeEventRow[]>([])
const autopayFormFor = ref<string | null>(null)
const autopayInstallments = ref(1)
const autopayIntervalCount = ref(1)
const autopayInterval = ref<'day' | 'week' | 'month' | 'year'>('month')
const autopayAlreadyPaid = ref(0)
const settingUpAutopay = ref(false)
const autopayError = ref('')

const invoices = ref<InvoiceRow[]>([])
const lineItemDescriptions = ref<Record<string, string[]>>({})
const ledgerPayments = ref<LedgerPaymentRow[]>([])
const ledgerCredits = ref<LedgerCreditRow[]>([])
// Visits drawn from a package. Read alongside the ledger rather than with the
// packages panel: the panel answers "how many left", this answers "which
// visits went through it", which is what the ledger is for.
const ledgerPackageSessions = ref<{ id: string; amount_cents: number; used_at: string; package_name: string | null }[]>([])
// Three independent loading flags instead of one -- each card (Account
// Ledger, Packages/bonos, Memberships) shows its own skeleton and swaps in
// as soon as its own pair of queries resolves, rather than the whole tab
// waiting on whichever of the ~8 queries loadAll() used to fire together is
// slowest before showing anything at all.
const ledgerLoading = ref(true)
// Set when any of the ledger's own queries came back with an error. Without
// it a failed load is indistinguishable from a patient who has never been
// charged: every one of those queries used to be coalesced with `?? []`, so
// PostgREST refusing the whole select -- a column the deployed code names and
// the database does not have, a policy that denies the row -- rendered as
// "No transactions yet" over a patient with money on their account. See
// loadLedger().
const ledgerError = ref('')
const packagesLoading = ref(true)
const membershipsLoading = ref(true)

const purchases = ref<PackagePurchaseRow[]>([])
const sellPackageId = ref('')
const sellAmountPaid = ref('')
const sellMethod = ref<string>('cash')
const sellingPackage = ref(false)

const patientMemberships = ref<PatientMembershipRow[]>([])
const membershipPayments = ref<MembershipPaymentRow[]>([])
const activateMembershipId = ref('')
const activateAmountPaid = ref('')
const activateMethod = ref<string>('cash')
const activatingMembership = ref(false)

watch(sellPackageId, (id) => {
  const tpl = packageTemplates.value.find((p) => p.id === id)
  sellAmountPaid.value = tpl ? (tpl.price_cents / 100).toFixed(2) : ''
})
watch(activateMembershipId, (id) => {
  const tpl = membershipTemplates.value.find((m) => m.id === id)
  activateAmountPaid.value = tpl ? (tpl.price_cents / 100).toFixed(2) : ''
})

// Records what was actually collected at the point of sale (may be less than
// the package/membership's full price -- the rest is expected to go through
// the existing Stripe autopay/installments flow below, which already has an
// "already paid" concept for exactly this). Same compound cash/card/other/
// credit handling as recordPayment's credit branch and applyCreditToInvoice.
async function recordSalePayment(description: string, amountCents: number, method: string) {
  const { data: invoiceNumber } = await supabase.rpc('next_invoice_number', { p_account_id: store.accountId! })
  if (!invoiceNumber) return

  const { data: invoice } = await supabase
    .from('invoices')
    .insert({ account_id: store.accountId!, patient_id: props.patientId, invoice_number: invoiceNumber, status: 'paid', total_cents: amountCents })
    .select('id')
    .single()
  if (!invoice) return

  await supabase.from('invoice_line_items').insert({ account_id: store.accountId!, invoice_id: invoice.id, description, quantity: 1, price_cents: amountCents })

  if (method === 'credit') {
    await supabase.from('payments').insert({ account_id: store.accountId!, patient_id: props.patientId, invoice_id: invoice.id, amount_cents: amountCents, method: 'credit' })
    await supabase.from('account_credits').insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      amount_cents: -amountCents,
      reason: `Applied to ${description}`,
      invoice_id: invoice.id,
      created_by: store.teamMember?.id ?? null,
    })
  } else {
    const { data: payment } = await supabase
      .from('payments')
      .insert({ account_id: store.accountId!, patient_id: props.patientId, invoice_id: invoice.id, amount_cents: amountCents, method, purpose: 'membership' })
      .select('id')
      .single()
    if (payment) {
      await issueFactura({
        accountId: store.accountId!,
        patientId: props.patientId,
        paymentId: payment.id,
        amountCents,
        purpose: 'membership',
        serviceName: description,
      })
    }
  }
}

// The payment side of a bono sale or instalment. Cash/card money settles the
// bono's invoice and nothing more -- the sessions counter is what carries the
// prepaid value from here on, so banking it as account credit as well would
// hold the same money in two places (see 0161).
//
// Paying WITH credit still writes its negative row: that is a patient spending
// credit they genuinely hold, and it has to come off their balance.
async function recordPackagePayment(
    packagePurchaseId: string | null,
    amountCents: number,
    method: string,
    description: string,
    bono?: { priceCents: number; sessionsTotal: number },
  ) {
  if (!packagePurchaseId) return
  // Attached to the bono, not to an invoice. Selling a bono used to raise an
  // invoice for its full price and hang the payments off that -- which
  // charged the patient twice, because every visit drawn from the bono raises
  // its own charge as well. Alonso Varela was invoiced 528 for the bono and
  // 44 for the visit he took from it; run the bono out and that is 1,056
  // charged for 528 of sessions.
  //
  // The 518 bonos migrated from PracticeHub never had a sale invoice -- phase
  // 5 removed them -- and they have been correct all along: the money sits on
  // the account and each visit's charge draws it down. This makes a bono sold
  // here behave the same way, so there is one model rather than two.
  const { data: payment } = await supabase
    .from('payments')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      invoice_id: null,
      package_purchase_id: packagePurchaseId,
      amount_cents: amountCents,
      method,
      purpose: 'bono',
    })
    .select('id')
    .single()

  // A bono's factura says how much of it this money bought -- "264.00 EUR of
  // 528.00 EUR (6 of 12 sessions)" -- because that is what the patient is
  // actually purchasing when they pay an instalment. Not issued for a credit
  // payment: that money was documented when it was paid in.
  if (payment && method !== 'credit' && bono) {
    await issueFactura({
      accountId: store.accountId!,
      patientId: props.patientId,
      paymentId: payment.id,
      amountCents,
      purpose: 'bono',
      bono: { packageName: description, priceCents: bono.priceCents, sessionsTotal: bono.sessionsTotal },
    })
  }
  if (method === 'credit') {
    await supabase.from('account_credits').insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      amount_cents: -amountCents,
      reason: `Applied to ${description}`,
      invoice_id: null,
      created_by: store.teamMember?.id ?? null,
    })
  }
}

// Each loader below is independent -- its own query pair, its own loading
// flag -- so the three cards (Account Ledger, Packages/bonos, Memberships)
// each show their own skeleton and swap in the moment their own data is
// back, instead of the whole tab waiting on whichever query of the ~8 this
// used to fire as one batch happened to be slowest. Within a loader, queries
// keyed off the same patient_id still run in one parallel wave each
// (invoice_line_items and membership_payments filter through an embedded
// !inner join on their parent's patient_id rather than a separate .in(ids)
// round-trip) -- that part of the original optimization is unchanged.
async function loadLedger() {
  ledgerLoading.value = true
  ledgerError.value = ''
  // payments and account_credits used to be fetched by AccountLedger.vue
  // itself, only after this loader finished and swapped that component in --
  // a second serial round trip on every single tab open, even for a patient
  // with nothing to show. Both filter through the same embedded !inner join
  // as invoice_line_items (payments has no patient_id of its own) so they
  // can join this same parallel wave instead.
  const [inv, lines, pays, creds] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, status, total_cents, created_at, is_refund, refunds_invoice_id, refunds_payment_id')
      .eq('patient_id', props.patientId)
      .order('created_at', { ascending: false }),
    supabase
      .from('invoice_line_items')
      .select('invoice_id, description, invoices!inner(patient_id)')
      .eq('invoices.patient_id', props.patientId),
    // By patient, not through their invoices -- an inner join to invoices
    // would hide every payment with no invoice_id, and money on account has
    // none. invoice_id is still selected: it is how the ledger below matches
    // a payment to the charge it settled, and it is simply null when it
    // settled nothing in particular.
    // created_by's name is embedded rather than resolved from a team-members
    // list: there isn't one in the store, and a payment can name someone who
    // has since been removed from the team (the FK is ON DELETE SET NULL, but
    // a soft-deleted member keeps their row and their name).
    supabase
      .from('payments')
      .select('id, invoice_id, amount_cents, method, paid_at, package_purchase_id, external_reference, purpose, created_by, stripe_payment_intent_id, team_members(full_name)')
      .eq('patient_id', props.patientId),
    supabase
      .from('account_credits')
      .select('id, amount_cents, reason, method, invoice_id, created_at')
      .eq('patient_id', props.patientId)
      .order('created_at', { ascending: true }),
  ])
  const sessions = await supabase
    .from('package_sessions')
    .select('id, amount_cents, used_at, package_purchases(package_name)')
    .eq('patient_id', props.patientId)
    .order('used_at', { ascending: true })

  // Every one of these used to be read as `data ?? []`, which throws the
  // error away and leaves an empty array that reads exactly like a patient
  // with nothing on their account. That is the wrong default for money: the
  // invoices query alone failing (because the code named
  // invoices.refunds_payment_id against a database that did not have that
  // column yet) dropped every CHARGE from the ledger while the payments
  // against those charges still rendered, and the running balance was
  // recomputed from what was left -- a confident, wrong figure with nothing
  // on screen to say a query had failed. A ledger missing a row is worse
  // than a ledger that admits it could not load, so one failure fails all
  // five rather than rendering the rest.
  const failed = [inv, lines, pays, creds, sessions].find((r) => r.error)
  if (failed) {
    ledgerError.value = failed.error!.message
    ledgerLoading.value = false
    return
  }

  invoices.value = inv.data ?? []
  const byInvoice: Record<string, string[]> = {}
  for (const l of (lines.data ?? []) as unknown as { invoice_id: string; description: string }[]) {
    ;(byInvoice[l.invoice_id] ??= []).push(l.description)
  }
  lineItemDescriptions.value = byInvoice
  ledgerPayments.value = (pays.data ?? []) as unknown as LedgerPaymentRow[]
  ledgerCredits.value = creds.data ?? []
  ledgerPackageSessions.value = ((sessions.data ?? []) as unknown as { id: string; amount_cents: number; used_at: string; package_purchases: { package_name: string } | null }[]).map((r) => ({
    id: r.id,
    amount_cents: r.amount_cents,
    used_at: r.used_at,
    package_name: r.package_purchases?.package_name ?? null,
  }))
  ledgerLoading.value = false
}

async function loadPackages() {
  packagesLoading.value = true
  // A patient's own "Packages / bonos" card previously only ever showed
  // bonos THEY bought -- a bono shared to them (package_purchase_shares)
  // never appeared here at all, even though this same card is exactly
  // where a front-desk staff member would look to use a session from it.
  // Mirrors usePatientFinancialSummary's own shares query/merge, kept
  // separate here since this card additionally needs invoice_id (for
  // "Take payment") and purchased_at (for sort order), neither of which
  // that composable's activePackages carries.
  const [{ data: pkgPurchases }, { data: sch }, { data: shares }] = await Promise.all([
    supabase.from('package_purchases').select('id, package_name, sessions_total, sessions_used, price_cents, purchased_at, invoice_id, owed_cents, is_closed').eq('patient_id', props.patientId).order('purchased_at', { ascending: false }),
    supabase
      .from('payment_schedules')
      .select('id, package_purchase_id, patient_membership_id, interval, interval_count, installments_total, installments_paid, status')
      .eq('patient_id', props.patientId),
    supabase
      .from('package_purchase_shares')
      .select('package_purchases(id, package_name, sessions_total, sessions_used, price_cents, purchased_at, invoice_id, owed_cents, is_closed, patients(first_name, last_name))')
      .eq('patient_id', props.patientId),
  ])
  const sharedPurchases = (shares ?? [])
    .map((s) => s.package_purchases)
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map(({ patients: owner, ...p }) => ({
      ...p,
      shared: true,
      ownerName: owner ? `${owner.first_name} ${owner.last_name ?? ''}`.trim() : undefined,
    }))
  purchases.value = [...(pkgPurchases ?? []), ...sharedPurchases]
  schedules.value = sch ?? []
  if (schedules.value.length > 0) {
    const { data: events } = await supabase
      .from('stripe_payment_events')
      .select('id, payment_schedule_id, period_start, amount_cents, status')
      .in('payment_schedule_id', schedules.value.map((s) => s.id))
      .order('period_start', { ascending: false })
    stripeEvents.value = events ?? []
  }
  packagesLoading.value = false
}

async function loadMemberships() {
  membershipsLoading.value = true
  const [{ data: patMemberships }, { data: membershipPaymentRows }] = await Promise.all([
    supabase.from('patient_memberships').select('id, membership_name, price_cents, status, started_at').eq('patient_id', props.patientId).order('started_at', { ascending: false }),
    supabase
      .from('membership_payments')
      .select('id, patient_membership_id, period_start, amount_cents, status, patient_memberships!inner(patient_id)')
      .eq('patient_memberships.patient_id', props.patientId)
      .order('period_start', { ascending: false }),
  ])
  patientMemberships.value = (patMemberships as PatientMembershipRow[]) ?? []
  membershipPayments.value = (membershipPaymentRows ?? []) as unknown as MembershipPaymentRow[]
  membershipsLoading.value = false
}

async function loadCard() {
  const { data: customer } = await supabase.from('patient_stripe_customers').select('stripe_customer_id, default_payment_method_id').eq('patient_id', props.patientId).maybeSingle()
  stripeCustomer.value = customer
}

async function loadAll() {
  // Callers that mutate data (recording a payment, selling a package,
  // activating a membership...) still `await loadAll()` and expect
  // everything back in sync afterward, so this stays a single entry point --
  // it just fans out to independently-resolving loaders instead of one
  // Promise.all gating a single `loading` flag.
  await Promise.all([loadLedger(), loadPackages(), loadMemberships(), loadCard(), ensureBillingTemplatesLoaded()])
}

// AccountLedger's own transfer-credit action mutates account_credits
// directly (it's not routed through any of this file's write functions),
// so it needs both the summary strip and the ledger's payments/credits
// refreshed afterward.
async function onLedgerCreditsChanged() {
  await Promise.all([refreshCreditSummary(), loadAll()])
}
onMounted(async () => {
  loadAll()
  loadFacturas()
  maybeOpenPaymentFromTrigger()
  // Then preselect whatever the clinic put first, rather than leaving the
  // hardcoded 'cash' every form was initialised with.
  await ensurePaymentMethodsLoaded()
  for (const m of [addCreditMethod, sellMethod, activateMethod, collectMethod]) m.value = defaultMethod.value
  for (const row of paymentRows.value) if (row.method !== 'credit') row.method = defaultMethod.value
})
// The sidebar's "Charge" button sets this to jump straight to the "Take
// payment" panel -- both when it just switched the parent onto this tab
// (this component mounts fresh, handled above) and when this tab was
// already active (no remount, so the prop's own change is what fires this).
function maybeOpenPaymentFromTrigger() {
  if (!props.openPaymentTrigger) return
  activePanel.value = 'payment'
  emit('paymentTriggerConsumed')
}
watch(() => props.openPaymentTrigger, maybeOpenPaymentFromTrigger)

const sendingInvoiceId = ref('')
const sendResultInvoiceId = ref('')
const sendResultMessage = ref('')
async function sendInvoiceEmail(invoiceId: string) {
  sendingInvoiceId.value = invoiceId
  sendResultInvoiceId.value = ''
  try {
    await useStaffFetch(`/api/invoices/${invoiceId}/send`, { method: 'POST' })
    sendResultMessage.value = t('Sent', 'Enviado')
  } catch (e: any) {
    sendResultMessage.value = e?.data?.message ?? t('Failed to send', 'No se pudo enviar')
  }
  sendingInvoiceId.value = ''
  sendResultInvoiceId.value = invoiceId
  setTimeout(() => {
    if (sendResultInvoiceId.value === invoiceId) sendResultInvoiceId.value = ''
  }, 3000)
}

// Deleting cascades to this invoice's own line items and payments (both
// on delete cascade) -- the intended use is fixing a mis-entered sale or
// payment by deleting the wrong invoice outright and redoing it correctly,
// rather than trying to edit amounts in place after the fact.
async function deleteInvoice(invoice: InvoiceRow) {
  if (!confirm(`${t('Delete receipt', 'Eliminar recibo')} ${invoice.invoice_number} (${money(invoice.total_cents)})? ${t("This also removes any payments recorded against it. This can't be undone.", 'Esto también elimina los pagos registrados contra ella. Esta acción no se puede deshacer.')}`)) return
  await supabase.from('invoices').delete().eq('id', invoice.id)
  await Promise.all([loadAll(), refreshCreditSummary(), loadFacturas()])
}

// Settles an invoice's remaining balance without collecting money -- same
// paidCents->status flip every other payment path already uses, just
// tagged 'write_off' so the ledger can label it honestly.
// -- Remove a payment recorded in error. Deletes the payment row and reopens
// the invoice if it is no longer covered, so the visit can be billed again
// (typically because it should have been drawn from a bono rather than taken
// as cash). Bookkeeping only: no money moves, which is why this is a delete
// rather than a refund -- a refund records that cash went back to the
// patient, and here it never left in the first place.
async function deletePayment(paymentId: string, invoiceId: string | null, amountCents: number) {
  const invoice = invoices.value.find((i) => i.id === invoiceId)

  // A factura was issued for this payment, and it is about to stop matching
  // anything. Said out loud because this used to be silent AND destructive:
  // facturas.payment_id cascaded, so the numbered document was deleted along
  // with the payment and the series was left with a hole. Four numbers went
  // that way before anyone noticed. The document now survives (migration
  // 20260915160852), but whoever is deleting still needs to know one exists --
  // a refund may be the right instrument rather than a deletion.
  const { data: linkedFacturas } = await supabase
    .from('facturas')
    .select('number')
    .eq('payment_id', paymentId)
  const facturaNumbers = (linkedFacturas ?? []).map((f) => f.number).join(', ')

  if (
    !confirm(
      `${t('Remove this', 'Eliminar este')} ${money(amountCents)} ${t('payment', 'pago')}${invoice ? ` ${t('from', 'de')} ${invoice.invoice_number}` : ''}? ` +
        t('The receipt reopens if it is no longer fully paid. This does not refund any money.', 'El recibo se reabrirá si deja de estar pagado. Esto no reembolsa ningún importe.') +
        (facturaNumbers
          ? '\n\n' +
            t(
              `Factura ${facturaNumbers} was issued for this payment. It stays on the fiscal series and will be flagged as no longer matching a payment. If money actually went back to the patient, record a refund instead.`,
              `Se emitió la factura ${facturaNumbers} por este pago. Seguirá en la serie fiscal y quedará marcada como sin pago asociado. Si el dinero se devolvió realmente al paciente, registra un reembolso en su lugar.`,
            )
          : ''),
    )
  )
    return

  const { error } = await supabase.from('payments').delete().eq('id', paymentId)
  if (error) {
    showToast(error.message, 'error')
    return
  }

  // Recompute from what is actually left rather than subtracting the removed
  // amount, so a stale local copy can't leave the status wrong.
  if (invoice && invoiceId) {
    const { data: remaining } = await supabase.from('payments').select('amount_cents').eq('invoice_id', invoiceId)
    const paidCents = (remaining ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
    if (invoice.status !== 'void') {
      await supabase.from('invoices').update({ status: paidCents >= invoice.total_cents ? 'paid' : 'unpaid' }).eq('id', invoiceId)
    }
  }

  await Promise.all([loadAll(), refreshCreditSummary(), loadFacturas()])
}

async function writeOffInvoice(invoiceId: string) {
  const invoice = invoices.value.find((i) => i.id === invoiceId)
  if (!invoice) return
  const { data: paid } = await supabase.from('payments').select('amount_cents').eq('invoice_id', invoiceId)
  const paidCents = (paid ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
  const openCents = invoice.total_cents - paidCents
  if (openCents <= 0) return
  if (!confirm(`${t('Write off', 'Condonar')} ${money(openCents)} ${t('remaining on', 'restantes de')} ${invoice.invoice_number}? ${t('This settles the receipt without collecting payment.', 'Esto salda el recibo sin cobrar el pago.')}`)) return
  await supabase.from('payments').insert({ account_id: store.accountId!, patient_id: props.patientId, invoice_id: invoiceId, amount_cents: openCents, method: 'write_off' })
  await settleInvoiceIfCovered(supabase, invoiceId)
  await Promise.all([loadAll(), refreshCreditSummary(), loadFacturas()])
}

// -- Refund: a new invoice with a negative total, linked back to the one it
// refunds -- see the migration comment (0126_invoice_refunds.sql) for why
// this needs no special-casing in usePatientFinancialSummary's balance
// formula. Bookkeeping only, same as write-off: no Stripe refund call, this
// just records that money already went back to the patient by whatever
// means. Capped at what's actually been paid on the original invoice minus
// anything already refunded against it, so staff can't refund money that
// was never collected or refund the same invoice twice over.
async function refundableCentsFor(invoiceId: string): Promise<number> {
  const invoice = invoices.value.find((i) => i.id === invoiceId)
  if (!invoice) return 0
  const [{ data: paid }, alreadyRefunded] = await Promise.all([
    supabase.from('payments').select('amount_cents').eq('invoice_id', invoiceId),
    Promise.resolve(
      invoices.value.filter((i) => i.is_refund && i.refunds_invoice_id === invoiceId).reduce((sum, i) => sum + Math.abs(i.total_cents), 0),
    ),
  ])
  const paidCents = (paid ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
  return Math.max(0, paidCents - alreadyRefunded)
}

// The same lower-of-two-rooms rule the ledger uses to decide whether to offer
// the action -- re-derived here rather than trusted from the payload, for the
// reason refundableCentsFor exists: the cap is what stops money being returned
// twice, so it has to hold on the write and not only in the UI.
async function refundablePaymentCentsFor(paymentId: string): Promise<number> {
  const { data: payment } = await supabase.from('payments').select('id, invoice_id, amount_cents, method').eq('id', paymentId).maybeSingle()
  if (!payment || payment.amount_cents <= 0 || payment.method === 'write_off') return 0

  const refundedAgainstPayment = invoices.value
    .filter((i) => i.is_refund && i.refunds_payment_id === paymentId)
    .reduce((sum, i) => sum + Math.abs(i.total_cents), 0)
  const paymentRoom = payment.amount_cents - refundedAgainstPayment

  // Money on account is not refundable this way -- its account_credits row
  // would survive the refund and stay spendable. See the ledger's copy.
  if (!payment.invoice_id) return 0

  return Math.max(0, Math.min(paymentRoom, await refundableCentsFor(payment.invoice_id)))
}

// `paymentId` set means this refund names the single payment it gives back --
// capped at that payment, and able to say exactly which factura it corrects.
// Null means the older receipt-wide refund, which stays exactly as it was.
async function createRefund(invoiceId: string | null, paymentId: string | null, amountCents: number, reason: string, method: string) {
  if (amountCents <= 0) return
  const invoice = invoiceId ? (invoices.value.find((i) => i.id === invoiceId) ?? null) : null
  if (invoiceId && !invoice) return
  if (!invoice && !paymentId) return

  const maxRefundable = paymentId ? await refundablePaymentCentsFor(paymentId) : await refundableCentsFor(invoiceId!)
  if (amountCents > maxRefundable) return

  // Its own series, so a refund no longer consumes an invoice number.
  const { data: invoiceNumber } = await supabase.rpc('next_invoice_number', { p_account_id: store.accountId!, p_prefix: 'REF-' })
  if (!invoiceNumber) return

  const { data: refund } = await supabase
    .from('invoices')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      invoice_number: invoiceNumber,
      status: 'paid',
      total_cents: -amountCents,
      is_refund: true,
      // Both, when there is a receipt behind the payment: the two caps read
      // different columns, and a refund missing from either one is a refund
      // the other cap will happily let you make a second time.
      refunds_invoice_id: invoiceId,
      refunds_payment_id: paymentId,
    })
    .select('id')
    .single()
  if (!refund) return

  await supabase.from('invoice_line_items').insert({
    account_id: store.accountId!,
    invoice_id: refund.id,
    description: refundDescription(invoice?.invoice_number ?? null, reason),
    quantity: 1,
    price_cents: -amountCents,
  })

  // Without this, the refund never showed up as money leaving in
  // usePatientFinancialSummary's balanceCents (paidCents - invoicedCents):
  // invoicedCents drops by amountCents via the refund invoice above, but
  // nothing dropped paidCents to match, leaving a phantom credit on the
  // patient's balance for money that had already gone back to them. Same
  // gap in reports/income.vue's Total paid/By payment method, which read
  // only from `payments` and never saw a refund at all.
  const { data: refundPayment } = await supabase
    .from('payments')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      invoice_id: refund.id,
      amount_cents: -amountCents,
      method,
    })
    .select('id')
    .single()

  // The rectifying document. Without it the factura saying this money came in
  // stays in the series with nothing against it, which is the state every
  // refund the clinic had ever made was in.
  //
  // 'credit' is excluded on the way in -- spending account credit moves no
  // money and issues no factura -- so refunding it has nothing to rectify.
  if (refundPayment && method !== 'credit') {
    // The factura(s) behind what is being refunded. Naming a payment resolves
    // this exactly -- facturas carry payment_id -- which is the case the
    // receipt-wide lookup has to give up on: a visit settled in parts has
    // several documents behind it and no single "the" one being corrected, so
    // the rectificativa was issued naming no predecessor. Refunding the card
    // half of a split payment now corrects the card half's document.
    let originalIds: string[] = []
    if (paymentId) {
      originalIds = [paymentId]
    } else if (invoiceId) {
      const { data: originalPayments } = await supabase.from('payments').select('id').eq('invoice_id', invoiceId)
      originalIds = (originalPayments ?? []).map((p) => p.id)
    }
    const { data: originalFacturas } = originalIds.length
      ? await supabase.from('facturas').select('id, number').in('payment_id', originalIds)
      : { data: [] as { id: string; number: string }[] }
    const only = (originalFacturas ?? []).length === 1 ? originalFacturas![0] : null

    await issueRectificativa({
      accountId: store.accountId!,
      patientId: props.patientId,
      paymentId: refundPayment.id,
      amountCents,
      rectifiesFacturaId: only?.id ?? null,
      rectifiesNumber: only?.number ?? null,
      reason: reason.trim(),
    })
  }

  await Promise.all([loadAll(), refreshCreditSummary(), loadFacturas()])
}

const hasCard = computed(() => !!stripeCustomer.value?.default_payment_method_id)
const unpaidInvoices = computed(() => invoices.value.filter((i) => i.status === 'unpaid'))

/**
 * Bono value the patient's own money is actually tied up in.
 *
 * Paid for, not merely held: packageRemainingValueCents counts unused sessions
 * whether or not anyone has paid for them, so an unpaid bono would otherwise
 * mask real money -- a patient with EUR 100 of credit and an unpaid EUR 528
 * bono has EUR 100 to spend, not nothing. Netting off what is still owed
 * leaves only the part their money has already bought.
 */
// Bonos PracticeHub has closed are left out for the same reason shared ones
// are: the sessions still on their counter are not value anyone can spend.
// They stay in the card below, marked closed, because the visits they paid for
// are real and a bono that vanishes is harder to explain than one that says
// what it is.
const committedBonoCents = computed(() =>
  purchases.value
    .filter((p) => !p.shared && !p.is_closed)
    .reduce((sum, p) => sum + Math.max(0, packageRemainingValueCents(p) - packageOwedCents(p)), 0),
)

// What the patient can still draw on, in one number, for the front desk: loose
// account credit PLUS what their unused bono sessions are worth once whatever
// is still owed on those bonos comes off. The question it answers is "do I
// need to ask this person for money?", and answering it meant reading the
// credit box and then counting sessions across every bono card underneath it.
//
// It has to be committedBonoCents rather than the gross session value, or the
// answer is wrong in the direction that costs money: a patient 378 EUR behind
// on a 528 EUR bono read as "484 available" here while the Debtors report
// listed the 378. Same database, same day, two screens disagreeing.
//
// This is a summary, not a second balance. Nothing spends from it -- a bono
// session still comes off its own counter and credit still comes off the
// ledger -- so the value cannot be spent twice by showing it here. Bonos
// shared FROM someone else are left out: those sessions are the owner's money,
// and they already carry a "Shared by" pill saying so.
const availableCents = computed(() => creditLedgerCents.value + committedBonoCents.value)

/**
 * Money the patient can actually put towards something: their credit ledger in
 * full, plus anything paid beyond what has been invoiced and what their bonos
 * have already committed.
 *
 * NOT creditLedgerCents alone, which counts only account_credits rows. Three
 * patients in the whole database have one, so gating on it hid the credit
 * option from essentially everyone -- including patients plainly showing a
 * credit balance on this very tab, since "Available" above reads
 * creditLedgerCents plus committedBonoCents. What reception saw and what the
 * gates tested were never the same number.
 *
 * NOT availableCents either, and this is the part that matters. A bono raises
 * no invoice -- its price sits on the purchase as owed_cents and each visit
 * draws it down -- so money paid for it reads as a positive balance until the
 * sessions are used. Offering that as credit would buy something else with
 * money already spent on the bono, leaving those sessions unfunded: the
 * double-count 0161 removed.
 *
 * And NOT balanceCents on its own, which is the mistake this started as.
 * balanceCents nets outstanding invoices against credit, but settling an
 * outstanding invoice is the main thing credit is FOR. A patient with EUR 100
 * of credit and an unpaid EUR 55 invoice has a balance of EUR 45 and EUR 100
 * to spend, 55 of which belongs on that invoice. Subtracting the debt from the
 * credit refused exactly that -- caught by factura-per-payment.cy.ts, which is
 * why the two terms are added rather than read off the balance.
 *
 * The surplus term is derived from balanceCents because the composable exposes
 * only the balance, not the raw paid/invoiced totals. The cutover adjustment
 * folded into it makes that term more conservative for an imported bono, and
 * under-offering is the safe direction to be wrong in.
 */
const spendableCreditCents = computed(() =>
  creditLedgerCents.value + Math.max(0, balanceCents.value - creditLedgerCents.value - committedBonoCents.value),
)

function scheduleForPackage(purchaseId: string) {
  return schedules.value.find((s) => s.package_purchase_id === purchaseId)
}
function scheduleForMembership(membershipId: string) {
  return schedules.value.find((s) => s.patient_membership_id === membershipId)
}
function eventsForSchedule(scheduleId: string) {
  return stripeEvents.value.filter((e) => e.payment_schedule_id === scheduleId)
}

function openAutopayForm(id: string) {
  autopayFormFor.value = id
  autopayError.value = ''
  autopayInstallments.value = 1
  autopayIntervalCount.value = 1
  autopayInterval.value = 'month'
  autopayAlreadyPaid.value = 0
}

async function setUpPackageAutopay(purchase: PackagePurchaseRow) {
  autopayError.value = ''
  settingUpAutopay.value = true
  try {
    await useStaffFetch('/api/stripe/create-schedule', {
      method: 'POST',
      body: {
        patientId: props.patientId,
        packagePurchaseId: purchase.id,
        description: purchase.package_name,
        totalAmountCents: purchase.price_cents,
        installments: autopayInstallments.value,
        interval: autopayInterval.value,
        intervalCount: autopayIntervalCount.value,
        installmentsAlreadyPaid: autopayAlreadyPaid.value,
      },
    })
    autopayFormFor.value = null
    await loadAll()
  } catch (err: any) {
    autopayError.value = err?.data?.statusMessage ?? t('Could not set up autopay', 'No se pudo configurar el pago automático')
  } finally {
    settingUpAutopay.value = false
  }
}

async function setUpMembershipAutopay(m: PatientMembershipRow) {
  autopayError.value = ''
  settingUpAutopay.value = true
  try {
    await useStaffFetch('/api/stripe/create-schedule', {
      method: 'POST',
      body: {
        patientId: props.patientId,
        patientMembershipId: m.id,
        description: m.membership_name,
        totalAmountCents: m.price_cents,
        interval: autopayInterval.value,
        intervalCount: autopayIntervalCount.value,
      },
    })
    autopayFormFor.value = null
    await loadAll()
  } catch (err: any) {
    autopayError.value = err?.data?.statusMessage ?? t('Could not set up autopay', 'No se pudo configurar el pago automático')
  } finally {
    settingUpAutopay.value = false
  }
}

async function cancelAutopay(scheduleId: string) {
  if (!confirm(t('Cancel automatic Stripe billing for this?', '¿Cancelar la facturación automática de Stripe para esto?'))) return
  await useStaffFetch('/api/stripe/cancel-schedule', { method: 'POST', body: { paymentScheduleId: scheduleId } })
  await loadAll()
}

const scheduleTone: Record<string, 'success' | 'neutral' | 'danger'> = {
  active: 'success',
  completed: 'neutral',
  canceled: 'neutral',
  past_due: 'danger',
}
const statusTone: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  paid: 'success',
  unpaid: 'danger',
  void: 'neutral',
  failed: 'danger',
  active: 'success',
  paused: 'warning',
  cancelled: 'neutral',
}

async function sellPackage() {
  const tpl = packageTemplates.value.find((p) => p.id === sellPackageId.value)
  if (!tpl) return
  const amountCents = Math.round((parseFloat(sellAmountPaid.value) || 0) * 100)
  // Against what is actually spendable, and against the amount being paid
  // now rather than the package's price -- part-paying a EUR 528 bono with
  // EUR 50 of credit is a normal sale, with the rest taken later or put on
  // autopay.
  if (sellMethod.value === 'credit' && amountCents > spendableCreditCents.value) {
    creditError.value = t('Amount exceeds available credit.', 'El importe supera el crédito disponible.')
    return
  }
  sellingPackage.value = true
  // No invoice for the sale. What the bono costs is recorded as owed_cents on
  // the purchase, and every payment against it comes off that -- see
  // packageOwedCents. Raising an invoice here as well as charging each visit
  // billed the same sessions twice.
  const { data: purchase } = await supabase
    .from('package_purchases')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      package_id: tpl.id,
      package_name: tpl.name,
      sessions_total: tpl.session_count,
      price_cents: tpl.price_cents,
      invoice_id: null,
      owed_cents: tpl.price_cents,
      created_by: store.teamMember?.id ?? null,
    })
    .select('id')
    .single()
  // Amount paid can be less than the package's full price -- the rest is
  // expected via the existing "Set up autopay" Stripe schedule below.
  if (purchase && amountCents > 0) {
    await recordPackagePayment(purchase.id, amountCents, sellMethod.value, tpl.name, { priceCents: tpl.price_cents, sessionsTotal: tpl.session_count })
  }
  sellingPackage.value = false
  sellPackageId.value = ''
  sellAmountPaid.value = ''
  sellMethod.value = 'cash'
  await Promise.all([loadAll(), refreshCreditSummary(), loadFacturas()])
}

// What is still unpaid on a bono: payments landing on its own invoice
// (package_purchases.invoice_id) count automatically, and so does any
// payment a staff member has explicitly linked via linkPaymentToPackage
// below -- for a payment that was taken against a different invoice
// entirely (an imported PracticeHub payment, one taken against the wrong
// invoice by mistake) or a bono with no invoice of its own (every purchase
// migrated from PracticeHub pre-dates this app's invoice-per-bono flow).
//
// A bono with no invoice AND nothing manually linked yet is the one case
// still reported as zero owed rather than the full price: there's no record
// of what was actually charged for it, so claiming a debt would be
// inventing one. The moment any payment gets linked (however partial),
// price_cents becomes a reliable total to measure it against.
// Whether the bono's own invoice is the thing carrying its payments. A void
// invoice isn't: its payments stop counting towards the bono below, so they
// have to become linkable instead (see candidatePaymentsFor) -- excluding
// them from both left them stranded, neither counted nor fixable from the UI.
function packageInvoice(purchase: PackagePurchaseRow) {
  return purchase.invoice_id ? invoices.value.find((i) => i.id === purchase.invoice_id) : undefined
}

function packageInvoiceIsValid(purchase: PackagePurchaseRow): boolean {
  const invoice = packageInvoice(purchase)
  return !!invoice && invoice.status !== 'void'
}

// What the sessions still on the counter are worth. Since a bono visit stopped
// being a billing event (0161), the counter is the only record of remaining
// value -- there is no parallel credit balance to read it off any more. Staff
// still need the figure as money, because that is how PracticeHub shows it and
// how a patient asks for it ("how much do I have left?").
//
// sessions_left x the bono's own per-session rate, the same rounding useSession
// bills a visit at, so this and the session it pays for never disagree by a
// cent. PracticeHub computes its `balance` column exactly this way -- checked
// against five patients on the live account (3 x 44 = 132, 4 x 40 = 160) --
// so the two systems read the same number. Anything still owed on the bono
// is separate and already has its own pill.
function packageRemainingValueCents(purchase: PackagePurchaseRow): number {
  if (!purchase.sessions_total) return 0
  const perSessionCents = Math.round(purchase.price_cents / purchase.sessions_total)
  return perSessionCents * Math.max(0, purchase.sessions_total - purchase.sessions_used)
}

// Delegates to utils/bonoOwed, which the Debtors report and its dashboard
// widget now share -- they each had their own answer, and with 518 of 522
// bonos carrying no sale invoice the other two were reporting almost nothing.
function packageOwedCents(purchase: PackagePurchaseRow): number {
  // The bono card and the ledger load independently -- reading payments
  // before that loader lands would flash the full price as unpaid. A ledger
  // that FAILED to load is the same state and has to be treated the same
  // way: ledgerPayments is empty for the same reason, and the flash would
  // simply never end.
  if (ledgerLoading.value || ledgerError.value) return 0
  return bonoOwedCents({
    purchaseId: purchase.id,
    invoiceId: purchase.invoice_id,
    priceCents: purchase.price_cents,
    owedCents: purchase.owed_cents,
    invoice: packageInvoice(purchase) ?? null,
    payments: ledgerPayments.value,
  })
}

// Collecting the rest of a bono. It used to raise an invoice for the
// outstanding amount and send the front desk to the account-level payment
// panel -- necessary back when a bono's debt WAS an invoice. It isn't: the
// debt is owed_cents, payments come off it directly, and an invoice raised
// here would be a second charge for sessions already being charged per visit.
const collectOnPackageId = ref<string | null>(null)
const collectAmount = ref('')
const collectMethod = ref<string>('cash')
const collectError = ref('')
const collectingPayment = ref(false)

function collectOnPackage(purchase: PackagePurchaseRow) {
  const owed = packageOwedCents(purchase)
  if (owed <= 0) return
  collectError.value = ''
  collectAmount.value = (owed / 100).toFixed(2)
  collectMethod.value = 'cash'
  collectOnPackageId.value = collectOnPackageId.value === purchase.id ? null : purchase.id
}

async function submitPackageCollection(purchase: PackagePurchaseRow) {
  const amountCents = Math.round((parseFloat(collectAmount.value) || 0) * 100)
  if (amountCents <= 0) return
  // Same cap the sale panel applies: credit can only spend credit the patient
  // actually holds, never the value of the bono they are paying for.
  if (collectMethod.value === 'credit' && amountCents > spendableCreditCents.value) {
    collectError.value = t('Amount exceeds available credit.', 'El importe supera el crédito disponible.')
    return
  }
  collectError.value = ''
  collectingPayment.value = true
  await recordPackagePayment(purchase.id, amountCents, collectMethod.value, purchase.package_name, {
    priceCents: purchase.price_cents,
    sessionsTotal: purchase.sessions_total,
  })
  collectingPayment.value = false
  collectOnPackageId.value = null
  collectAmount.value = ''
  await Promise.all([loadAll(), refreshCreditSummary(), loadFacturas()])
}

// --- Linking an EXISTING payment to a bono -- for the cases packageOwedCents
// above can't infer automatically (an imported payment, one taken against
// the wrong invoice, or a bono with no invoice at all).
const openLinkPaymentId = ref<string | null>(null)
const linkPaymentSelection = ref('')
const linkingPayment = ref(false)

// Payments already counted via the bono's own invoice don't need linking,
// and a payment already linked to some other bono shouldn't be offered here
// (linking is meant to be exclusive -- moving it would silently change what
// that OTHER bono's own owed/paid figures mean).
//
// "Already counted" has to mean the same thing here as in packageOwedCents:
// once the bono's invoice is void that function stops counting its payments,
// so hiding them here too left them stranded -- not counted towards the bono
// and not offerable to link, with no way to attach them from the UI at all.
function candidatePaymentsFor(purchase: PackagePurchaseRow) {
  const countedViaInvoice = packageInvoiceIsValid(purchase)
  return ledgerPayments.value.filter((p) => !p.package_purchase_id && !(countedViaInvoice && p.invoice_id === purchase.invoice_id))
}

function linkedPaymentsFor(purchase: PackagePurchaseRow) {
  return ledgerPayments.value.filter((p) => p.package_purchase_id === purchase.id)
}

function invoiceNumberFor(invoiceId: string | null): string {
  if (!invoiceId) return t('on account', 'a cuenta')
  return invoices.value.find((i) => i.id === invoiceId)?.invoice_number ?? invoiceId
}

function toggleLinkPayment(packageId: string) {
  openLinkPaymentId.value = openLinkPaymentId.value === packageId ? null : packageId
  linkPaymentSelection.value = ''
}

async function linkPaymentToPackage(purchase: PackagePurchaseRow) {
  if (!linkPaymentSelection.value) return
  linkingPayment.value = true
  const payment = ledgerPayments.value.find((p) => p.id === linkPaymentSelection.value)

  // Money taken ON ACCOUNT is not moved by relabelling it. Adding credit wrote
  // two rows for the same euros -- this payment, and a credit row saying the
  // patient still has it to direct somewhere -- so pointing the payment at a
  // bono while that credit row stands spends it twice: Alonso Varela's 115
  // EUR paid down his bono AND sat in his credit, and "available" read 292
  // where he had 177.
  //
  // Putting it on the bono is therefore the same operation as Collect with
  // method Credit, and is done the same way: the credit is drawn down and a
  // payment of method 'credit' records where it went. No factura -- that money
  // was documented when the cash came in.
  //
  // The original payment is still marked against the bono, because that is
  // what the front desk asked for and the card should show it. It is the
  // credit-method payment that pays the bono down; utils/bonoOwed skips
  // on-account money for exactly this reason, so the two cannot both count.
  if (payment?.purpose === 'on_account') {
    await recordPackagePayment(purchase.id, payment.amount_cents, 'credit', purchase.package_name, {
      priceCents: purchase.price_cents,
      sessionsTotal: purchase.sessions_total,
    })
  }
  await supabase.from('payments').update({ package_purchase_id: purchase.id }).eq('id', linkPaymentSelection.value)

  linkPaymentSelection.value = ''
  linkingPayment.value = false
  await Promise.all([loadAll(), refreshCreditSummary()])
}

async function unlinkPayment(paymentId: string) {
  await supabase.from('payments').update({ package_purchase_id: null }).eq('id', paymentId)
  await loadAll()
}

// Logging a session records the visit it represents, the same way completing
// an appointment against a bono does (AppointmentBillingTab.usePackageSession):
// a completed appointment plus a package_sessions row at the bono's own
// per-session rate.
//
// It used to only bump sessions_used, leaving the visit itself nowhere. It
// then briefly raised an invoice and spent account credit too -- that went too
// far the other way and billed the patient a second time for a visit their
// bono had already paid for; see 0161 for the ledger side of undoing it.
const loggingSessionFor = ref<string | null>(null)

// Which bono's "Log session" panel is open, and the date staff picked in it.
// Defaults to today so the common case (logging the visit that just
// happened) needs no extra click -- the date field only matters for
// catching up on a session from an earlier day.
const logSessionForId = ref<string | null>(null)
const logSessionDate = ref('')

function todayDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function openLogSession(purchase: PackagePurchaseRow) {
  if (logSessionForId.value === purchase.id) {
    logSessionForId.value = null
    return
  }
  logSessionForId.value = purchase.id
  logSessionDate.value = todayDateStr()
}

interface UncoveredVisit {
  id: string
  starts_at: string
  practitionerId: string | null
  typeName: string | null
  unpaidInvoice: { id: string; invoice_number: string | null; total_cents: number } | null
}

// The visit this session most likely belongs to: an appointment today that
// the patient has arrived for and that no bono session covers yet.
//
// Without this the flow always invented an appointment, even when the real
// one was sitting on the calendar. That is how a patient ended up billed
// twice for one visit -- his Informe Quiropractico was invoiced at its EUR 60
// list price, and 53 seconds later a session was logged here against a
// brand-new typeless placeholder, so he owed EUR 60 AND was down a session
// for a visit that never happened.
async function findUncoveredVisitToday(): Promise<UncoveredVisit | null> {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  // Completed OR already in the room. Only 'completed' counted before, and
  // that is not the order a front desk works in: Tomas Berenguer's session
  // was logged at 17:55:21 while he was still with the practitioner -- he was
  // checked out at 17:56:23, 62 seconds later. Finding nothing, this invented
  // an off-calendar visit, so his real 60 EUR appointment was charged AND a
  // 44 EUR session came off his bono for the same visit.
  //
  // Checked in is the safe widening: the patient is here, the visit is
  // happening. A booking later today that nobody has arrived for is still
  // ignored, which is what stops a session being spent in advance.
  const { data: appts } = await supabase
    .from('appointments')
    .select('id, starts_at, practitioner_id, appointment_types(name)')
    .eq('patient_id', props.patientId)
    .neq('status', 'cancelled')
    .or('status.eq.completed,checked_in_at.not.is.null')
    .is('deleted_at', null)
    .gte('starts_at', dayStart.toISOString())
    .order('starts_at', { ascending: false })
  if (!appts || appts.length === 0) return null

  const ids = appts.map((a) => a.id)
  const [{ data: covered }, { data: invoices }] = await Promise.all([
    supabase.from('package_sessions').select('appointment_id').in('appointment_id', ids),
    supabase.from('invoices').select('id, invoice_number, total_cents, status, appointment_id').in('appointment_id', ids).eq('status', 'unpaid'),
  ])
  const coveredIds = new Set((covered ?? []).map((c) => c.appointment_id))

  const match = appts.find((a) => !coveredIds.has(a.id))
  if (!match) return null

  const invoice = (invoices ?? []).find((i) => i.appointment_id === match.id) ?? null
  return {
    id: match.id,
    starts_at: match.starts_at,
    practitionerId: match.practitioner_id ?? null,
    typeName: (match.appointment_types as { name: string } | null)?.name ?? null,
    unpaidInvoice: invoice ? { id: invoice.id, invoice_number: invoice.invoice_number, total_cents: invoice.total_cents } : null,
  }
}

async function useSession(purchase: PackagePurchaseRow, dateStr: string = todayDateStr()) {
  if (purchase.sessions_used >= purchase.sessions_total || loggingSessionFor.value) return
  // The button is disabled for a closed bono, but the counter is not what
  // makes it unusable -- a closed bono keeps whatever sessions were left on it
  // -- so nothing here would otherwise stop a stale copy of the row from
  // drawing one.
  if (purchase.is_closed) return
  if (!store.accountId || !store.currentClinicId) return

  // What the patient actually paid per visit when they bought the bono, not
  // whatever an appointment type charges walk-ins -- same rate
  // usePackageSession() reprices a package-covered visit to.
  const perSessionCents = Math.round(purchase.price_cents / purchase.sessions_total)

  // findUncoveredVisitToday only ever looks at today's calendar (it starts
  // from midnight today), so it has nothing useful to say for a backdated
  // entry -- staff catching up on a session from an earlier day is always
  // recording a visit that was never booked here, the same as the
  // "genuinely off-calendar" branch below already handles.
  const isToday = dateStr === todayDateStr()
  const visit = isToday ? await findUncoveredVisitToday() : null
  const visitLabel = visit
    ? `${visit.typeName ?? t('Visit', 'Visita')} · ${new Date(visit.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : null
  // Voiding is offered here rather than left for someone to notice later:
  // the invoice and the session are two records of one visit, and whoever is
  // standing at the desk is the only person who knows they are the same one.
  const voidNote = visit?.unpaidInvoice
    ? ` ${t(
        `${visit.unpaidInvoice.invoice_number ?? 'The unpaid invoice'} for ${money(visit.unpaidInvoice.total_cents)} on that visit will be voided, since the bono covers it.`,
        `Se anulará ${visit.unpaidInvoice.invoice_number ?? 'la factura pendiente'} de ${money(visit.unpaidInvoice.total_cents)} de esa visita, ya que el bono la cubre.`,
      )}`
    : ''
  const body = visit
    ? t(
        `This uses one session against that visit and charges ${money(perSessionCents)} against the bono the patient already paid for.${voidNote}`,
        `Esto consume una sesión de esa visita y carga ${money(perSessionCents)} contra el bono que el paciente ya pagó.${voidNote}`,
      )
    : isToday
      ? t(
          'No completed visit today has this bono against it, so a visit will be recorded now, charged against the bono the patient already paid for.',
          'Ninguna visita completada de hoy tiene este bono asociado, así que se registrará una visita ahora, cargada contra el bono que el paciente ya pagó.',
        )
      : t(
          `A visit will be recorded on ${dateStr}, charged against the bono the patient already paid for.`,
          `Se registrará una visita el ${dateStr}, cargada contra el bono que el paciente ya pagó.`,
        )
  const target = visitLabel ? ` ${t('against', 'contra')} ${visitLabel}` : ''
  const when = isToday ? '' : ` ${t('on', 'el')} ${dateStr}`
  if (!confirm(`${t('Log a session for', 'Registrar una sesión de')} ${money(perSessionCents)}${target}${when} ${t('from', 'de')} "${purchase.package_name}"? ${body}`)) return

  loggingSessionFor.value = purchase.id
  try {
    // Compare-and-set on the count we were rendered with, mirroring
    // usePackageSession: a shared bono can be drawn on from another patient's
    // screen at the same time, and both writes computing used + 1 would give
    // up one session while billing for two.
    const { data: claimed } = await supabase
      .from('package_purchases')
      .update({ sessions_used: purchase.sessions_used + 1 })
      .eq('id', purchase.id)
      .eq('sessions_used', purchase.sessions_used)
      .select('id')
      .maybeSingle()
    if (!claimed) {
      alert(t('Someone just used a session from this bono. Try again.', 'Alguien acaba de usar una sesión de este bono. Inténtalo de nuevo.'))
      await loadAll()
      return
    }

    const now = new Date()
    // The invented appointment's own clock: "now" for the common case, noon
    // on the picked day for a backdated entry -- noon rather than midnight
    // so a timezone conversion can never push it onto the day before.
    const visitTime = isToday ? now : new Date(`${dateStr}T12:00:00`)
    let appointmentId = visit?.id ?? null
    let usedAt = visit?.starts_at ?? visitTime.toISOString()

    if (!appointmentId) {
      // Genuinely off-calendar: a visit that happened without ever being
      // booked. Only then is one invented -- no appointment type to take a
      // duration from, so the schema's own default stands in.
      const ends = new Date(visitTime.getTime() + 30 * 60000)
      const { data: appointment, error: appointmentError } = await supabase
        .from('appointments')
        .insert({
          account_id: store.accountId,
          clinic_id: store.currentClinicId,
          patient_id: props.patientId,
          // The patient's own practitioner, not whoever is logged in. This
          // used to record the front desk: Tomas Berenguer's bono visit
          // went down as recepcion@example.test, a reception account that is
          // not a practitioner at all, which also takes the visit out of the
          // treating practitioner's income. The signed-in member is only the
          // last resort, for a patient with nobody assigned.
          practitioner_id: patientDefaultPractitionerId.value ?? store.teamMember?.id ?? null,
          starts_at: visitTime.toISOString(),
          ends_at: ends.toISOString(),
          status: 'completed',
        })
        .select('id')
        .single()
      if (appointmentError || !appointment) {
        // Stop rather than carry on with no visit. Carrying on is what this
        // used to do: the error was discarded, the session was recorded with
        // appointment_id null, and the patient's bono lost a session that
        // belonged to no visit, with nothing on screen to say so. The session
        // was already claimed above, so give it back -- compare-and-set on the
        // count just written, so a concurrent draw is not undone with it.
        await supabase
          .from('package_purchases')
          .update({ sessions_used: purchase.sessions_used })
          .eq('id', purchase.id)
          .eq('sessions_used', purchase.sessions_used + 1)
        const detail = appointmentError ? ` (${appointmentError.message})` : ''
        alert(
          t(
            `The visit could not be recorded, so no session was used. Try again.${detail}`,
            `No se pudo registrar la visita, así que no se ha usado ninguna sesión. Inténtalo de nuevo.${detail}`,
          ),
        )
        await loadAll()
        return
      }
      appointmentId = appointment.id
      usedAt = visitTime.toISOString()
    } else if (visit?.unpaidInvoice) {
      // One visit, one charge. The bono paid for it, so the invoice raised
      // against it goes -- void rather than deleted, keeping the number in
      // the books. Safe to void unconditionally: findUncoveredVisitToday
      // only returns an unpaid one, and 'void invoice keeps payments'
      // (#169) is about invoices that have some.
      await supabase.from('invoices').update({ status: 'void' }).eq('id', visit.unpaidInvoice.id)
    }

    // The visit on the bono's own history.
    await supabase.from('package_sessions').insert({
      account_id: store.accountId,
      patient_id: props.patientId,
      package_purchase_id: purchase.id,
      appointment_id: appointmentId,
      amount_cents: perSessionCents,
      used_at: usedAt,
    })

    // And its charge, at the bono's per-session rate. This is what draws the
    // prepayment down: the money went into the balance when the bono was
    // bought, and each visit takes its share back out. Marked paid where the
    // balance already covers it, the same rule the imported history follows.
    const { data: chargeNumber } = await supabase.rpc('next_invoice_number', { p_account_id: store.accountId! })
    if (chargeNumber) {
      const { data: charge } = await supabase
        .from('invoices')
        .insert({
          account_id: store.accountId!,
          patient_id: props.patientId,
          appointment_id: appointmentId,
          invoice_number: chargeNumber,
          // The FAMILY's balance, not this patient's: on a shared bono the
          // money sits on the owner's record. See bonoVisitChargeStatus().
          status: await bonoVisitChargeStatus(supabase, props.patientId, perSessionCents, balanceCents.value),
          total_cents: perSessionCents,
        })
        .select('id')
        .single()
      if (charge) {
        await supabase.from('invoice_line_items').insert({
          account_id: store.accountId!,
          invoice_id: charge.id,
          description: bonoSessionDescription(purchase.package_name),
          // Which bono, as a key rather than as words. The description is a
          // copy of the name at purchase time and is not an identifier.
          package_purchase_id: purchase.id,
          quantity: 1,
          price_cents: perSessionCents,
        })
      }
    }

    // Deliberately fires no appointment.completed/invoice.paid automation:
    // this is a back-office correction for a visit that already happened, and
    // the campaigns hanging off those events (review requests, confirmations)
    // would message the patient about it days late.
    await loadAll()
    logSessionForId.value = null
  } finally {
    loggingSessionFor.value = null
  }
}

async function deletePackagePurchase(purchase: PackagePurchaseRow) {
  const usedWarning = purchase.sessions_used > 0 ? ` ${purchase.sessions_used} ${t('of', 'de')} ${purchase.sessions_total} ${t('sessions have already been used.', 'sesiones ya se han utilizado.')}` : ''
  if (!confirm(`${t('Delete', 'Eliminar')} "${purchase.package_name}"? ${t("This can't be undone.", 'Esta acción no se puede deshacer.')}${usedWarning}`)) return
  await supabase.from('package_purchases').delete().eq('id', purchase.id)
  await loadAll()
}

// --- Package sharing: explicit, staff-managed beneficiaries (not inferred
// from any family/tutor relationship) -- shared patients can then draw down
// sessions from this same purchase via usePackageSession/useSession
// elsewhere, since those already just take a purchase id.
interface SharedPatient { id: string; first_name: string; last_name: string | null }
const openSharesPackageId = ref<string | null>(null)
const shares = ref<Record<string, SharedPatient[]>>({})
const shareSearch = ref('')
const shareResults = ref<SharedPatient[]>([])
let shareDebounce: ReturnType<typeof setTimeout> | undefined

async function loadShares(packageId: string) {
  const { data } = await supabase
    .from('package_purchase_shares')
    .select('patients(id, first_name, last_name)')
    .eq('package_purchase_id', packageId)
  shares.value[packageId] = (data ?? []).map((r) => r.patients).filter((p): p is SharedPatient => p !== null)
}

function toggleShares(packageId: string) {
  openSharesPackageId.value = openSharesPackageId.value === packageId ? null : packageId
  shareSearch.value = ''
  shareResults.value = []
  if (openSharesPackageId.value) loadShares(packageId)
}

watch(shareSearch, (value) => {
  clearTimeout(shareDebounce)
  if (!value.trim()) {
    shareResults.value = []
    return
  }
  shareDebounce = setTimeout(async () => {
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .neq('id', props.patientId)
      .ilike('search_name', `%${normalizeSearchTerm(value.trim())}%`)
      .limit(8)
    shareResults.value = data ?? []
  }, 250)
})

async function addShare(packageId: string, patient: SharedPatient) {
  await supabase.from('package_purchase_shares').insert({ account_id: store.accountId!, package_purchase_id: packageId, patient_id: patient.id })
  shareSearch.value = ''
  shareResults.value = []
  await loadShares(packageId)
}

async function removeShare(packageId: string, patientId: string) {
  await supabase.from('package_purchase_shares').delete().eq('package_purchase_id', packageId).eq('patient_id', patientId)
  await loadShares(packageId)
}

async function activateMembership() {
  const tpl = membershipTemplates.value.find((m) => m.id === activateMembershipId.value)
  if (!tpl) return
  const amountCents = Math.round((parseFloat(activateAmountPaid.value) || 0) * 100)
  if (activateMethod.value === 'credit' && amountCents > spendableCreditCents.value) {
    creditError.value = t('Amount exceeds available credit.', 'El importe supera el crédito disponible.')
    return
  }
  activatingMembership.value = true
  const { data: newMembership } = await supabase
    .from('patient_memberships')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      membership_id: tpl.id,
      membership_name: tpl.name,
      price_cents: tpl.price_cents,
      created_by: store.teamMember?.id ?? null,
    })
    .select('id')
    .single()
  if (newMembership) fire('membership.new_member', { patientId: props.patientId, membershipId: newMembership.id })
  if (amountCents > 0) await recordSalePayment(tpl.name, amountCents, activateMethod.value)
  activatingMembership.value = false
  activateMembershipId.value = ''
  activateAmountPaid.value = ''
  activateMethod.value = 'cash'
  await Promise.all([loadAll(), refreshCreditSummary(), loadFacturas()])
}

async function setMembershipStatus(m: PatientMembershipRow, status: string) {
  await supabase.from('patient_memberships').update({ status }).eq('id', m.id)
  if (status === 'cancelled') fire('membership.removed', { patientId: props.patientId, membershipId: m.id })
  await loadAll()
}

function paymentsFor(membershipId: string) {
  return membershipPayments.value.filter((p) => p.patient_membership_id === membershipId)
}

async function logPayment(m: PatientMembershipRow, status: 'paid' | 'failed') {
  const periodStart = new Date()
  periodStart.setDate(1)
  await supabase.from('membership_payments').insert({
    account_id: store.accountId!,
    patient_membership_id: m.id,
    period_start: periodStart.toISOString().slice(0, 10),
    amount_cents: m.price_cents,
    status,
  })
  await loadAll()
}


// -- Money asks three questions, so the tab answers them in three places ---
// "What do they owe right now", "what have they already got with us", and
// "how do they pay". Those were one flat strip of figures, which meant
// reading all of it to answer any of it.
// Only the ledger and the documents swap; bonos and memberships stay
// below both. The sub-nav exists to give the ledger the full width, and it
// can do that without demoting the actions staff take every day.
const subTab = ref<'ledger' | 'documents'>('ledger')

/** The oldest unpaid charge -- "since when" is the useful half of "how much". */
const oldestUnpaid = computed(() => {
  const open = invoices.value
    .filter((i) => i.status === 'unpaid' && !i.is_refund)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  return open[0] ?? null
})

// Which card, not just whether. See server/api/stripe/card-details -- read
// live, because a reissued card changes its expiry under us and a stale
// last-four is worse than none.
interface CardDetails { brand: string; last4: string; expMonth: number; expYear: number }
const cardDetails = ref<CardDetails | null>(null)
async function loadCardDetails() {
  cardDetails.value = null
  if (!hasCard.value) return
  try {
    const res = await useStaffFetch<{ card: CardDetails | null }>('/api/stripe/card-details', {
      method: 'POST',
      body: { patientId: props.patientId },
    })
    cardDetails.value = res.card
  } catch {
    // Without billing_config, or with Stripe unreachable, the card still
    // exists -- the screen just cannot name it.
    cardDetails.value = null
  }
}
watch(hasCard, loadCardDetails, { immediate: true })

/** "Visa •••• 4242" -- brand capitalised the way the issuer writes it. */
const cardLabel = computed(() => {
  const card = cardDetails.value
  if (!card) return null
  const brand = card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
  return `${brand} •••• ${card.last4}`
})
const cardExpiry = computed(() => {
  const card = cardDetails.value
  if (!card) return null
  return `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
})

/**
 * Where credit that has already been spent went. "The credit is gone" and
 * "the credit paid for something" look identical in a balance, and the
 * second is the one staff are usually trying to confirm.
 */
const appliedCreditNote = computed(() => {
  const applied = ledgerCredits.value.filter((c) => c.amount_cents < 0 && c.invoice_id)
  if (applied.length === 0) return null
  const total = applied.reduce((sum, c) => sum + Math.abs(c.amount_cents), 0)
  const refs = applied
    .map((c) => invoices.value.find((i) => i.id === c.invoice_id)?.invoice_number)
    .filter((n): n is string => !!n)
  if (refs.length === 0) return `${money(total)} ${t('of credit has been applied to charges.', 'de crédito se ha aplicado a cargos.')}`
  const shown = refs.slice(0, 2).join(', ')
  const more = refs.length > 2 ? ` ${t('and', 'y')} ${refs.length - 2} ${t('more', 'más')}` : ''
  return `${money(total)} ${t('of credit applied to', 'de crédito aplicado a')} ${shown}${more}.`
})

/** Bonos with sessions still on them -- what the patient already holds. */
// Since the summary card stopped listing bonos, this is only asked whether
// the patient has anything on account at all -- so a bono PracticeHub has
// closed does not count, the same way its sessions do not count as money in
// committedBonoCents. A closed bono and no credit reads "Nothing on account",
// which is what the figures beside it say.
const activePurchases = computed(() => purchases.value.filter((p) => !p.is_closed && p.sessions_total - p.sessions_used > 0))

function money(cents: number) {
  return formatEur(cents)
}
</script>

<template>
  <div class="space-y-4">
    <!-- Three questions, three places. Owed now is a danger surface because
    it is the only one of the three that is a problem. -->
    <div class="grid gap-4 lg:grid-cols-3">
      <!-- 1. What do they owe right now -->
      <section
        aria-labelledby="money-owed"
        class="rounded-card border p-4 shadow-card"
        :class="outstandingCents > 0 ? 'border-danger-border bg-danger-bg' : 'border-line bg-surface'"
      >
        <h3 id="money-owed" class="text-[12px] font-semibold uppercase tracking-[.04em]" :class="outstandingCents > 0 ? 'text-danger-text' : 'text-ink-muted2'">
          {{ t('Owed now', 'Debe ahora') }}
        </h3>
        <p class="mt-1 font-mono text-[24px] font-semibold" :class="outstandingCents > 0 ? 'text-danger-text' : 'text-ink-700'">
          {{ money(outstandingCents) }}
        </p>
        <p v-if="oldestUnpaid" class="mt-0.5 text-[12px]" :class="outstandingCents > 0 ? 'text-danger-text' : 'text-ink-muted2'">
          {{ t('Oldest unpaid', 'Más antiguo') }} <span class="font-mono">{{ oldestUnpaid.invoice_number }}</span>,
          {{ formatLongDate(oldestUnpaid.created_at) }}
        </p>
        <p v-else class="mt-0.5 text-[12px] text-ink-muted2">{{ t('Nothing outstanding.', 'Nada pendiente.') }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <UiBtn variant="primary" size="sm" @click="activePanel === 'payment' ? (activePanel = null) : openTakePayment()">
            {{ t('Take payment', 'Registrar pago') }}
          </UiBtn>
        </div>
      </section>

      <!-- 2. What have they already got with us -->
      <section aria-labelledby="money-account" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <h3 id="money-account" class="text-[12px] font-semibold uppercase tracking-[.04em] text-ink-muted2">
          {{ t('On account', 'En cuenta') }}
        </h3>
        <!-- Named, not just shown. "Available" is what this figure is called
             everywhere else in the app, and an unlabelled number invites the
             reader to guess which of the account's several totals it is. -->
        <p class="mt-1 font-mono text-[24px] font-semibold text-ink-900">{{ money(availableCents) }}</p>
        <p class="text-[11px] text-ink-muted2">{{ t('Available', 'Disponible') }}</p>
        <!-- A real definition list, not prose. These four are the figures
             other screens and specs address by name, and a sentence that
             merely contains the words is not the same contract. -->
        <dl class="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
          <div class="flex items-baseline gap-1.5">
            <dt class="text-[11px] text-ink-muted2">{{ t('Credit', 'Crédito') }}</dt>
            <dd class="font-mono text-[12px] text-ink-700">{{ money(creditLedgerCents) }}</dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt class="text-[11px] text-ink-muted2">{{ t('In bonos', 'En bonos') }}</dt>
            <dd class="font-mono text-[12px] text-ink-700">{{ money(committedBonoCents) }}</dd>
          </div>
        </dl>

        <!-- The bonos themselves are NOT listed here. This card used to
             repeat each one -- name, sessions left, progress bar, purchase
             date -- which was reasonable while the full Packages / bonos card
             sat below the whole account ledger. Now that the bonos card is
             directly underneath, the same bono appeared twice within a few
             hundred pixels, with two progress bars, and read as a bug.
             "In bonos" above is the part that belongs to a money summary;
             how many sessions are left is the card below's job. -->
        <p v-if="activePurchases.length === 0 && creditLedgerCents === 0" class="mt-3 text-[12px] text-ink-faint">
          {{ t('Nothing on account.', 'Nada en cuenta.') }}
        </p>

        <!-- Credit that has already been spent says where it went, because
             "the credit is gone" and "the credit paid for something" look
             identical in a balance. -->
        <p v-if="appliedCreditNote" class="mt-2.5 border-t border-line-divider pt-2.5 text-[11.5px] text-ink-muted2">
          {{ appliedCreditNote }}
        </p>
        <!-- The two figures that describe the account's history rather than
             its state. They were in the strip this card replaced, and losing
             them would have been a quiet regression. -->
        <dl class="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 border-t border-line-divider pt-2.5">
          <div class="flex items-baseline gap-1.5">
            <dt class="text-[11px] text-ink-muted2">{{ t('Balance', 'Saldo') }}</dt>
            <dd class="font-mono text-[12px]" :class="balanceCents < 0 ? 'text-danger-text' : 'text-ink-700'">{{ money(balanceCents) }}</dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt class="text-[11px] text-ink-muted2">{{ t('Lifetime', 'Total histórico') }}</dt>
            <dd class="font-mono text-[12px] text-ink-700">{{ money(lifetimeCents) }}</dd>
          </div>
        </dl>

        <div class="mt-3">
          <UiBtn variant="secondary" size="sm" @click="activePanel = activePanel === 'credit' ? null : 'credit'">
            {{ t('Add credit', 'Añadir crédito') }}
          </UiBtn>
        </div>
      </section>

      <!-- 3. How do they pay -->
      <section aria-labelledby="money-how" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <h3 id="money-how" class="text-[12px] font-semibold uppercase tracking-[.04em] text-ink-muted2">
          {{ t('How they pay', 'Cómo paga') }}
        </h3>
        <p class="mt-1 font-mono text-[15px] font-medium text-ink-900">
          {{ cardLabel ?? (hasCard ? t('Card on file', 'Tarjeta registrada') : t('No card on file', 'Sin tarjeta')) }}
        </p>
        <p class="mt-0.5 text-[12px] text-ink-muted2">
          <template v-if="cardExpiry">{{ t('Expires', 'Caduca') }} <span class="font-mono">{{ cardExpiry }}</span> · </template>
          {{ hasCard
            ? t('Charges and autopay can run against it.', 'Los cobros y la domiciliación pueden usarla.')
            : t('Send the patient a link to add one.', 'Envía al paciente un enlace para añadirla.') }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <UiBtn variant="secondary" size="sm" @click="showCardModal = true">
            {{ hasCard ? t('Replace card', 'Sustituir tarjeta') : t('Add card', 'Añadir tarjeta') }}
          </UiBtn>
          <UiBtn variant="secondary" size="sm" :disabled="copyingCardLink" @click="copyCardLink">
            {{ copyingCardLink ? t('Copying…', 'Copiando…') : t('Copy card link', 'Copiar enlace de tarjeta') }}
          </UiBtn>
          <UiBtn v-if="hasCard" variant="secondary" size="sm" :disabled="removingCard" @click="removeCard">
            {{ removingCard ? t('Removing…', 'Eliminando…') : t('Remove card', 'Eliminar tarjeta') }}
          </UiBtn>
        </div>
      </section>
    </div>

    <!-- The panels the cards above open. -->
    <div v-if="activePanel" class="rounded-card border border-line bg-surface p-4 shadow-card">
      <div v-if="activePanel === 'credit'" class="mt-4 border-t border-line-divider pt-4">
        <form class="flex flex-wrap items-end gap-2" @submit.prevent="addCredit">
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Amount (€)', 'Importe (€)') }}</label>
            <input v-model="addCreditAmount" type="number" min="0" step="0.01" class="mt-0.5 w-24 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]" />
          </div>
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Method', 'Método') }}</label>
            <select v-model="addCreditMethod" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]">
              <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
            </select>
          </div>
          <div class="flex-1">
            <label class="block text-[11px] text-ink-muted">{{ t('Reason', 'Motivo') }}</label>
            <input v-model="addCreditReason" type="text" :placeholder="t('e.g. Birthday gift', 'p. ej. regalo de cumpleaños')" class="mt-0.5 w-full rounded-ctlSm border border-line-control px-2 py-1 text-[13px]" />
          </div>
          <UiBtn variant="primary" size="sm" :disabled="!addCreditAmount || addingCredit" @click="addCredit">{{ addingCredit ? t('Adding…', 'Añadiendo…') : t('Add credit', 'Añadir crédito') }}</UiBtn>
        </form>

        <form v-if="spendableCreditCents > 0 && unpaidInvoices.length > 0" class="mt-3 flex flex-wrap items-end gap-2 border-t border-line-divider pt-3" @submit.prevent="applyCreditToInvoice">
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Apply to receipt', 'Aplicar a recibo') }}</label>
            <select v-model="applyCreditInvoiceId" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]">
              <option value="" disabled>{{ t('Select receipt…', 'Seleccionar recibo…') }}</option>
              <option v-for="inv in unpaidInvoices" :key="inv.id" :value="inv.id">{{ inv.invoice_number }} ({{ money(inv.total_cents) }})</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Amount (€)', 'Importe (€)') }}</label>
            <input v-model="applyCreditAmount" type="number" min="0" step="0.01" class="mt-0.5 w-24 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]" />
          </div>
          <UiBtn variant="secondary" size="sm" :disabled="!applyCreditInvoiceId || !applyCreditAmount || applyingCredit" @click="applyCreditToInvoice">
            {{ applyingCredit ? t('Applying…', 'Aplicando…') : t('Apply credit', 'Aplicar crédito') }}
          </UiBtn>
        </form>

        <p v-if="creditError" class="mt-2 text-[12px] text-danger-text">{{ creditError }}</p>
      </div>

      <div v-if="activePanel === 'payment'" class="mt-4 border-t border-line-divider pt-4">
        <form v-if="unpaidInvoices.length > 0" class="space-y-2" @submit.prevent="takePayment">
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Receipt', 'Recibo') }}</label>
            <select v-model="paymentInvoiceId" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]">
              <option v-for="inv in unpaidInvoices" :key="inv.id" :value="inv.id">{{ inv.invoice_number }} ({{ money(inv.total_cents) }})</option>
            </select>
          </div>

          <!-- One row per payment method -- usually just one, but "+ split
               payment" adds another so a patient paying part cash, part card
               only needs a single "Record payment" click. -->
          <div v-for="(row, i) in paymentRows" :key="i" class="flex flex-wrap items-end gap-2">
            <div>
              <label class="block text-[11px] text-ink-muted">{{ t('Amount (€)', 'Importe (€)') }}</label>
              <input v-model="row.amount" type="number" min="0" step="0.01" class="mt-0.5 w-24 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]" />
            </div>
            <div>
              <label class="block text-[11px] text-ink-muted">{{ t('Method', 'Método') }}</label>
              <select v-model="row.method" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]">
                <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
                <!-- Not one of the configured methods: this spends the
                     patient's own balance rather than taking money, so it is
                     offered separately and only when there is some. -->
                <option value="credit" :disabled="spendableCreditCents <= 0">
                  {{ t('Credit on account', 'Crédito en cuenta') }}
                  ({{ spendableCreditCents > 0 ? `${formatEur(spendableCreditCents)} ${t('available', 'disponible')}` : t('none available', 'sin crédito') }})
                </option>
              </select>
            </div>
            <button
              v-if="paymentRows.length > 1"
              type="button"
              class="mb-1 text-[11.5px] text-ink-faint hover:text-danger-text"
              @click="removePaymentRow(i)"
            >
              {{ t('Remove', 'Quitar') }}
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" class="text-[11.5px] font-medium text-ink-muted hover:text-brand-text" @click="addPaymentRow">
              + {{ t('Split into another method', 'Dividir en otro método') }}
            </button>
            <span v-if="paymentRows.length > 1" class="text-[11.5px] text-ink-faint">{{ t('Total:', 'Total:') }} {{ money(paymentTotalCents) }}</span>
            <UiBtn variant="primary" size="sm" :disabled="!paymentInvoiceId || paymentTotalCents <= 0 || takingPayment" @click="takePayment">
              {{ takingPayment ? t('Recording…', 'Registrando…') : t('Record payment', 'Registrar pago') }}
            </UiBtn>
          </div>
        </form>
        <p v-else class="text-[12.5px] text-ink-faint">{{ t('No unpaid receipts to take a payment against.', 'No hay recibos pendientes contra los que registrar un pago.') }}</p>
        <p v-if="paymentError" class="mt-2 text-[12px] text-danger-text">{{ paymentError }}</p>
      </div>
    </div>

    <!-- Bonos and memberships first, then the ledger.

    These two are what the front desk reaches for at the counter -- how many
    sessions are left, is the membership still active -- and they sat under a
    ledger that grows a row per visit, so answering "how many left?" meant
    scrolling past a year of history every time. The ledger is the thing you
    go looking for; these are the things you glance at.

    They stay outside the sub-nav below because they belong to both halves of
    it: a bono is as relevant next to the receipts as it is next to the
    ledger. -->
    <div class="space-y-4">
      <!-- Packages / bonos -- always on screen, above the sub-nav. -->
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Packages / bonos', 'Bonos') }}</p>
        <div v-if="packagesLoading" class="mt-3 space-y-3">
          <div v-for="i in 2" :key="i" class="rounded-ctl border border-line-divider p-3.5">
            <div class="flex items-center justify-between gap-2">
              <UiSkeleton class="h-3.5 w-32 rounded" />
              <UiSkeleton class="h-3 w-20 rounded" />
            </div>
            <UiSkeleton class="mt-2.5 h-[6px] w-full rounded-full" />
            <UiSkeleton class="mt-2 h-3 w-40 rounded" />
            <div class="mt-3 flex gap-1.5 border-t border-line-divider pt-3">
              <UiSkeleton class="h-[26px] w-24 rounded-ctl" />
              <UiSkeleton class="h-[26px] w-24 rounded-ctl" />
            </div>
          </div>
        </div>
        <template v-else>
        <div class="mt-3 space-y-3">
          <!-- data-cy so the specs can scope to one bono's card by name;
               everything in here is styling classes otherwise. -->
          <div v-for="p in purchases" :key="p.id" data-cy="bono-card" class="rounded-ctl border border-line-divider p-3.5">
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <div class="flex min-w-0 items-center gap-2">
                <p class="truncate text-[13.5px] font-semibold text-ink-800">{{ p.package_name }}</p>
                <UiPill v-if="p.is_closed" tone="neutral">{{ t('Closed', 'Cerrado') }}</UiPill>
                <UiPill v-else-if="p.shared" tone="info">{{ p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido') }}</UiPill>
                <UiPill v-else-if="packageOwedCents(p) > 0" tone="danger">{{ money(packageOwedCents(p)) }} {{ t('owed', 'pendiente') }}</UiPill>
                <UiPill v-else tone="success">{{ t('Paid', 'Pagado') }}</UiPill>
              </div>
              <!-- Sessions left, and what they are worth. The line under the
              bar says what the bono COST, which is a different number -- both
              used to read "11/12 left" followed by an unlabelled euro figure,
              so the two were indistinguishable without reading this file. -->
              <p class="shrink-0 text-[12px] text-ink-muted2">
                <span class="font-semibold text-ink-700">{{ p.sessions_total - p.sessions_used }}</span>
                {{ t('of', 'de') }} {{ p.sessions_total }} {{ t('sessions left', 'sesiones restantes') }}
                <!-- No "worth" figure on a closed bono: the sessions left on
                it are a fact about its counter, the euros are a claim about
                what the patient can spend, and PracticeHub says they cannot
                spend these. Printing both is how the two figures above came
                to disagree. -->
                <template v-if="!p.shared && !p.is_closed">
                  <span class="px-1 text-ink-faint3">&middot;</span>
                  {{ t('worth', 'valor') }}
                  <span class="font-semibold text-ink-700">{{ money(packageRemainingValueCents(p)) }}</span>
                </template>
              </p>
            </div>

            <div class="mt-2.5 h-[6px] w-full overflow-hidden rounded-full bg-line-faint">
              <div class="h-full rounded-full bg-brand" :style="{ width: `${Math.min(100, Math.round((p.sessions_used / p.sessions_total) * 100))}%` }" />
            </div>

            <!-- What the bono cost and how much of it has been paid. The
            session count is not repeated here: it is already stated above the
            bar, and printing it twice with a different amount beside it each
            time is what made this card unreadable. -->
            <p v-if="!p.shared" class="mt-2 text-[11.5px] text-ink-muted2">
              <template v-if="packageOwedCents(p) > 0">
                {{ money(p.price_cents - packageOwedCents(p)) }} {{ t('paid of', 'pagado de') }} {{ money(p.price_cents) }}
              </template>
              <template v-else>{{ money(p.price_cents) }} {{ t('paid in full', 'pagado en su totalidad') }}</template>
            </p>
            <p v-else class="mt-2 text-[11.5px] text-ink-muted2">
              {{ p.sessions_used }} {{ t('of', 'de') }} {{ p.sessions_total }} {{ t('used', 'usadas') }}
            </p>

            <!-- One button row with a real hierarchy: the everyday action
            filled, the money action outlined, the rest quiet, destructive
            pushed to the far end. The old row was five bare text links in
            four different colors, which read as decoration rather than
            controls. -->
            <div class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line-divider pt-3">
              <UiBtn size="sm" variant="primary" :disabled="p.is_closed || p.sessions_used >= p.sessions_total || loggingSessionFor !== null" @click="openLogSession(p)">
                {{ loggingSessionFor === p.id ? t('Logging…', 'Registrando…') : t('Log session', 'Registrar sesión') }}…
              </UiBtn>
              <!-- Everything below manages the PURCHASE itself (its invoice,
              who it's shared with, deleting it) -- only the owner's own card
              shows these. A beneficiary viewing a bono shared to them can
              draw a session from it, same as the owner, but shouldn't see
              actions that imply they bought or control it. -->
              <template v-if="!p.shared">
                <UiBtn v-if="packageOwedCents(p) > 0" size="sm" variant="secondary" @click="collectOnPackage(p)">
                  {{ t('Take payment', 'Cobrar') }}…
                </UiBtn>
                <UiBtn size="sm" variant="secondary" @click="toggleLinkPayment(p.id)">
                  {{ t('Link payment', 'Vincular pago') }}{{ linkedPaymentsFor(p).length ? ` (${linkedPaymentsFor(p).length})` : '' }}…
                </UiBtn>
                <UiBtn size="sm" variant="secondary" @click="toggleShares(p.id)">
                  {{ t('Share', 'Compartir') }}{{ shares[p.id]?.length ? ` (${shares[p.id].length})` : '' }}…
                </UiBtn>
                <UiIconBtn v-if="can('billing_config')" icon="trash" tone="danger" class="ml-auto" :label="t('Delete', 'Eliminar')" @click="deletePackagePurchase(p)" />
              </template>
            </div>

            <!-- Defaults to today, so the common case (the session that just
            happened) is one click. The date only needs changing to catch up
            on a visit from an earlier day -- see useSession's isToday branch
            for what changes once it's not today. -->
            <div v-if="logSessionForId === p.id" class="mt-2.5 rounded-ctl border border-line-divider bg-surface-subtle p-2.5">
              <div class="flex flex-wrap items-end gap-2">
                <div>
                  <label class="block text-[11px] text-ink-muted">{{ t('Date', 'Fecha') }}</label>
                  <input v-model="logSessionDate" type="date" :max="todayDateStr()" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]" />
                </div>
                <UiBtn size="sm" variant="primary" :disabled="!logSessionDate || loggingSessionFor !== null" @click="useSession(p, logSessionDate)">
                  {{ loggingSessionFor === p.id ? t('Logging…', 'Registrando…') : t('Log session', 'Registrar sesión') }}
                </UiBtn>
              </div>
            </div>

            <div v-if="openSharesPackageId === p.id" class="mt-2.5 rounded-ctl border border-line-divider bg-surface-subtle p-2.5">
              <ul v-if="shares[p.id]?.length" class="space-y-1">
                <li v-for="sp in shares[p.id]" :key="sp.id" class="flex items-center justify-between text-[11.5px] text-ink-600">
                  <span>{{ sp.first_name }} {{ sp.last_name }}</span>
                  <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeShare(p.id, sp.id)">✕</button>
                </li>
              </ul>
              <div class="relative mt-1.5 max-w-sm">
                <input
                  v-model="shareSearch"
                  type="text"
                  :placeholder="t('Search a patient to share with…', 'Buscar un paciente con quien compartir…')"
                  class="w-full rounded-ctlSm border border-line-control bg-surface px-2.5 py-1.5 text-[12px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <ul v-if="shareResults.length" class="absolute z-10 mt-1 w-full rounded-ctlSm border border-line bg-surface shadow-popover">
                  <li
                    v-for="sp in shareResults"
                    :key="sp.id"
                    class="cursor-pointer px-2 py-1 text-[11.5px] text-ink-700 hover:bg-surface-subtle"
                    @click="addShare(p.id, sp)"
                  >
                    {{ sp.first_name }} {{ sp.last_name }}
                  </li>
                </ul>
              </div>
            </div>

            <div v-if="collectOnPackageId === p.id" class="mt-2.5 rounded-ctl border border-line-divider bg-surface-subtle p-2.5">
              <div class="flex flex-wrap items-end gap-2">
                <div>
                  <label class="block text-[11px] text-ink-muted">{{ t('Amount', 'Importe') }}</label>
                  <input v-model="collectAmount" type="number" step="0.01" min="0" class="bg-surface mt-0.5 w-28 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]" />
                </div>
                <div>
                  <label class="block text-[11px] text-ink-muted">{{ t('Method', 'Método') }}</label>
                  <select v-model="collectMethod" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]">
                    <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
                    <option value="credit" :disabled="spendableCreditCents <= 0">
                      {{ t('Credit on account', 'Crédito en cuenta') }}
                      ({{ spendableCreditCents > 0 ? `${money(spendableCreditCents)} ${t('available', 'disponible')}` : t('none available', 'sin crédito') }})
                    </option>
                  </select>
                </div>
                <UiBtn size="sm" variant="primary" :disabled="collectingPayment" @click="submitPackageCollection(p)">
                  {{ collectingPayment ? t('Recording…', 'Registrando…') : t('Record payment', 'Registrar pago') }}
                </UiBtn>
              </div>
              <p v-if="collectError" class="mt-1.5 text-[11.5px] text-danger-text">{{ collectError }}</p>
              <p class="mt-1.5 text-[11.5px] text-ink-faint">
                {{ t('Goes straight onto the bono — a factura is issued for it.', 'Va directamente al bono: se emite una factura por el importe.') }}
              </p>
            </div>

            <div v-if="openLinkPaymentId === p.id" class="mt-2.5 rounded-ctl border border-line-divider bg-surface-subtle p-2.5">
              <ul v-if="linkedPaymentsFor(p).length" class="space-y-1">
                <li v-for="pay in linkedPaymentsFor(p)" :key="pay.id" class="flex items-center justify-between text-[11.5px] text-ink-600">
                  <span>{{ money(pay.amount_cents) }} &middot; {{ pay.method }} &middot; {{ new Date(pay.paid_at).toLocaleDateString() }}</span>
                  <button type="button" class="text-ink-faint hover:text-danger-text" @click="unlinkPayment(pay.id)">✕</button>
                </li>
              </ul>
              <div v-if="candidatePaymentsFor(p).length" class="mt-1.5 flex flex-wrap items-center gap-1.5">
                <select v-model="linkPaymentSelection" class="w-full max-w-sm rounded-ctlSm border border-line-control bg-surface px-2.5 py-1.5 text-[12px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand">
                  <option value="" disabled>{{ t('-- Select a payment --', '-- Selecciona un pago --') }}</option>
                  <option v-for="pay in candidatePaymentsFor(p)" :key="pay.id" :value="pay.id">
                    {{ money(pay.amount_cents) }} &middot; {{ pay.method }} &middot; {{ new Date(pay.paid_at).toLocaleDateString() }} &middot; {{ invoiceNumberFor(pay.invoice_id) }}
                  </option>
                </select>
                <UiBtn size="sm" variant="primary" :disabled="!linkPaymentSelection || linkingPayment" @click="linkPaymentToPackage(p)">
                  {{ t('Link', 'Vincular') }}
                </UiBtn>
              </div>
              <p v-else-if="!linkedPaymentsFor(p).length" class="mt-1.5 text-[11.5px] text-ink-faint">
                {{ t('No unlinked payments to link.', 'No hay pagos sin vincular.') }}
              </p>
            </div>

            <!-- Autopay charges the CURRENT patient's own card to pay off
            this purchase -- meaningless from a beneficiary's view of a bono
            they didn't buy, so the whole block (including the "add a card"
            prompt) is owner-only, same as the button row above. -->
            <template v-if="!p.shared">
            <div v-if="scheduleForPackage(p.id)" class="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-line-divider bg-surface-subtle px-3 py-2">
              <span class="flex items-center gap-1.5 text-[11.5px] text-ink-600">
                {{ t('Autopay', 'Pago automático') }} <UiPill :tone="scheduleTone[scheduleForPackage(p.id)!.status] ?? 'neutral'">{{ scheduleForPackage(p.id)!.status }}</UiPill>
                {{ scheduleForPackage(p.id)!.installments_paid }}/{{ scheduleForPackage(p.id)!.installments_total }}
              </span>
              <UiBtn v-if="scheduleForPackage(p.id)!.status === 'active'" size="sm" variant="ghost" class="hover:text-danger-text" @click="cancelAutopay(scheduleForPackage(p.id)!.id)">
                {{ t('Cancel', 'Cancelar') }}
              </UiBtn>
            </div>
            <div v-else-if="hasCard" class="mt-2.5">
              <UiBtn v-if="autopayFormFor !== p.id" size="sm" variant="ghost" @click="openAutopayForm(p.id)">
                {{ t('Set up autopay', 'Configurar pago automático') }}
              </UiBtn>
              <form v-else class="flex flex-wrap items-end gap-1.5 rounded-ctl border border-line-divider bg-surface-subtle p-2.5" @submit.prevent="setUpPackageAutopay(p)">
                <input v-model.number="autopayInstallments" type="number" min="1" :title="t('Installments', 'Plazos')" class="h-[26px] w-14 rounded-ctlSm border border-line-control bg-surface px-1.5 text-[12px]" />
                <input v-model.number="autopayIntervalCount" type="number" min="1" :title="t('Every', 'Cada')" class="h-[26px] w-12 rounded-ctlSm border border-line-control bg-surface px-1.5 text-[12px]" />
                <select v-model="autopayInterval" class="h-[26px] rounded-ctlSm border border-line-control bg-surface px-1.5 text-[12px]">
                  <option value="day">{{ t('day(s)', 'día(s)') }}</option>
                  <option value="week">{{ t('week(s)', 'semana(s)') }}</option>
                  <option value="month">{{ t('month(s)', 'mes(es)') }}</option>
                  <option value="year">{{ t('year(s)', 'año(s)') }}</option>
                </select>
                <input v-model.number="autopayAlreadyPaid" type="number" min="0" :title="t('Already paid', 'Ya pagado')" class="h-[26px] w-14 rounded-ctlSm border border-line-control bg-surface px-1.5 text-[12px]" />
                <UiBtn type="submit" size="sm" variant="primary" :disabled="settingUpAutopay">
                  {{ settingUpAutopay ? '…' : t('Start', 'Iniciar') }}
                </UiBtn>
                <UiBtn size="sm" variant="ghost" @click="autopayFormFor = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
                <p v-if="autopayError" class="w-full text-[11px] text-danger-text">{{ autopayError }}</p>
              </form>
            </div>
            <div v-else class="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-line-divider bg-surface-subtle px-3 py-2">
              <span class="text-[11.5px] text-ink-muted2">{{ t("No card on file -- add one to enable autopay for the remaining balance.", 'No hay tarjeta registrada; añade una para habilitar el pago automático del saldo restante.') }}</span>
              <UiBtn size="sm" variant="secondary" @click="showCardModal = true">{{ t('Add card', 'Añadir tarjeta') }}</UiBtn>
            </div>
            </template>
          </div>
          <p v-if="purchases.length === 0" class="rounded-ctl border border-dashed border-line-control p-4 text-center text-[12.5px] text-ink-faint">
            {{ t('No packages purchased.', 'No se ha comprado ningún bono.') }}
          </p>
        </div>
        <form class="mt-3 flex flex-wrap items-end gap-2 border-t border-line-divider pt-3" @submit.prevent="sellPackage">
          <select v-model="sellPackageId" class="bg-surface w-full flex-1 rounded-ctl border border-line-control px-2.5 py-1.5 text-[12.5px] sm:max-w-xs">
            <option value="" disabled>{{ t('Sell a package…', 'Vender un bono…') }}</option>
            <option v-for="t in packageTemplates" :key="t.id" :value="t.id">{{ t.name }} ({{ t.session_count }}, {{ money(t.price_cents) }})</option>
          </select>
          <div v-if="sellPackageId">
            <label class="block text-[11px] text-ink-muted">{{ t('Paid now (€)', 'Pagado ahora (€)') }}</label>
            <input v-model="sellAmountPaid" type="number" min="0" step="0.01" class="mt-0.5 w-24 rounded-ctlSm border border-line-control px-2 py-1 text-[12.5px]" />
          </div>
          <div v-if="sellPackageId && Number(sellAmountPaid) > 0">
            <label class="block text-[11px] text-ink-muted">{{ t('Method', 'Método') }}</label>
            <select v-model="sellMethod" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[12.5px]">
              <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
              <!--
                Always rendered, disabled when there is nothing spendable,
                rather than hidden. Hidden, paying from credit looked like
                something the app couldn't do at all: there was no way to tell
                "this patient has no credit" apart from "this isn't possible
                here", and with only three patients in the database holding an
                account_credits row, nobody ever saw it appear.
              -->
              <option value="credit" :disabled="spendableCreditCents <= 0">
                {{ t('Credit on account', 'Crédito en cuenta') }}
                ({{ spendableCreditCents > 0 ? `${formatEur(spendableCreditCents)} ${t('available', 'disponible')}` : t('none available', 'sin crédito') }})
              </option>
            </select>
          </div>
          <UiBtn size="sm" variant="secondary" :disabled="!sellPackageId || sellingPackage" @click="sellPackage">{{ sellingPackage ? t('Selling…', 'Vendiendo…') : t('Sell', 'Vender') }}</UiBtn>
        </form>
        <p v-if="sellPackageId && Number(sellAmountPaid) > 0 && packageTemplates.find((t) => t.id === sellPackageId) && Number(sellAmountPaid) * 100 < packageTemplates.find((t) => t.id === sellPackageId)!.price_cents" class="mt-1.5 text-[11px] text-ink-faint">
          {{ t('Remaining balance can be scheduled via Stripe autopay after the sale.', 'El saldo restante se puede programar mediante el pago automático de Stripe después de la venta.') }}
        </p>
        </template>
      </div>

      <!-- Memberships -->
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Memberships', 'Membresías') }}</p>
        <div v-if="membershipsLoading" class="mt-3 space-y-3">
          <div v-for="i in 2" :key="i" class="rounded-ctl border border-line-divider p-3">
            <div class="flex items-center justify-between gap-2">
              <UiSkeleton class="h-3.5 w-32 rounded" />
              <UiSkeleton class="h-4 w-14 rounded-pill" />
            </div>
            <UiSkeleton class="mt-2 h-3 w-44 rounded" />
          </div>
        </div>
        <template v-else>
        <div v-if="patientMemberships.length === 0" class="mt-3 rounded-ctl border border-dashed border-line-control p-4 text-center text-[12.5px] text-ink-faint">
          {{ t('No active memberships for this patient.', 'Este paciente no tiene membresías activas.') }}
        </div>
        <div v-else class="mt-3 space-y-3">
          <div v-for="m in patientMemberships" :key="m.id" class="rounded-ctl border border-line-divider p-3.5">
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <div class="flex min-w-0 items-center gap-2">
                <p class="truncate text-[13.5px] font-semibold text-ink-800">{{ m.membership_name }}</p>
                <UiPill :tone="statusTone[m.status] ?? 'neutral'">{{ m.status }}</UiPill>
              </div>
              <p class="shrink-0 text-[11.5px] text-ink-muted2">
                <span class="font-semibold text-ink-700">{{ money(m.price_cents) }}</span>/{{ t('period', 'periodo') }}
                <span class="px-1 text-ink-faint3">&middot;</span>
                {{ t('started', 'iniciada el') }} {{ new Date(m.started_at).toLocaleDateString() }}
              </p>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line-divider pt-3">
              <UiBtn size="sm" variant="secondary" @click="logPayment(m, 'paid')">{{ t('Log payment', 'Registrar pago') }}</UiBtn>
              <UiBtn size="sm" variant="secondary" class="hover:border-danger-border hover:text-danger-text" @click="logPayment(m, 'failed')">{{ t('Log failed', 'Registrar fallo') }}</UiBtn>
              <select
                :value="m.status"
                class="ml-auto h-[26px] rounded-ctl border border-line-control bg-surface px-2 text-[12.5px] text-ink-500 hover:border-line-controlHover focus:border-brand focus:outline-none"
                @change="setMembershipStatus(m, ($event.target as HTMLSelectElement).value)"
              >
                <option value="active">{{ t('active', 'activa') }}</option>
                <option value="paused">{{ t('paused', 'pausada') }}</option>
                <option value="cancelled">{{ t('cancelled', 'cancelada') }}</option>
              </select>
            </div>

            <div v-if="paymentsFor(m.id).length > 0" class="mt-2 flex flex-wrap gap-1.5">
              <UiPill v-for="pay in paymentsFor(m.id)" :key="pay.id" :tone="pay.status === 'paid' ? 'success' : 'danger'">
                {{ new Date(pay.period_start).toLocaleDateString('default', { month: 'short', year: 'numeric' }) }}: {{ pay.status }}
              </UiPill>
            </div>

            <div v-if="scheduleForMembership(m.id)" class="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-line-divider bg-surface-subtle px-3 py-2">
              <span class="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-600">
                {{ t('Autopay', 'Pago automático') }} <UiPill :tone="scheduleTone[scheduleForMembership(m.id)!.status] ?? 'neutral'">{{ scheduleForMembership(m.id)!.status }}</UiPill>
                {{ t('every', 'cada') }} {{ scheduleForMembership(m.id)!.interval_count }} {{ scheduleForMembership(m.id)!.interval }}(s) &middot;
                {{ eventsForSchedule(scheduleForMembership(m.id)!.id).length }} {{ t('charge(s)', 'cobro(s)') }}
              </span>
              <UiBtn v-if="scheduleForMembership(m.id)!.status === 'active'" size="sm" variant="ghost" class="hover:text-danger-text" @click="cancelAutopay(scheduleForMembership(m.id)!.id)">
                {{ t('Cancel', 'Cancelar') }}
              </UiBtn>
            </div>
            <div v-else-if="hasCard" class="mt-2.5">
              <UiBtn v-if="autopayFormFor !== m.id" size="sm" variant="ghost" @click="openAutopayForm(m.id)">
                {{ t('Set up autopay', 'Configurar pago automático') }}
              </UiBtn>
              <form v-else class="flex flex-wrap items-end gap-1.5 rounded-ctl border border-line-divider bg-surface-subtle p-2.5" @submit.prevent="setUpMembershipAutopay(m)">
                <input v-model.number="autopayIntervalCount" type="number" min="1" :title="t('Every', 'Cada')" class="h-[26px] w-12 rounded-ctlSm border border-line-control bg-surface px-1.5 text-[12px]" />
                <select v-model="autopayInterval" class="h-[26px] rounded-ctlSm border border-line-control bg-surface px-1.5 text-[12px]">
                  <option value="day">{{ t('day(s)', 'día(s)') }}</option>
                  <option value="week">{{ t('week(s)', 'semana(s)') }}</option>
                  <option value="month">{{ t('month(s)', 'mes(es)') }}</option>
                  <option value="year">{{ t('year(s)', 'año(s)') }}</option>
                </select>
                <UiBtn type="submit" size="sm" variant="primary" :disabled="settingUpAutopay">
                  {{ settingUpAutopay ? '…' : t('Start', 'Iniciar') }}
                </UiBtn>
                <UiBtn size="sm" variant="ghost" @click="autopayFormFor = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
                <p v-if="autopayError" class="w-full text-[11px] text-danger-text">{{ autopayError }}</p>
              </form>
            </div>
            <div v-else class="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-line-divider bg-surface-subtle px-3 py-2">
              <span class="text-[11.5px] text-ink-muted2">{{ t("No card on file -- add one to enable autopay for this membership.", 'No hay tarjeta registrada; añade una para habilitar el pago automático de esta membresía.') }}</span>
              <UiBtn size="sm" variant="secondary" @click="showCardModal = true">{{ t('Add card', 'Añadir tarjeta') }}</UiBtn>
            </div>
          </div>
        </div>
        <form class="mt-3 flex flex-wrap items-end gap-2 border-t border-line-divider pt-3" @submit.prevent="activateMembership">
          <select v-model="activateMembershipId" class="bg-surface w-full flex-1 rounded-ctl border border-line-control px-2.5 py-1.5 text-[12.5px] sm:max-w-xs">
            <option value="" disabled>{{ t('Activate a membership…', 'Activar una membresía…') }}</option>
            <option v-for="t in membershipTemplates" :key="t.id" :value="t.id">{{ t.name }} ({{ money(t.price_cents) }})</option>
          </select>
          <div v-if="activateMembershipId">
            <label class="block text-[11px] text-ink-muted">{{ t('Paid now (€)', 'Pagado ahora (€)') }}</label>
            <input v-model="activateAmountPaid" type="number" min="0" step="0.01" class="mt-0.5 w-24 rounded-ctlSm border border-line-control px-2 py-1 text-[12.5px]" />
          </div>
          <div v-if="activateMembershipId && Number(activateAmountPaid) > 0">
            <label class="block text-[11px] text-ink-muted">{{ t('Method', 'Método') }}</label>
            <select v-model="activateMethod" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[12.5px]">
              <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
              <option value="credit" :disabled="spendableCreditCents <= 0">
                {{ t('Credit on account', 'Crédito en cuenta') }}
                ({{ spendableCreditCents > 0 ? `${formatEur(spendableCreditCents)} ${t('available', 'disponible')}` : t('none available', 'sin crédito') }})
              </option>
            </select>
          </div>
          <UiBtn size="sm" variant="secondary" :disabled="!activateMembershipId || activatingMembership" @click="activateMembership">{{ activatingMembership ? t('Activating…', 'Activando…') : t('Activate', 'Activar') }}</UiBtn>
        </form>
        </template>
      </div>
    </div>

    <!-- One sub-nav, so the ledger gets the full width instead of sharing
    it with two cards nobody was reading at the same time. -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-chip-border">
      <nav class="flex gap-1 overflow-x-auto" :aria-label="t('Money sections', 'Secciones de dinero')">
        <button
          v-for="tab in [
            { key: 'ledger', label: t('Account ledger', 'Libro de cuenta') },
            { key: 'documents', label: t('Facturas & receipts', 'Facturas y recibos') },
          ]"
          :key="tab.key"
          type="button"
          class="h-9 shrink-0 px-3 text-[13px] outline-none focus-visible:shadow-focus"
          :class="
            subTab === tab.key
              ? 'font-semibold text-ink-700 shadow-[inset_0_-2px_0_rgb(var(--color-brand))]'
              : 'text-ink-muted hover:text-ink-600'
          "
          :aria-current="subTab === tab.key ? 'true' : undefined"
          @click="subTab = tab.key as typeof subTab"
        >
          {{ tab.label }}
        </button>
      </nav>
      <NuxtLink
        :to="`/billing?patient=${patientId}`"
        class="shrink-0 pb-1 text-[12.5px] font-medium text-brand-text outline-none hover:underline focus-visible:shadow-focus"
      >
        {{ t('All paperwork in Billing', 'Toda la documentación en Facturación') }} ↗
      </NuxtLink>
    </div>

    <!-- The rule behind a missing button. A factura carries no delete and no
    edit anywhere in this app, and an absence explains nothing on its own --
    so it is said once, next to the documents it governs. Enforced in the
    database too; this line is the explanation, not the guarantee. -->
    <p v-show="subTab === 'documents'" class="text-[11.5px] leading-[1.6] text-ink-faint">
      {{
        t(
          'Facturas are chain-signed fiscal records under VeriFactu and can never be edited or deleted — a mistake is corrected by issuing a factura rectificativa. Receipts are not fiscal documents and can still be removed.',
          'Las facturas son registros fiscales firmados en cadena conforme a VeriFactu y no se pueden editar ni eliminar: un error se corrige emitiendo una factura rectificativa. Los recibos no son documentos fiscales y sí se pueden eliminar.',
        )
      }}
    </p>

    <template v-if="subTab === 'ledger'">
    <!-- Account Ledger -->
    <div v-if="ledgerLoading" class="rounded-card border border-line bg-surface shadow-card">
      <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
        <UiSkeleton class="h-4 w-32 rounded" />
        <UiSkeleton class="h-4 w-4 rounded" />
      </div>
      <div class="space-y-3 p-4">
        <div v-for="i in 4" :key="i" class="flex items-center justify-between gap-4">
          <UiSkeleton class="h-3.5 w-16 rounded" />
          <UiSkeleton class="h-3.5 flex-1 rounded" />
          <UiSkeleton class="h-3.5 w-20 rounded" />
        </div>
      </div>
    </div>
    <!-- A failed load is shown as a failure, never as an empty ledger: see
         loadLedger(). Retry rather than a reload, because the rest of the tab
         is fine and loadAll() is what has to run again. -->
    <div v-else-if="ledgerError" class="rounded-card border border-line bg-surface shadow-card">
      <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
        <h3 class="text-[13px] font-semibold text-ink-700">{{ t('Account Ledger', 'Extracto de cuenta') }}</h3>
      </div>
      <div class="p-8 text-center">
        <p class="text-[13px] text-danger-text">{{ t("Couldn't load this patient's transactions.", 'No se pudieron cargar las transacciones de este paciente.') }}</p>
        <p class="mt-1 font-mono text-[11.5px] text-ink-faint">{{ ledgerError }}</p>
        <UiBtn variant="secondary" size="sm" class="mt-3" @click="loadAll()">{{ t('Try again', 'Reintentar') }}</UiBtn>
      </div>
    </div>
    <PatientsAccountLedger
      v-else
      :patient-id="patientId"
      :invoices="invoices"
      :line-item-descriptions="lineItemDescriptions"
      :payments="ledgerPayments"
      :credits="ledgerCredits"
      :package-sessions="ledgerPackageSessions"
      :spendable-credit-cents="spendableCreditCents"
      :outstanding-cents="outstandingCents"
      :sending-invoice-id="sendingInvoiceId"
      :send-result-invoice-id="sendResultInvoiceId"
      :send-result-message="sendResultMessage"
      :can-delete-invoices="can('financials_edit_all')"
      :can-delete-payments="can('financials_edit_all') && can('payments_allocate')"
      :can-write-off="can('financials_edit_all')"
      :can-refund="can('financials_edit_all')"
      :open-refund-for-invoice-id="props.refundInvoiceId ?? null"
      @add-credit="activePanel = 'credit'"
      @take-payment="activePanel === 'payment' ? (activePanel = null) : openTakePayment()"
      @send-invoice="sendInvoiceEmail"
      @delete-invoice="(id: string) => { const inv = invoices.find((i) => i.id === id); if (inv) deleteInvoice(inv) }"
      @write-off-invoice="writeOffInvoice"
      @delete-payment="(p: { paymentId: string; invoiceId: string | null; amountCents: number }) => deletePayment(p.paymentId, p.invoiceId, p.amountCents)"
      @refund-invoice="(payload: { invoiceId: string | null; paymentId: string | null; amountCents: number; reason: string; method: string }) => createRefund(payload.invoiceId, payload.paymentId, payload.amountCents, payload.reason, payload.method)"
      @credits-changed="onLedgerCreditsChanged"
    />
    </template>

    <!-- Stacked rather than side by side: each card carries a progress bar, a
    money breakdown and a row of actions, none of which fit legibly in half
    the width (and the old grid-cols-2 had no mobile fallback either). -->
    <div class="space-y-4">
      <!-- Facturas: what the patient has been given, as opposed to what they
      have been charged. Behind the sub-nav with the ledger, because both are
      history you go looking for rather than something you glance at. -->
      <div v-show="subTab === 'documents'" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Facturas', 'Facturas') }}</p>
        <p class="mt-0.5 text-[12px] text-ink-muted2">
          {{ t('One per payment received. The charges above are what drives the balance.', 'Una por cada pago recibido. Los cargos de arriba son lo que mueve el saldo.') }}
        </p>

        <p v-if="facturasMissingNif.length > 0" class="mt-2 rounded-ctl border border-amber-border bg-amber-bg px-2.5 py-1.5 text-[12px] text-amber-text">
          {{
            t(
              `${facturasMissingNif.length} of these need the patient's NIF. Add it on the Overview tab and they will pick it up.`,
              `${facturasMissingNif.length} de estas necesitan el NIF del paciente. Añádelo en la pestaña Resumen y se actualizarán solas.`,
            )
          }}
        </p>

        <p v-if="facturas.length === 0" class="mt-3 text-[12.5px] text-ink-faint">
          {{ t('None yet — the next payment will issue one.', 'Ninguna todavía: el próximo pago generará una.') }}
        </p>
        <ul v-else class="mt-3 space-y-2">
          <li v-for="f in facturas" :key="f.id" class="flex flex-wrap items-baseline justify-between gap-2 rounded-ctl border border-line-divider p-3">
            <div class="min-w-0">
              <p class="font-mono text-[12.5px] font-medium text-ink-900">
                {{ f.number }}
                <span v-if="f.kind === 'simplified'" class="ml-1 rounded-ctlSm bg-chip-bg px-1.5 py-0.5 font-sans text-[10.5px] text-chip-text">
                  {{ t('simplified', 'simplificada') }}
                </span>
                <!-- Money going back, in a series of its own. Marked here so a
                     negative amount in this list reads as a correction rather
                     than as a sale somebody typed wrong. -->
                <span v-else-if="f.kind === 'rectificativa'" class="ml-1 rounded-ctlSm bg-amber-bg px-1.5 py-0.5 font-sans text-[10.5px] text-amber-text">
                  {{ t('rectifying', 'rectificativa') }}
                </span>
                <!--
                  Its payment has since been deleted. The document stays on the
                  series -- it was issued, and a correlative series cannot have
                  holes punched in it -- but it now documents money that is no
                  longer recorded, which needs resolving rather than ignoring.
                -->
                <span v-if="!f.payment_id" class="ml-1 rounded-ctlSm bg-warning-bg px-1.5 py-0.5 font-sans text-[10.5px] text-warning-text">
                  {{ t('payment removed', 'pago eliminado') }}
                </span>
              </p>
              <p class="truncate text-[12.5px] text-ink-muted2">{{ f.description }}</p>
              <p class="text-[11.5px] text-ink-faint">{{ new Date(f.issued_at).toLocaleDateString() }}</p>
            </div>
            <div class="flex items-center gap-2">
              <span class="font-mono text-[13px] text-ink-900">{{ money(f.amount_cents) }}</span>
              <a
                :href="`/api/facturas/${f.id}/pdf`"
                target="_blank"
                rel="noopener"
                class="text-[12px] font-medium text-brand-text hover:text-brand-hover"
              >
                {{ t('PDF', 'PDF') }}
              </a>
              <span v-if="facturaSendResult[f.id]" class="text-[12px] text-ink-faint">{{ facturaSendResult[f.id] }}</span>
              <button
                v-else
                type="button"
                class="text-[12px] font-medium text-brand-text hover:text-brand-hover disabled:opacity-50"
                :disabled="sendingFacturaId === f.id"
                @click="sendFactura(f.id)"
              >
                {{ sendingFacturaId === f.id ? t('Sending…', 'Enviando…') : t('Send', 'Enviar') }}
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>


    <PatientsStripeCardModal
      v-if="showCardModal"
      :patient-id="patientId"
      @close="showCardModal = false"
      @saved="showCardModal = false; loadAll()"
    />
  </div>
</template>
