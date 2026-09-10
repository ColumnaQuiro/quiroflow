<script setup lang="ts">
import { normalizeSearchTerm } from '~/utils/searchText'

const props = defineProps<{ patientId: string; openPaymentTrigger?: boolean }>()
const emit = defineEmits<{ paymentTriggerConsumed: [] }>()

interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  total_cents: number
  created_at: string
  is_refund: boolean
  refunds_invoice_id: string | null
}
interface PackagePurchaseRow {
  id: string
  package_name: string
  sessions_total: number
  sessions_used: number
  price_cents: number
  purchased_at: string
  invoice_id: string | null
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
interface LedgerPaymentRow { id: string; invoice_id: string; amount_cents: number; method: string; paid_at: string; package_purchase_id: string | null }
interface LedgerCreditRow { id: string; amount_cents: number; reason: string | null; method: string | null; invoice_id: string | null; created_at: string }

const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const { fire } = useAutomations()
const t = useT()

const { balanceCents, creditLedgerCents, refresh: refreshCreditSummary } = usePatientFinancialSummary(() => props.patientId)
const { packageTemplates, membershipTemplates, ensureLoaded: ensureBillingTemplatesLoaded } = useBillingTemplates()
const addCreditAmount = ref('')
const addCreditReason = ref('')
const addCreditMethod = ref<'card' | 'cash'>('cash')
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
  await supabase.from('account_credits').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    amount_cents: amountCents,
    reason: addCreditReason.value || null,
    method: addCreditMethod.value,
    created_by: store.teamMember?.id ?? null,
  })
  addCreditAmount.value = ''
  addCreditReason.value = ''
  addCreditMethod.value = 'cash'
  addingCredit.value = false
  activePanel.value = null
  await refreshCreditSummary()
}

