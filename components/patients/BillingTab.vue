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
interface PackageTemplate { id: string; name: string; session_count: number; price_cents: number }
interface PackagePurchaseRow {
  id: string
  package_name: string
  sessions_total: number
  sessions_used: number
  price_cents: number
  purchased_at: string
}
interface MembershipTemplate { id: string; name: string; price_cents: number }
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

const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const { fire } = useAutomations()
const t = useT()

const { balanceCents, creditLedgerCents, refresh: refreshCreditSummary } = usePatientFinancialSummary(() => props.patientId)
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

// -- Take a payment against an unpaid invoice (cash/card/credit) ----------
const paymentInvoiceId = ref('')
const paymentAmount = ref('')
const paymentMethod = ref<'card' | 'cash' | 'credit'>('cash')
const takingPayment = ref(false)
const paymentError = ref('')

function openTakePayment() {
  activePanel.value = 'payment'
  paymentError.value = ''
  const firstUnpaid = unpaidInvoices.value[0]
  paymentInvoiceId.value = firstUnpaid?.id ?? ''
  paymentAmount.value = firstUnpaid ? (firstUnpaid.total_cents / 100).toFixed(2) : ''
  paymentMethod.value = 'cash'
}

async function takePayment() {
  const invoice = invoices.value.find((i) => i.id === paymentInvoiceId.value)
  if (!invoice) return
  const amountCents = Math.round((parseFloat(paymentAmount.value) || 0) * 100)
  if (amountCents <= 0) return
  paymentError.value = ''
  if (paymentMethod.value === 'credit' && amountCents > balanceCents.value) {
    paymentError.value = t('Amount exceeds available credit.', 'El importe supera el crédito disponible.')
    return
  }
  takingPayment.value = true

  await supabase.from('payments').insert({
    account_id: store.accountId!,
    invoice_id: invoice.id,
    amount_cents: amountCents,
    method: paymentMethod.value,
  })
  if (paymentMethod.value === 'credit') {
    await supabase.from('account_credits').insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      amount_cents: -amountCents,
      reason: `Applied to invoice ${invoice.invoice_number}`,
      invoice_id: invoice.id,
      created_by: store.teamMember?.id ?? null,
    })
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
const loading = ref(true)

const packageTemplates = ref<PackageTemplate[]>([])
const purchases = ref<PackagePurchaseRow[]>([])
const sellPackageId = ref('')
const sellAmountPaid = ref('')
const sellMethod = ref<'cash' | 'card' | 'credit'>('cash')
const sellingPackage = ref(false)

const membershipTemplates = ref<MembershipTemplate[]>([])
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

async function loadAll() {
  const [{ data: inv }, { data: pkgTemplates }, { data: pkgPurchases }, { data: memTemplates }, { data: patMemberships }] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, status, total_cents, created_at, is_refund, refunds_invoice_id')
      .eq('patient_id', props.patientId)
      .order('created_at', { ascending: false }),
    supabase.from('packages').select('id, name, session_count, price_cents').order('name'),
    supabase.from('package_purchases').select('id, package_name, sessions_total, sessions_used, price_cents, purchased_at').eq('patient_id', props.patientId).order('purchased_at', { ascending: false }),
    supabase.from('memberships').select('id, name, price_cents').order('name'),
    supabase.from('patient_memberships').select('id, membership_name, price_cents, status, started_at').eq('patient_id', props.patientId).order('started_at', { ascending: false }),
  ])
  invoices.value = inv ?? []
  packageTemplates.value = pkgTemplates ?? []
  purchases.value = pkgPurchases ?? []
  membershipTemplates.value = memTemplates ?? []
  patientMemberships.value = (patMemberships as PatientMembershipRow[]) ?? []

  // None of the four queries below depend on each other's results (only on
  // invoices/patientMemberships from the wave above), so they run as one
  // parallel batch instead of four sequential round-trips -- each extra
  // sequential await here was adding a full network round-trip to every
  // patient's billing-tab load regardless of how little data came back.
  const invoiceIds = invoices.value.map((i) => i.id)
  const membershipIds = patientMemberships.value.map((m) => m.id)
  const [{ data: lines }, { data: membershipPaymentRows }, { data: customer }, { data: sch }] = await Promise.all([
    invoiceIds.length > 0
      ? supabase.from('invoice_line_items').select('invoice_id, description').in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [] as { invoice_id: string; description: string }[] }),
    membershipIds.length > 0
      ? supabase
          .from('membership_payments')
          .select('id, patient_membership_id, period_start, amount_cents, status')
          .in('patient_membership_id', membershipIds)
          .order('period_start', { ascending: false })
      : Promise.resolve({ data: [] as typeof membershipPayments.value }),
    supabase.from('patient_stripe_customers').select('stripe_customer_id, default_payment_method_id').eq('patient_id', props.patientId).maybeSingle(),
    supabase
      .from('payment_schedules')
      .select('id, package_purchase_id, patient_membership_id, interval, interval_count, installments_total, installments_paid, status')
      .eq('patient_id', props.patientId),
  ])

  const byInvoice: Record<string, string[]> = {}
  for (const l of lines ?? []) {
    ;(byInvoice[l.invoice_id] ??= []).push(l.description)
  }
  lineItemDescriptions.value = byInvoice
  membershipPayments.value = membershipPaymentRows ?? []
  stripeCustomer.value = customer
  schedules.value = sch ?? []

  if (schedules.value.length > 0) {
    const { data: events } = await supabase
      .from('stripe_payment_events')
      .select('id, payment_schedule_id, period_start, amount_cents, status')
      .in('payment_schedule_id', schedules.value.map((s) => s.id))
      .order('period_start', { ascending: false })
    stripeEvents.value = events ?? []
  }

  loading.value = false
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