async function applyCreditToInvoice() {
  const invoice = invoices.value.find((i) => i.id === applyCreditInvoiceId.value)
  if (!invoice) return
  const amountCents = Math.round((parseFloat(applyCreditAmount.value) || 0) * 100)
  if (amountCents <= 0 || amountCents > creditLedgerCents.value) {
    creditError.value = t('Amount must be positive and not exceed available credit.', 'El importe debe ser positivo y no superar el crédito disponible.')
    return
  }
  creditError.value = ''
  applyingCredit.value = true

  await supabase.from('payments').insert({
    account_id: store.accountId!,
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

  const { data: paid } = await supabase.from('payments').select('amount_cents').eq('invoice_id', invoice.id)
  const paidCents = (paid ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
  if (paidCents >= invoice.total_cents) {
    await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoice.id)
  }

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
const { rows: paymentRows, reset: resetPaymentRows, addRow: addPaymentRow, removeRow: removePaymentRow, centsOf: paymentRowCents, totalCents: paymentTotalCents, creditCents: paymentCreditCents } = useSplitPayment()

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
  if (paymentCreditCents.value > 0 && paymentCreditCents.value > balanceCents.value) {
    paymentError.value = t('Amount exceeds available credit.', 'El importe supera el crédito disponible.')
    return
  }
  takingPayment.value = true

  await supabase.from('payments').insert(
    rows.map((r) => ({
      account_id: store.accountId!,
      invoice_id: invoice.id,
      amount_cents: paymentRowCents(r),
      method: r.method,
    })),
  )
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

  // An instalment on a bono is money towards sessions, so it has to become
  // spendable credit the same way the money handed over at the sale did --
  // otherwise a patient settling the rest of their bono pays it off on the
  // invoice and still has nothing to draw sessions against.
  const packageForInvoice = purchases.value.find((p) => p.invoice_id === invoice.id)
  const topUpRows = rows.filter((r) => r.method !== 'credit')
  if (packageForInvoice && topUpRows.length > 0) {
    await supabase.from('account_credits').insert(
      topUpRows.map((r) => ({
        account_id: store.accountId!,
        patient_id: props.patientId,
        amount_cents: paymentRowCents(r),
        reason: `Package purchase: ${packageForInvoice.package_name}`,
        invoice_id: invoice.id,
        created_by: store.teamMember?.id ?? null,
      })),
    )
  }

  const { data: paid } = await supabase.from('payments').select('amount_cents').eq('invoice_id', invoice.id)
  const paidCents = (paid ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
  if (paidCents >= invoice.total_cents) {
    await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoice.id)
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
const packagesLoading = ref(true)
const membershipsLoading = ref(true)

const purchases = ref<PackagePurchaseRow[]>([])
const sellPackageId = ref('')
const sellAmountPaid = ref('')
const sellMethod = ref<'cash' | 'card' | 'credit'>('cash')
const sellingPackage = ref(false)

const patientMemberships = ref<PatientMembershipRow[]>([])
const membershipPayments = ref<MembershipPaymentRow[]>([])
const activateMembershipId = ref('')
const activateAmountPaid = ref('')
const activateMethod = ref<'cash' | 'card' | 'credit'>('cash')
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
async function recordSalePayment(description: string, amountCents: number, method: 'cash' | 'card' | 'credit') {
  const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data: invoice } = await supabase
    .from('invoices')
    .insert({ account_id: store.accountId!, patient_id: props.patientId, invoice_number: invoiceNumber, status: 'paid', total_cents: amountCents })
    .select('id')
    .single()
  if (!invoice) return

  await supabase.from('invoice_line_items').insert({ account_id: store.accountId!, invoice_id: invoice.id, description, quantity: 1, price_cents: amountCents })

  if (method === 'credit') {
    await supabase.from('payments').insert({ account_id: store.accountId!, invoice_id: invoice.id, amount_cents: amountCents, method: 'credit' })
    await supabase.from('account_credits').insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      amount_cents: -amountCents,
      reason: `Applied to ${description}`,
      invoice_id: invoice.id,
      created_by: store.teamMember?.id ?? null,
    })
  } else {
    await supabase.from('payments').insert({ account_id: store.accountId!, invoice_id: invoice.id, amount_cents: amountCents, method })
  }
}

// A bono is invoiced for what it costs, not for whatever was handed over on
// the day, so an instalment plan is just an invoice that isn't settled yet.
// Returns the invoice id for package_purchases.invoice_id to point at.
async function createPackageInvoice(description: string, priceCents: number, paidNowCents: number): Promise<string | null> {
  const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data: invoice } = await supabase
    .from('invoices')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      invoice_number: invoiceNumber,
      status: paidNowCents >= priceCents ? 'paid' : 'unpaid',
      total_cents: priceCents,
    })
    .select('id')
    .single()
  if (!invoice) return null

  await supabase.from('invoice_line_items').insert({ account_id: store.accountId!, invoice_id: invoice.id, description, quantity: 1, price_cents: priceCents })
  return invoice.id
}

// The payment side of a bono sale or instalment. Cash/card money paid
// towards a bono becomes spendable credit (that is what sessions draw
// down); paying with credit spends the credit the patient already holds
// instead of topping it up.
async function recordPackagePayment(invoiceId: string | null, amountCents: number, method: 'cash' | 'card' | 'credit', description: string) {
  if (!invoiceId) return
  await supabase.from('payments').insert({ account_id: store.accountId!, invoice_id: invoiceId, amount_cents: amountCents, method })
  await supabase.from('account_credits').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    amount_cents: method === 'credit' ? -amountCents : amountCents,
    reason: method === 'credit' ? `Applied to ${description}` : `Package purchase: ${description}`,
    invoice_id: invoiceId,
    created_by: store.teamMember?.id ?? null,
  })
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
  // payments and account_credits used to be fetched by AccountLedger.vue
  // itself, only after this loader finished and swapped that component in --
  // a second serial round trip on every single tab open, even for a patient
  // with nothing to show. Both filter through the same embedded !inner join
  // as invoice_line_items (payments has no patient_id of its own) so they
  // can join this same parallel wave instead.
  const [{ data: inv }, { data: lines }, { data: pays }, { data: creds }] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, status, total_cents, created_at, is_refund, refunds_invoice_id')
      .eq('patient_id', props.patientId)
      .order('created_at', { ascending: false }),
    supabase
      .from('invoice_line_items')
      .select('invoice_id, description, invoices!inner(patient_id)')
      .eq('invoices.patient_id', props.patientId),
    supabase
      .from('payments')
      .select('id, invoice_id, amount_cents, method, paid_at, package_purchase_id, invoices!inner(patient_id)')
      .eq('invoices.patient_id', props.patientId),
    supabase
      .from('account_credits')
      .select('id, amount_cents, reason, method, invoice_id, created_at')
      .eq('patient_id', props.patientId)
      .order('created_at', { ascending: true }),
  ])
  invoices.value = inv ?? []
  const byInvoice: Record<string, string[]> = {}
  for (const l of (lines ?? []) as unknown as { invoice_id: string; description: string }[]) {
    ;(byInvoice[l.invoice_id] ??= []).push(l.description)
  }
  lineItemDescriptions.value = byInvoice
  ledgerPayments.value = (pays ?? []) as unknown as LedgerPaymentRow[]
  ledgerCredits.value = creds ?? []

  const { data: sessions } = await supabase
    .from('package_sessions')
    .select('id, amount_cents, used_at, package_purchases(package_name)')
    .eq('patient_id', props.patientId)
    .order('used_at', { ascending: true })
  ledgerPackageSessions.value = ((sessions ?? []) as unknown as { id: string; amount_cents: number; used_at: string; package_purchases: { package_name: string } | null }[]).map((r) => ({
    id: r.id,
    amount_cents: r.amount_cents,
    used_at: r.used_at,
    package_name: r.package_purchases?.package_name ?? null,
  }))
  ledgerLoading.value = false
}