async function createRefund(invoiceId: string, amountCents: number, reason: string) {
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
  await supabase.from('package_purchases').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    package_id: tpl.id,
    package_name: tpl.name,
    sessions_total: tpl.session_count,
    price_cents: tpl.price_cents,
    created_by: store.teamMember?.id ?? null,
  })
  // Amount paid can be less than the package's full price -- the rest is
  // expected via the existing "Set up autopay" Stripe schedule below.
  if (amountCents > 0) {
    await recordSalePayment(tpl.name, amountCents, sellMethod.value)
    // recordSalePayment's invoice+payment pair nets to zero on balanceCents
    // (paid == invoiced) -- it's the cash-up/Lifetime record of the sale,
    // not spendable credit. Depositing the same amount as real account
    // credit is what makes it usable against future sessions; paying with
    // existing credit (method 'credit') already spent that credit inside
    // recordSalePayment, so it doesn't get topped back up here.
    if (sellMethod.value !== 'credit') {
      await supabase.from('account_credits').insert({
        account_id: store.accountId!,
        patient_id: props.patientId,
        amount_cents: amountCents,
        reason: `Package purchase: ${tpl.name}`,
        created_by: store.teamMember?.id ?? null,
      })
    }
  }
  sellingPackage.value = false
  sellPackageId.value = ''
  sellAmountPaid.value = ''
  sellMethod.value = 'cash'
  await Promise.all([loadAll(), refreshCreditSummary()])
}