async function loadPackages() {
  packagesLoading.value = true
  const [{ data: pkgPurchases }, { data: sch }] = await Promise.all([
    supabase.from('package_purchases').select('id, package_name, sessions_total, sessions_used, price_cents, purchased_at, invoice_id').eq('patient_id', props.patientId).order('purchased_at', { ascending: false }),
    supabase
      .from('payment_schedules')
      .select('id, package_purchase_id, patient_membership_id, interval, interval_count, installments_total, installments_paid, status')
      .eq('patient_id', props.patientId),
  ])
  purchases.value = pkgPurchases ?? []
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
onMounted(() => {
  loadAll()
  maybeOpenPaymentFromTrigger()
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
  if (!confirm(`${t('Delete invoice', 'Eliminar factura')} ${invoice.invoice_number} (${money(invoice.total_cents)})? ${t("This also removes any payments recorded against it. This can't be undone.", 'Esto también elimina los pagos registrados contra ella. Esta acción no se puede deshacer.')}`)) return
  await supabase.from('invoices').delete().eq('id', invoice.id)
  await Promise.all([loadAll(), refreshCreditSummary()])
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
async function deletePayment(paymentId: string, invoiceId: string, amountCents: number) {
  const invoice = invoices.value.find((i) => i.id === invoiceId)
  if (
    !confirm(
      `${t('Remove this', 'Eliminar este')} ${money(amountCents)} ${t('payment', 'pago')}${invoice ? ` ${t('from', 'de')} ${invoice.invoice_number}` : ''}? ` +
        t('The invoice reopens if it is no longer fully paid. This does not refund any money.', 'La factura se reabrirá si deja de estar pagada. Esto no reembolsa ningún importe.'),
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
  if (invoice) {
    const { data: remaining } = await supabase.from('payments').select('amount_cents').eq('invoice_id', invoiceId)
    const paidCents = (remaining ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
    if (invoice.status !== 'void') {
      await supabase.from('invoices').update({ status: paidCents >= invoice.total_cents ? 'paid' : 'unpaid' }).eq('id', invoiceId)
    }
  }

  await Promise.all([loadAll(), refreshCreditSummary()])
}

async function writeOffInvoice(invoiceId: string) {
  const invoice = invoices.value.find((i) => i.id === invoiceId)
  if (!invoice) return
  const { data: paid } = await supabase.from('payments').select('amount_cents').eq('invoice_id', invoiceId)
  const paidCents = (paid ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
  const openCents = invoice.total_cents - paidCents
  if (openCents <= 0) return
  if (!confirm(`${t('Write off', 'Condonar')} ${money(openCents)} ${t('remaining on', 'restantes de')} ${invoice.invoice_number}? ${t('This settles the invoice without collecting payment.', 'Esto salda la factura sin cobrar el pago.')}`)) return
  await supabase.from('payments').insert({ account_id: store.accountId!, invoice_id: invoiceId, amount_cents: openCents, method: 'write_off' })
  await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId)
  await Promise.all([loadAll(), refreshCreditSummary()])
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

async function createRefund(invoiceId: string, amountCents: number, reason: string, method: string) {
  const invoice = invoices.value.find((i) => i.id === invoiceId)
  if (!invoice || amountCents <= 0) return
  const maxRefundable = await refundableCentsFor(invoiceId)
  if (amountCents > maxRefundable) return

  const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
  const invoiceNumber = `REF-${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data: refund } = await supabase
    .from('invoices')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      invoice_number: invoiceNumber,
      status: 'paid',
      total_cents: -amountCents,
      is_refund: true,
      refunds_invoice_id: invoiceId,
    })
    .select('id')
    .single()
  if (!refund) return

  await supabase.from('invoice_line_items').insert({
    account_id: store.accountId!,
    invoice_id: refund.id,
    description: reason.trim() ? `Refund (${invoice.invoice_number}) — ${reason.trim()}` : `Refund — ${invoice.invoice_number}`,
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
  await supabase.from('payments').insert({
    account_id: store.accountId!,
    invoice_id: refund.id,
    amount_cents: -amountCents,
    method,
  })

  await Promise.all([loadAll(), refreshCreditSummary()])
}

const hasCard = computed(() => !!stripeCustomer.value?.default_payment_method_id)
const unpaidInvoices = computed(() => invoices.value.filter((i) => i.status === 'unpaid'))
const outstandingCents = computed(() => (balanceCents.value < 0 ? -balanceCents.value : 0))

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
  if (sellMethod.value === 'credit' && amountCents > creditLedgerCents.value) {
    creditError.value = t('Amount exceeds available credit.', 'El importe supera el crédito disponible.')
    return
  }
  sellingPackage.value = true
  // The bono is invoiced at its full price and the purchase points at that
  // invoice, so paying for it in instalments works like any other partly
  // paid invoice: what is still owed is the invoice's open balance, it
  // shows in the patient's Outstanding, and Debtors picks it up (that
  // report is already written against package_purchases.invoice_id).
  // Invoicing only the amount handed over, as this did, left nothing
  // anywhere recording that the rest of the bono was still unpaid.
  const invoiceId = await createPackageInvoice(tpl.name, tpl.price_cents, amountCents)
  await supabase.from('package_purchases').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    package_id: tpl.id,
    package_name: tpl.name,
    sessions_total: tpl.session_count,
    price_cents: tpl.price_cents,
    invoice_id: invoiceId,
    created_by: store.teamMember?.id ?? null,
  })
  // Amount paid can be less than the package's full price -- the rest is
  // expected via the existing "Set up autopay" Stripe schedule below.
  if (amountCents > 0) {
    await recordPackagePayment(invoiceId, amountCents, sellMethod.value, tpl.name)
  }
  sellingPackage.value = false
  sellPackageId.value = ''
  sellAmountPaid.value = ''
  sellMethod.value = 'cash'
  await Promise.all([loadAll(), refreshCreditSummary()])
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

function packageOwedCents(purchase: PackagePurchaseRow): number {
  // The bono card and the ledger load independently -- reading payments
  // before that loader lands would flash the full price as unpaid.
  if (ledgerLoading.value) return 0
  const invoice = packageInvoice(purchase)
  const invoiceIsValid = !!invoice && invoice.status !== 'void'
  let paidCents = 0
  let hasAnyLinkedPayment = false
  for (const p of ledgerPayments.value) {
    if ((invoiceIsValid && p.invoice_id === purchase.invoice_id) || p.package_purchase_id === purchase.id) {
      paidCents += p.amount_cents
      hasAnyLinkedPayment = true
    }
  }
  if (!invoiceIsValid && !hasAnyLinkedPayment) return 0
  // Measure the debt against what was actually invoiced, not the bono's
  // price. A bono sold here is invoiced at its full price, so the two agree.
  // A bono migrated from PracticeHub is not: the importer raises an invoice
  // for the part still owed at migration, because the rest was already paid
  // over there and no payment row for it exists on this side. Measuring
  // against price_cents claimed the whole price was outstanding -- David
  // Poveda's Bono 14 read "559,00 owed / 0,00 paid of 559,00" against a
  // 301,00 invoice -- and overstated the debt on 84 bonos by 18.647,00.
  const chargedCents = invoice && invoiceIsValid ? invoice.total_cents : purchase.price_cents
  return Math.max(0, chargedCents - paidCents)
}

// Collecting a NEW payment still only makes sense when the bono has its own
// invoice to take it against -- this opens the existing take-payment panel
// already pointed at it and prefilled with the outstanding amount, rather
// than making the front desk find the right invoice in a dropdown of all of
// them. Paying it flows through takePayment(), which already deposits
// matching credit for a payment landing on a bono invoice -- money towards
// sessions has to become spendable credit, or the patient pays off the bono
// and still has nothing to draw sessions against.
function collectOnPackage(purchase: PackagePurchaseRow) {
  const owed = packageOwedCents(purchase)
  if (!purchase.invoice_id || owed <= 0) return
  activePanel.value = 'payment'
  paymentError.value = ''
  paymentInvoiceId.value = purchase.invoice_id
  resetPaymentRows((owed / 100).toFixed(2))
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

function invoiceNumberFor(invoiceId: string): string {
  return invoices.value.find((i) => i.id === invoiceId)?.invoice_number ?? invoiceId
}

function toggleLinkPayment(packageId: string) {
  openLinkPaymentId.value = openLinkPaymentId.value === packageId ? null : packageId
  linkPaymentSelection.value = ''
}

async function linkPaymentToPackage(purchase: PackagePurchaseRow) {
  if (!linkPaymentSelection.value) return
  linkingPayment.value = true
  await supabase.from('payments').update({ package_purchase_id: purchase.id }).eq('id', linkPaymentSelection.value)
  linkPaymentSelection.value = ''
  linkingPayment.value = false
  await loadAll()
}

async function unlinkPayment(paymentId: string) {
  await supabase.from('payments').update({ package_purchase_id: null }).eq('id', paymentId)
  await loadAll()
}

// Logging a session records the visit it represents, the same way completing
// an appointment against a bono does (AppointmentBillingTab.usePackageSession):
// a completed appointment, an invoice at the bono's per-session rate, a
// payment with method 'credit' and a matching negative account_credits row.
//
// It used to only bump sessions_used. That left the money behind: buying a
// bono deposits credit (see recordSalePayment/collectOnPackage -- prepaid
// sessions have to become spendable credit), and every other way of spending
// a session draws that credit back down. A counter-only "Log session" spent
// the session but not the credit, so a patient's balance drifted up by the
// per-session rate every time it was used, and the visit itself existed
// nowhere -- no appointment, no invoice, nothing in the ledger.
const loggingSessionFor = ref<string | null>(null)

async function useSession(purchase: PackagePurchaseRow) {
  if (purchase.sessions_used >= purchase.sessions_total || loggingSessionFor.value) return
  if (!store.accountId || !store.currentClinicId) return

  // What the patient actually paid per visit when they bought the bono, not
  // whatever an appointment type charges walk-ins -- same rate
  // usePackageSession() reprices a package-covered visit to.
  const perSessionCents = Math.round(purchase.price_cents / purchase.sessions_total)
  const description = `${t('Package session', 'Sesión de bono')}: ${purchase.package_name}`
  if (!confirm(`${t('Log a session for', 'Registrar una sesión de')} ${money(perSessionCents)} ${t('against', 'contra')} "${purchase.package_name}"? ${t('This records a completed visit today and bills it to the bono.', 'Esto registra una visita completada hoy y la factura al bono.')}`)) return

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
    // No appointment type to take a duration from (this is logged off the
    // bono, not off the calendar), so the schema's own default stands in.
    const ends = new Date(now.getTime() + 30 * 60000)
    const { data: appointment } = await supabase
      .from('appointments')
      .insert({
        account_id: store.accountId,
        clinic_id: store.currentClinicId,
        patient_id: props.patientId,
        practitioner_id: store.teamMember?.id ?? null,
        starts_at: now.toISOString(),
        ends_at: ends.toISOString(),
        status: 'completed',
      })
      .select('id')
      .single()

    const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true })
    const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, '0')}`
    const { data: invoice } = await supabase
      .from('invoices')
      .insert({
        account_id: store.accountId,
        patient_id: props.patientId,
        appointment_id: appointment?.id ?? null,
        invoice_number: invoiceNumber,
        status: 'paid',
        total_cents: perSessionCents,
      })
      .select('id')
      .single()

    if (invoice) {
      await supabase.from('invoice_line_items').insert({ account_id: store.accountId, invoice_id: invoice.id, description, quantity: 1, price_cents: perSessionCents })
      await supabase.from('payments').insert({ account_id: store.accountId, invoice_id: invoice.id, amount_cents: perSessionCents, method: 'credit' })
      await supabase.from('account_credits').insert({
        account_id: store.accountId,
        patient_id: props.patientId,
        amount_cents: -perSessionCents,
        reason: description,
        invoice_id: invoice.id,
        created_by: store.teamMember?.id ?? null,
      })
    }

    // Deliberately fires no appointment.completed/invoice.paid automation:
    // this is a back-office correction for a visit that already happened, and
    // the campaigns hanging off those events (review requests, confirmations)
    // would message the patient about it days late.
    await loadAll()
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
  if (activateMethod.value === 'credit' && amountCents > creditLedgerCents.value) {
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
  await Promise.all([loadAll(), refreshCreditSummary()])
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

function money(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <div class="space-y-4">
    <!-- Summary strip -->
    <div class="rounded-card border border-line bg-surface p-4 shadow-card">
      <div class="flex flex-wrap items-center gap-6">
        <div>
          <p class="text-[11.5px] text-ink-muted2">{{ t('Outstanding', 'Pendiente') }}</p>
          <p class="mt-0.5 font-mono text-[16px] font-semibold" :class="outstandingCents > 0 ? 'text-danger-text' : 'text-ink-700'">{{ money(outstandingCents) }}</p>
        </div>
        <div>
          <p class="text-[11.5px] text-ink-muted2">{{ t('Account credit', 'Crédito en cuenta') }}</p>
          <p class="mt-0.5 font-mono text-[16px] font-semibold text-ink-700">{{ money(creditLedgerCents) }}</p>
        </div>
        <div>
          <p class="text-[11.5px] text-ink-muted2">{{ t('Card on file', 'Tarjeta registrada') }}</p>
          <p class="mt-0.5 text-[13px] font-medium text-ink-700">{{ hasCard ? t('On file', 'Registrada') : t('None', 'Ninguna') }}</p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <UiBtn variant="secondary" size="sm" @click="activePanel = activePanel === 'credit' ? null : 'credit'">{{ t('Add credit', 'Añadir crédito') }}</UiBtn>
          <UiBtn variant="primary" size="sm" @click="activePanel === 'payment' ? (activePanel = null) : openTakePayment()">{{ t('Take payment', 'Registrar pago') }}</UiBtn>
          <UiBtn variant="secondary" size="sm" @click="showCardModal = true">{{ hasCard ? t('Replace card', 'Sustituir tarjeta') : t('Add card', 'Añadir tarjeta') }}</UiBtn>
          <UiBtn variant="secondary" size="sm" :disabled="copyingCardLink" @click="copyCardLink">{{ copyingCardLink ? t('Copying…', 'Copiando…') : t('Copy card link', 'Copiar enlace de tarjeta') }}</UiBtn>
          <UiBtn v-if="hasCard" variant="secondary" size="sm" :disabled="removingCard" @click="removeCard">{{ removingCard ? t('Removing…', 'Eliminando…') : t('Remove card', 'Eliminar tarjeta') }}</UiBtn>
        </div>
      </div>

      <div v-if="activePanel === 'credit'" class="mt-4 border-t border-line-divider pt-4">
        <form class="flex flex-wrap items-end gap-2" @submit.prevent="addCredit">
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Amount (€)', 'Importe (€)') }}</label>
            <input v-model="addCreditAmount" type="number" min="0" step="0.01" class="mt-0.5 w-24 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]" />
          </div>
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Method', 'Método') }}</label>
            <select v-model="addCreditMethod" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]">
              <option value="cash">{{ t('Cash', 'Efectivo') }}</option>
              <option value="card">{{ t('Card', 'Tarjeta') }}</option>
            </select>
          </div>
          <div class="flex-1">
            <label class="block text-[11px] text-ink-muted">{{ t('Reason', 'Motivo') }}</label>
            <input v-model="addCreditReason" type="text" :placeholder="t('e.g. Birthday gift', 'p. ej. regalo de cumpleaños')" class="mt-0.5 w-full rounded-ctlSm border border-line-control px-2 py-1 text-[13px]" />
          </div>
          <UiBtn variant="primary" size="sm" :disabled="!addCreditAmount || addingCredit" @click="addCredit">{{ addingCredit ? t('Adding…', 'Añadiendo…') : t('Add credit', 'Añadir crédito') }}</UiBtn>
        </form>

        <form v-if="creditLedgerCents > 0 && unpaidInvoices.length > 0" class="mt-3 flex flex-wrap items-end gap-2 border-t border-line-divider pt-3" @submit.prevent="applyCreditToInvoice">
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Apply to invoice', 'Aplicar a factura') }}</label>
            <select v-model="applyCreditInvoiceId" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]">
              <option value="" disabled>{{ t('Select invoice…', 'Seleccionar factura…') }}</option>
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
            <label class="block text-[11px] text-ink-muted">{{ t('Invoice', 'Factura') }}</label>
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
                <option value="card">{{ t('Card', 'Tarjeta') }}</option>
                <option value="cash">{{ t('Cash', 'Efectivo') }}</option>
                <option v-if="balanceCents > 0" value="credit">{{ t('Credit on account', 'Crédito en cuenta') }} (€{{ (balanceCents / 100).toFixed(2) }} {{ t('available', 'disponible') }})</option>
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
        <p v-else class="text-[12.5px] text-ink-faint">{{ t('No unpaid invoices to take a payment against.', 'No hay facturas pendientes contra las que registrar un pago.') }}</p>
        <p v-if="paymentError" class="mt-2 text-[12px] text-danger-text">{{ paymentError }}</p>
      </div>
    </div>

    <!-- Stacked rather than side by side: each card carries a progress bar, a
    money breakdown and a row of actions, none of which fit legibly in half
    the width (and the old grid-cols-2 had no mobile fallback either). -->
    <div class="space-y-4">
      <!-- Packages / bonos -->
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
          <div v-for="p in purchases" :key="p.id" class="rounded-ctl border border-line-divider p-3.5">
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <div class="flex min-w-0 items-center gap-2">
                <p class="truncate text-[13.5px] font-semibold text-ink-800">{{ p.package_name }}</p>
                <UiPill v-if="packageOwedCents(p) > 0" tone="danger">{{ money(packageOwedCents(p)) }} {{ t('owed', 'pendiente') }}</UiPill>
                <UiPill v-else tone="success">{{ t('Paid', 'Pagado') }}</UiPill>
              </div>
              <p class="shrink-0 text-[12px] text-ink-muted2">
                <span class="font-semibold text-ink-700">{{ p.sessions_total - p.sessions_used }}</span>
                {{ t('of', 'de') }} {{ p.sessions_total }} {{ t('left', 'restantes') }}
              </p>
            </div>

            <div class="mt-2.5 h-[6px] w-full overflow-hidden rounded-full bg-line-faint">
              <div class="h-full rounded-full bg-brand" :style="{ width: `${Math.min(100, Math.round((p.sessions_used / p.sessions_total) * 100))}%` }" />
            </div>

            <p class="mt-2 text-[11.5px] text-ink-muted2">
              {{ p.sessions_used }}/{{ p.sessions_total }} {{ t('used', 'usadas') }}
              <span class="px-1 text-ink-faint3">&middot;</span>
              <template v-if="packageOwedCents(p) > 0">
                {{ money(p.price_cents - packageOwedCents(p)) }} {{ t('paid of', 'pagado de') }} {{ money(p.price_cents) }}
              </template>
              <template v-else>{{ money(p.price_cents) }}</template>
            </p>

            <!-- One button row with a real hierarchy: the everyday action
            filled, the money action outlined, the rest quiet, destructive
            pushed to the far end. The old row was five bare text links in
            four different colors, which read as decoration rather than
            controls. -->
            <div class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line-divider pt-3">
              <UiBtn size="sm" variant="primary" :disabled="p.sessions_used >= p.sessions_total || loggingSessionFor !== null" @click="useSession(p)">
                {{ loggingSessionFor === p.id ? t('Logging…', 'Registrando…') : t('Log session', 'Registrar sesión') }}
              </UiBtn>
              <UiBtn v-if="packageOwedCents(p) > 0" size="sm" variant="secondary" @click="collectOnPackage(p)">
                {{ t('Take payment', 'Cobrar') }}…
              </UiBtn>
              <UiBtn size="sm" variant="secondary" @click="toggleLinkPayment(p.id)">
                {{ t('Link payment', 'Vincular pago') }}{{ linkedPaymentsFor(p).length ? ` (${linkedPaymentsFor(p).length})` : '' }}…
              </UiBtn>
              <UiBtn size="sm" variant="secondary" @click="toggleShares(p.id)">
                {{ t('Share', 'Compartir') }}{{ shares[p.id]?.length ? ` (${shares[p.id].length})` : '' }}…
              </UiBtn>
              <UiBtn v-if="can('billing_config')" size="sm" variant="ghost" class="ml-auto hover:text-danger-text" @click="deletePackagePurchase(p)">
                {{ t('Delete', 'Eliminar') }}
              </UiBtn>
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
              <option value="cash">{{ t('Cash', 'Efectivo') }}</option>
              <option value="card">{{ t('Card', 'Tarjeta') }}</option>
              <option v-if="creditLedgerCents > 0" value="credit">{{ t('Credit on account', 'Crédito en cuenta') }} (€{{ (creditLedgerCents / 100).toFixed(2) }} {{ t('available', 'disponible') }})</option>
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
              <option value="cash">{{ t('Cash', 'Efectivo') }}</option>
              <option value="card">{{ t('Card', 'Tarjeta') }}</option>
              <option v-if="creditLedgerCents > 0" value="credit">{{ t('Credit on account', 'Crédito en cuenta') }} (€{{ (creditLedgerCents / 100).toFixed(2) }} {{ t('available', 'disponible') }})</option>
            </select>
          </div>
          <UiBtn size="sm" variant="secondary" :disabled="!activateMembershipId || activatingMembership" @click="activateMembership">{{ activatingMembership ? t('Activating…', 'Activando…') : t('Activate', 'Activar') }}</UiBtn>
        </form>
        </template>
      </div>
    </div>

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
    <PatientsAccountLedger
      v-else
      :patient-id="patientId"
      :invoices="invoices"
      :line-item-descriptions="lineItemDescriptions"
      :payments="ledgerPayments"
      :credits="ledgerCredits"
      :package-sessions="ledgerPackageSessions"
      :credit-ledger-cents="creditLedgerCents"
      :sending-invoice-id="sendingInvoiceId"
      :send-result-invoice-id="sendResultInvoiceId"
      :send-result-message="sendResultMessage"
      :can-delete-invoices="can('financials_edit_all')"
      :can-delete-payments="can('financials_edit_all') && can('payments_allocate')"
      :can-write-off="can('financials_edit_all')"
      :can-refund="can('financials_edit_all')"
      @add-credit="activePanel = 'credit'"
      @take-payment="activePanel === 'payment' ? (activePanel = null) : openTakePayment()"
      @send-invoice="sendInvoiceEmail"
      @delete-invoice="(id: string) => { const inv = invoices.find((i) => i.id === id); if (inv) deleteInvoice(inv) }"
      @write-off-invoice="writeOffInvoice"
      @delete-payment="(p: { paymentId: string; invoiceId: string; amountCents: number }) => deletePayment(p.paymentId, p.invoiceId, p.amountCents)"
      @refund-invoice="(payload: { invoiceId: string; amountCents: number; reason: string; method: string }) => createRefund(payload.invoiceId, payload.amountCents, payload.reason, payload.method)"
      @credits-changed="onLedgerCreditsChanged"
    />

    <PatientsStripeCardModal
      v-if="showCardModal"
      :patient-id="patientId"
      @close="showCardModal = false"
      @saved="showCardModal = false; loadAll()"
    />
  </div>
</template>