async function useSession(purchase: PackagePurchaseRow) {
  if (purchase.sessions_used >= purchase.sessions_total) return
  await supabase.from('package_purchases').update({ sessions_used: purchase.sessions_used + 1 }).eq('id', purchase.id)
  await loadAll()
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
        <form v-if="unpaidInvoices.length > 0" class="flex flex-wrap items-end gap-2" @submit.prevent="takePayment">
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Invoice', 'Factura') }}</label>
            <select v-model="paymentInvoiceId" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]">
              <option v-for="inv in unpaidInvoices" :key="inv.id" :value="inv.id">{{ inv.invoice_number }} ({{ money(inv.total_cents) }})</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Amount (€)', 'Importe (€)') }}</label>
            <input v-model="paymentAmount" type="number" min="0" step="0.01" class="mt-0.5 w-24 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]" />
          </div>
          <div>
            <label class="block text-[11px] text-ink-muted">{{ t('Method', 'Método') }}</label>
            <select v-model="paymentMethod" class="bg-surface mt-0.5 rounded-ctlSm border border-line-control px-2 py-1 text-[13px]">
              <option value="card">{{ t('Card', 'Tarjeta') }}</option>
              <option value="cash">{{ t('Cash', 'Efectivo') }}</option>
              <option v-if="balanceCents > 0" value="credit">{{ t('Credit on account', 'Crédito en cuenta') }} (€{{ (balanceCents / 100).toFixed(2) }} {{ t('available', 'disponible') }})</option>
            </select>
          </div>
          <UiBtn variant="primary" size="sm" :disabled="!paymentInvoiceId || !paymentAmount || takingPayment" @click="takePayment">
            {{ takingPayment ? t('Recording…', 'Registrando…') : t('Record payment', 'Registrar pago') }}
          </UiBtn>
        </form>
        <p v-else class="text-[12.5px] text-ink-faint">{{ t('No unpaid invoices to take a payment against.', 'No hay facturas pendientes contra las que registrar un pago.') }}</p>
        <p v-if="paymentError" class="mt-2 text-[12px] text-danger-text">{{ paymentError }}</p>
      </div>
    </div>

    <!-- Account Ledger -->
    <div v-if="loading" class="rounded-card border border-line bg-surface p-8 text-center text-[13px] text-ink-faint shadow-card">{{ t('Loading…', 'Cargando…') }}</div>
    <PatientsAccountLedger
      v-else
      :patient-id="patientId"
      :invoices="invoices"
      :line-item-descriptions="lineItemDescriptions"
      :credit-ledger-cents="creditLedgerCents"
      :sending-invoice-id="sendingInvoiceId"
      :send-result-invoice-id="sendResultInvoiceId"
      :send-result-message="sendResultMessage"
      :can-delete-invoices="can('financials_edit_all')"
      :can-write-off="can('financials_edit_all')"
      :can-refund="can('financials_edit_all')"
      @add-credit="activePanel = 'credit'"
      @take-payment="activePanel === 'payment' ? (activePanel = null) : openTakePayment()"
      @send-invoice="sendInvoiceEmail"
      @delete-invoice="(id: string) => { const inv = invoices.find((i) => i.id === id); if (inv) deleteInvoice(inv) }"
      @write-off-invoice="writeOffInvoice"
      @refund-invoice="(payload: { invoiceId: string; amountCents: number; reason: string }) => createRefund(payload.invoiceId, payload.amountCents, payload.reason)"
      @credits-changed="refreshCreditSummary"
    />

    <div v-if="!loading" class="grid grid-cols-2 gap-4">
      <!-- Packages / bonos -->
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Packages / bonos', 'Bonos') }}</p>
        <div class="mt-3 space-y-3">
          <div v-for="p in purchases" :key="p.id" class="rounded-ctl border border-line-divider p-3">
            <div class="flex items-center justify-between gap-2">
              <p class="truncate text-[13px] font-medium text-ink-700">{{ p.package_name }}</p>
              <p class="shrink-0 text-[11.5px] text-ink-muted2">{{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }}</p>
            </div>
            <div class="mt-1.5 h-[4px] w-full overflow-hidden rounded-full bg-line-faint">
              <div class="h-full rounded-full bg-brand" :style="{ width: `${Math.min(100, Math.round((p.sessions_used / p.sessions_total) * 100))}%` }" />
            </div>
            <div class="mt-1.5 flex items-center justify-between gap-2">
              <p class="text-[11.5px] text-ink-faint">{{ p.sessions_used }}/{{ p.sessions_total }} {{ t('used', 'usadas') }} &middot; {{ money(p.price_cents) }}</p>
              <div class="flex items-center gap-2">
                <button type="button" class="text-[11.5px] font-medium text-ink-muted hover:text-brand-text" @click="toggleShares(p.id)">
                  {{ t('Share', 'Compartir') }}{{ shares[p.id]?.length ? ` (${shares[p.id].length})` : '' }}…
                </button>
                <button
                  type="button"
                  :disabled="p.sessions_used >= p.sessions_total"
                  class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover disabled:opacity-40"
                  @click="useSession(p)"
                >
                  {{ t('Log session', 'Registrar sesión') }}
                </button>
                <button v-if="can('billing_config')" type="button" class="text-[11.5px] font-medium text-danger-text hover:text-danger-text/80" @click="deletePackagePurchase(p)">
                  {{ t('Delete', 'Eliminar') }}
                </button>
              </div>
            </div>

            <div v-if="openSharesPackageId === p.id" class="mt-2 rounded-ctlSm bg-surface-subtle p-2">
              <ul v-if="shares[p.id]?.length" class="space-y-1">
                <li v-for="sp in shares[p.id]" :key="sp.id" class="flex items-center justify-between text-[11.5px] text-ink-600">
                  <span>{{ sp.first_name }} {{ sp.last_name }}</span>
                  <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeShare(p.id, sp.id)">✕</button>
                </li>
              </ul>
              <div class="relative mt-1.5">
                <input
                  v-model="shareSearch"
                  type="text"
                  :placeholder="t('Search a patient to share with…', 'Buscar un paciente con quien compartir…')"
                  class="w-full rounded border border-line-control bg-surface px-2 py-1 text-[11.5px]"
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

            <div v-if="scheduleForPackage(p.id)" class="mt-2 flex items-center justify-between rounded-ctlSm bg-surface-subtle px-2 py-1.5">
              <span class="text-[11.5px] text-ink-600">
                {{ t('Autopay', 'Pago automático') }} <UiPill :tone="scheduleTone[scheduleForPackage(p.id)!.status] ?? 'neutral'">{{ scheduleForPackage(p.id)!.status }}</UiPill>
                {{ scheduleForPackage(p.id)!.installments_paid }}/{{ scheduleForPackage(p.id)!.installments_total }}
              </span>
              <button v-if="scheduleForPackage(p.id)!.status === 'active'" type="button" class="text-[11px] text-danger-text hover:underline" @click="cancelAutopay(scheduleForPackage(p.id)!.id)">
                {{ t('Cancel', 'Cancelar') }}
              </button>
            </div>
            <div v-else-if="hasCard" class="mt-2">
              <button v-if="autopayFormFor !== p.id" type="button" class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover" @click="openAutopayForm(p.id)">
                {{ t('Set up autopay', 'Configurar pago automático') }}
              </button>
              <form v-else class="mt-1 flex flex-wrap items-end gap-1.5 rounded-ctlSm bg-surface-subtle p-2" @submit.prevent="setUpPackageAutopay(p)">
                <input v-model.number="autopayInstallments" type="number" min="1" :title="t('Installments', 'Plazos')" class="w-14 rounded border border-line-control px-1.5 py-1 text-[11.5px]" />
                <input v-model.number="autopayIntervalCount" type="number" min="1" :title="t('Every', 'Cada')" class="w-12 rounded border border-line-control px-1.5 py-1 text-[11.5px]" />
                <select v-model="autopayInterval" class="bg-surface rounded border border-line-control px-1.5 py-1 text-[11.5px]">
                  <option value="day">{{ t('day(s)', 'día(s)') }}</option>
                  <option value="week">{{ t('week(s)', 'semana(s)') }}</option>
                  <option value="month">{{ t('month(s)', 'mes(es)') }}</option>
                  <option value="year">{{ t('year(s)', 'año(s)') }}</option>
                </select>
                <input v-model.number="autopayAlreadyPaid" type="number" min="0" :title="t('Already paid', 'Ya pagado')" class="w-14 rounded border border-line-control px-1.5 py-1 text-[11.5px]" />
                <button type="submit" :disabled="settingUpAutopay" class="rounded-ctlSm bg-brand px-2 py-1 text-[11.5px] font-medium text-white hover:bg-brand-hover disabled:opacity-50">
                  {{ settingUpAutopay ? '…' : t('Start', 'Iniciar') }}
                </button>
                <button type="button" class="text-[11px] text-ink-muted2 hover:underline" @click="autopayFormFor = null">{{ t('Cancel', 'Cancelar') }}</button>
                <p v-if="autopayError" class="w-full text-[11px] text-danger-text">{{ autopayError }}</p>
              </form>
            </div>
            <div v-else class="mt-2 flex items-center justify-between rounded-ctlSm bg-surface-subtle px-2 py-1.5">
              <span class="text-[11.5px] text-ink-muted2">{{ t("No card on file -- add one to enable autopay for the remaining balance.", 'No hay tarjeta registrada; añade una para habilitar el pago automático del saldo restante.') }}</span>
              <button type="button" class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover" @click="showCardModal = true">{{ t('Add card', 'Añadir tarjeta') }}</button>
            </div>
          </div>
          <p v-if="purchases.length === 0" class="text-[12.5px] text-ink-faint">{{ t('No packages purchased.', 'No se ha comprado ningún bono.') }}</p>
        </div>
        <form class="mt-3 flex flex-wrap items-end gap-2 border-t border-line-divider pt-3" @submit.prevent="sellPackage">
          <select v-model="sellPackageId" class="bg-surface flex-1 rounded-ctl border border-line-control px-2.5 py-1.5 text-[12.5px]">
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
      </div>

      <!-- Memberships -->
      <div class="rounded-card border border-line bg-surface p-4 shadow-card">
        <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Memberships', 'Membresías') }}</p>
        <div v-if="patientMemberships.length === 0" class="mt-3 rounded-ctl border border-dashed border-line-control p-4 text-center text-[12.5px] text-ink-faint">
          {{ t('No active memberships for this patient.', 'Este paciente no tiene membresías activas.') }}
        </div>
        <div v-else class="mt-3 space-y-3">
          <div v-for="m in patientMemberships" :key="m.id" class="rounded-ctl border border-line-divider p-3">
            <div class="flex items-center justify-between gap-2">
              <p class="truncate text-[13px] font-medium text-ink-700">{{ m.membership_name }}</p>
              <UiPill :tone="statusTone[m.status] ?? 'neutral'">{{ m.status }}</UiPill>
            </div>
            <p class="mt-1 text-[11.5px] text-ink-faint">{{ money(m.price_cents) }}/{{ t('period', 'periodo') }} &middot; {{ t('started', 'iniciada el') }} {{ new Date(m.started_at).toLocaleDateString() }}</p>
            <div class="mt-1.5 flex items-center gap-2">
              <button type="button" class="text-[11.5px] font-medium text-ink-muted hover:text-ink-700" @click="logPayment(m, 'paid')">{{ t('Log payment', 'Registrar pago') }}</button>
              <button type="button" class="text-[11.5px] font-medium text-danger-text hover:text-danger-text/80" @click="logPayment(m, 'failed')">{{ t('Log failed', 'Registrar fallo') }}</button>
              <select
                :value="m.status"
                class="ml-auto rounded-ctlSm border border-line-control bg-surface px-1.5 py-0.5 text-[11.5px]"
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

            <div v-if="scheduleForMembership(m.id)" class="mt-2 flex items-center justify-between rounded-ctlSm bg-surface-subtle px-2 py-1.5">
              <span class="text-[11.5px] text-ink-600">
                {{ t('Autopay', 'Pago automático') }} <UiPill :tone="scheduleTone[scheduleForMembership(m.id)!.status] ?? 'neutral'">{{ scheduleForMembership(m.id)!.status }}</UiPill>
                {{ t('every', 'cada') }} {{ scheduleForMembership(m.id)!.interval_count }} {{ scheduleForMembership(m.id)!.interval }}(s) &middot;
                {{ eventsForSchedule(scheduleForMembership(m.id)!.id).length }} {{ t('charge(s)', 'cobro(s)') }}
              </span>
              <button v-if="scheduleForMembership(m.id)!.status === 'active'" type="button" class="text-[11px] text-danger-text hover:underline" @click="cancelAutopay(scheduleForMembership(m.id)!.id)">
                {{ t('Cancel', 'Cancelar') }}
              </button>
            </div>
            <div v-else-if="hasCard" class="mt-2">
              <button v-if="autopayFormFor !== m.id" type="button" class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover" @click="openAutopayForm(m.id)">
                {{ t('Set up autopay', 'Configurar pago automático') }}
              </button>
              <form v-else class="mt-1 flex flex-wrap items-end gap-1.5 rounded-ctlSm bg-surface-subtle p-2" @submit.prevent="setUpMembershipAutopay(m)">
                <input v-model.number="autopayIntervalCount" type="number" min="1" :title="t('Every', 'Cada')" class="w-12 rounded border border-line-control px-1.5 py-1 text-[11.5px]" />
                <select v-model="autopayInterval" class="bg-surface rounded border border-line-control px-1.5 py-1 text-[11.5px]">
                  <option value="day">{{ t('day(s)', 'día(s)') }}</option>
                  <option value="week">{{ t('week(s)', 'semana(s)') }}</option>
                  <option value="month">{{ t('month(s)', 'mes(es)') }}</option>
                  <option value="year">{{ t('year(s)', 'año(s)') }}</option>
                </select>
                <button type="submit" :disabled="settingUpAutopay" class="rounded-ctlSm bg-brand px-2 py-1 text-[11.5px] font-medium text-white hover:bg-brand-hover disabled:opacity-50">
                  {{ settingUpAutopay ? '…' : t('Start', 'Iniciar') }}
                </button>
                <button type="button" class="text-[11px] text-ink-muted2 hover:underline" @click="autopayFormFor = null">{{ t('Cancel', 'Cancelar') }}</button>
                <p v-if="autopayError" class="w-full text-[11px] text-danger-text">{{ autopayError }}</p>
              </form>
            </div>
            <div v-else class="mt-2 flex items-center justify-between rounded-ctlSm bg-surface-subtle px-2 py-1.5">
              <span class="text-[11.5px] text-ink-muted2">{{ t("No card on file -- add one to enable autopay for this membership.", 'No hay tarjeta registrada; añade una para habilitar el pago automático de esta membresía.') }}</span>
              <button type="button" class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover" @click="showCardModal = true">{{ t('Add card', 'Añadir tarjeta') }}</button>
            </div>
          </div>
        </div>
        <form class="mt-3 flex flex-wrap items-end gap-2 border-t border-line-divider pt-3" @submit.prevent="activateMembership">
          <select v-model="activateMembershipId" class="bg-surface flex-1 rounded-ctl border border-line-control px-2.5 py-1.5 text-[12.5px]">
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
