<script setup lang="ts">
import { settleInvoiceIfCovered } from '~/utils/settleInvoice'
const props = defineProps<{
  appointmentId: string
  patientId: string
  appointmentTypeName?: string
  appointmentTypePriceCents?: number
}>()

const emit = defineEmits<{ completed: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const { fire } = useAutomations()
const { issueFactura } = useFacturas()
const t = useT()

const { loading: summaryLoading, balanceCents, availableCents, creditLedgerCents, bonoValueCents, activeMembership, activePackages, refresh: refreshSummary } = usePatientFinancialSummary(
  () => props.patientId,
)

interface InvoiceRow { id: string; invoice_number: string; status: string; total_cents: number }
interface LineItemRow { id: string; description: string; quantity: number; price_cents: number; service_id: string | null }
interface PaymentRow { id: string; amount_cents: number; method: string; paid_at: string }
interface ServiceOption { id: string; name: string; price_cents: number }

const invoice = ref<InvoiceRow | null>(null)
const lineItems = ref<LineItemRow[]>([])
const payments = ref<PaymentRow[]>([])
const services = ref<ServiceOption[]>([])
const addServiceId = ref('')
const loadingInvoice = ref(true)
// Whether THIS appointment itself hasn't happened yet. (Whether the patient
// has any OTHER future appointment is the Recalls warning, and lives on the
// Details tab now -- it is a fact about the booking, not about money.)
// Opening this tab must not invoice a visit that hasn't occurred: a patient
// owes nothing for a future booking until it actually happens or someone
// deliberately bills them (e.g. the patient's own Billing tab).
const appointmentIsUpcoming = ref(true)

// 'credit' triggers a compound operation: a payments row (method: 'credit')
// plus a negative account_credits row -- the same pattern the patient's main
// Billing tab already uses for "Apply credit" (BillingTab.vue). Rows can
// split one payment across methods (part cash, part card) -- see
// useSplitPayment.
const { methods: paymentMethods, ensureLoaded: ensurePaymentMethodsLoaded, defaultMethod } = usePaymentMethods()
const { rows: paymentRows, reset: resetPaymentRows, addRow: addPaymentRow, removeRow: removePaymentRow, centsOf: paymentRowCents, totalCents: paymentTotalCents, creditCents: paymentCreditCents } = useSplitPayment('cash', computed(() => paymentMethods.value.map((m) => m.key)))
const savingPayment = ref(false)
const error = ref('')

const sendingInvoice = ref(false)
const sendResult = ref('')
async function sendInvoiceEmail() {
  if (!invoice.value) return
  sendingInvoice.value = true
  sendResult.value = ''
  try {
    await useStaffFetch(`/api/invoices/${invoice.value.id}/send`, { method: 'POST' })
    sendResult.value = t('Sent', 'Enviado')
  } catch (e: any) {
    sendResult.value = e?.data?.message ?? t('Failed to send', 'Error al enviar')
  }
  sendingInvoice.value = false
}

const paidCents = computed(() => payments.value.reduce((sum, p) => sum + p.amount_cents, 0))
/**
 * Nothing is due on an invoice already marked paid, even with no payment rows
 * against it.
 *
 * A visit drawn from a prepaid bono is exactly that shape: chargeTheVisit()
 * raises the charge and marks it paid because the balance already covers it --
 * the money went in when the bono was bought -- so no payment row is ever
 * created. settle_imported_invoices() left the whole migrated history looking
 * the same way.
 *
 * Reading the balance from payment rows alone therefore showed the full
 * session price as still due and put the take-payment box in front of
 * reception, on a visit the patient had already paid for. Five patients paid
 * twice on 15 Sep that way -- EUR 206 across maximiliano mosciaro, Kenneth
 * Davis, Carolina Cañamas, yaimara garcia montero and Eduardo Stengel -- all
 * of them holding a bono with nothing outstanding.
 *
 * Status is the right thing to trust here: deletePayment recomputes it from
 * what is actually left, so a 'paid' invoice with no payments means covered,
 * never stale.
 */
const balanceDueCents = computed(() =>
  invoice.value?.status === 'paid' ? 0 : (invoice.value?.total_cents ?? 0) - paidCents.value,
)

async function loadAppointmentTiming() {
  const { data } = await supabase.from('appointments').select('starts_at').eq('id', props.appointmentId).maybeSingle()
  appointmentIsUpcoming.value = !!data && new Date(data.starts_at) > new Date()
}

// Reads the invoice for this appointment, if someone has raised one. Opening
// this tab is a read -- see ensureInvoice() for why it must never write.
async function findInvoice(): Promise<InvoiceRow | null> {
  const { data } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_cents')
    .eq('appointment_id', props.appointmentId)
    .maybeSingle()
  return data ?? null
}

// Creates the invoice on demand. Called only from an actual billing action --
// today that is chargeVisit(), reached by pressing "Charge" on a visit nobody
// has billed yet -- and never from opening this tab.
//
// It used to run from loadInvoice(), so merely looking at a past appointment's
// Billing tab raised an unpaid invoice at the appointment type's list price,
// before anyone had said how the visit would be paid. Three things then
// compounded:
//
//   - a visit the patient settled with their bono still got an invoice, and
//     usePackageSession()'s cleanup below only deletes it when nothing was
//     added and nothing was collected -- so any other case left a phantom
//     debt standing against the patient;
//   - loadInvoice() pre-filled the payment row with the full balance, and
//     useSplitPayment defaults the method to cash, so the panel opened one
//     click away from recording a full-price cash payment nobody had made.
//     Ten such payments (EUR 560, nine exactly at list price) were recorded
//     this way since go-live;
//   - every visit anyone glanced at consumed an invoice number.
//
// Nothing is written now until someone chooses how the visit is paid: charge
// it, or spend a bono session. For an appointment that hasn't happened yet
// there is nothing to bill at all, so this returns null and the caller no-ops.

// Set when this visit has already been drawn from a bono. Doubles as the
// "don't raise an invoice" flag for ensureInvoice() and as what the panel
// shows in place of invoice lines -- otherwise a covered visit renders an
// empty billing panel, since there is no invoice left to display.
const packageCoverage = ref<{ packageName: string; amountCents: number } | null>(null)

async function loadPackageCoverage() {
  const { data } = await supabase
    .from('package_sessions')
    .select('amount_cents, package_purchases(package_name)')
    .eq('appointment_id', props.appointmentId)
    .maybeSingle()
  const row = data as unknown as { amount_cents: number; package_purchases: { package_name: string } | null } | null
  packageCoverage.value = row ? { packageName: row.package_purchases?.package_name ?? '', amountCents: row.amount_cents } : null
}

async function ensureInvoice(): Promise<InvoiceRow | null> {
  const existing = await findInvoice()

  if (existing) return existing
  if (!can('billing_access')) return null
  if (appointmentIsUpcoming.value) return null

  // A visit already drawn from a bono is not a billing event -- the patient
  // paid for it when they bought the bono. The panel hides the Charge button
  // once a session has been spent, so this is the backstop for a tab that was
  // already open when the bono was used somewhere else.
  // loadPackageCoverage() runs first, so this reads an already-fetched value
  // rather than querying again.
  if (packageCoverage.value) return null

  const { data: invoiceNumber, error: numberError } = await supabase.rpc('next_invoice_number', { p_account_id: store.accountId! })
  if (numberError || !invoiceNumber) {
    error.value = numberError?.message ?? t('Could not allocate a receipt number.', 'No se ha podido asignar un número de recibo.')
    return null
  }
  const priceCents = props.appointmentTypePriceCents ?? 0
  const description = props.appointmentTypeName ?? 'Appointment'

  const { data: newInvoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      appointment_id: props.appointmentId,
      invoice_number: invoiceNumber,
      status: 'unpaid',
      total_cents: priceCents,
    })
    .select('id, invoice_number, status, total_cents')
    .single()

  if (invoiceError) {
    error.value = invoiceError.message
    return null
  }

  await supabase.from('invoice_line_items').insert({
    account_id: store.accountId!,
    invoice_id: newInvoice.id,
    description,
    quantity: 1,
    price_cents: priceCents,
  })

  return newInvoice
}

async function loadInvoice() {
  loadingInvoice.value = true
  error.value = ''

  await loadPackageCoverage()
  const inv = await findInvoice()

  invoice.value = inv
  lineItems.value = []
  payments.value = []
  if (inv) {
    const [{ data: lines }, { data: pays }] = await Promise.all([
      supabase.from('invoice_line_items').select('id, description, quantity, price_cents, service_id').eq('invoice_id', inv.id),
      supabase.from('payments').select('id, amount_cents, method, paid_at').eq('invoice_id', inv.id).order('paid_at', { ascending: false }),
    ])
    lineItems.value = lines ?? []
    payments.value = pays ?? []
    resetPaymentRows((balanceDueCents.value / 100).toFixed(2))
  }
  loadingInvoice.value = false
}

onMounted(async () => {
  await ensurePaymentMethodsLoaded()
  for (const row of paymentRows.value) if (row.method !== 'credit') row.method = defaultMethod.value
  const { data: svc } = await supabase.from('services_products').select('id, name, price_cents').order('name')
  services.value = svc ?? []
  await loadAppointmentTiming()
  await loadInvoice()
})

async function recalcInvoiceTotal() {
  if (!invoice.value) return
  const totalCents = lineItems.value.reduce((sum, l) => sum + l.price_cents * l.quantity, 0)
  await supabase.from('invoices').update({ total_cents: totalCents }).eq('id', invoice.value.id)
  invoice.value.total_cents = totalCents
  resetPaymentRows((balanceDueCents.value / 100).toFixed(2))
}

const visitPriceCents = computed(() => props.appointmentTypePriceCents ?? 0)
// An appointment type with no price of its own (the visit is billed from the
// services added to it) would otherwise offer "Charge €0.00".
// The rate a bono button quotes, rounded the way usePackageSession rounds
// what it actually bills, so the button and the charge cannot disagree.
function perSessionLabel(p: { price_cents: number; sessions_total: number }): string {
  if (!p.sessions_total) return '—'
  return `€${(Math.round(p.price_cents / p.sessions_total) / 100).toFixed(2)}`
}

const chargeLabel = computed(() =>
  visitPriceCents.value > 0
    ? `${t('Charge', 'Cobrar')} €${(visitPriceCents.value / 100).toFixed(2)}`
    : t('Charge this visit', 'Cobrar esta visita'),
)

// "Charge" on an unbilled visit: raise the invoice at the appointment type's
// price, which is exactly what opening this tab used to do by itself. The
// difference is that a person now says so.
async function chargeVisit() {
  if (invoice.value || savingPayment.value) return
  savingPayment.value = true
  error.value = ''
  const inv = await ensureInvoice()
  savingPayment.value = false
  if (inv) await loadInvoice()
}

async function addLineItem() {
  if (!invoice.value || !addServiceId.value) return
  const svc = services.value.find((s) => s.id === addServiceId.value)
  if (!svc) return

  const { data } = await supabase
    .from('invoice_line_items')
    .insert({
      account_id: store.accountId!,
      invoice_id: invoice.value.id,
      service_id: svc.id,
      description: svc.name,
      quantity: 1,
      price_cents: svc.price_cents,
    })
    .select('id, description, quantity, price_cents, service_id')
    .single()

  if (data) lineItems.value.push(data)
  addServiceId.value = ''
  await recalcInvoiceTotal()
}

async function removeLineItem(item: LineItemRow) {
  await supabase.from('invoice_line_items').delete().eq('id', item.id)
  lineItems.value = lineItems.value.filter((l) => l.id !== item.id)
  await recalcInvoiceTotal()
}

async function usePackageSession(pkg: { id: string; package_name: string; sessions_used: number; sessions_total: number; price_cents: number }) {
  // No invoice required: a bono visit is normally billed straight from the
  // unbilled panel, with nothing raised against it at all.
  if (pkg.sessions_used >= pkg.sessions_total) return
  // This visit is already settled -- e.g. billed from the mobile app while
  // this tab was still open on another screen. Spending a session here too
  // would burn a real session for a visit that isn't taking one: the invoice
  // is already paid, so there is nothing left to charge, and the session
  // would vanish with no payment, no credit, and (before this check) no
  // package_sessions row behind it either. Janina Ron's newly-bought
  // "maintenance" bono lost a session this way when it, not the bono actually
  // being visited, was tapped on an appointment already paid from the web tab.
  if (invoice.value?.status === 'paid') {
    error.value = t('This visit has already been billed.', 'Esta visita ya ha sido facturada.')
    return
  }
  savingPayment.value = true

  // Has this visit already taken a session? The compare-and-set below does
  // not answer that: it defends against a SHARED bono being drawn on from two
  // patients' screens at once, where the second write must lose. A second
  // click on the same screen is not that -- it reads the count the first one
  // left behind, claims the next session legitimately, and takes a second
  // session for a visit that only happened once. Adrian Oropeza's bono lost
  // 44 EUR that way, two clicks 18 seconds apart.
  //
  // Read from the database, not from anything this component is holding: the
  // first click's own write is what has to be seen.
  const { data: existingSession } = await supabase
    .from('package_sessions')
    .select('id, package_purchase_id, package_purchases(package_name)')
    .eq('appointment_id', props.appointmentId)
    .maybeSingle()
  if (existingSession) {
    const takenFrom = (existingSession as unknown as { package_purchases: { package_name: string } | null }).package_purchases?.package_name
    error.value = takenFrom
      ? t(`This visit is already covered by ${takenFrom}.`, `Esta visita ya está cubierta por ${takenFrom}.`)
      : t('This visit has already taken a session from a bono.', 'Esta visita ya ha usado una sesión de un bono.')
    savingPayment.value = false
    await refreshSummary()
    return
  }

  // Re-read the bono rather than trusting the copy this component loaded.
  // `activePackages` includes bonos SHARED from another patient (a family
  // bono), and a shared bono is being drawn on from several patients' screens
  // at once, so the copy in hand goes stale the moment a relative uses a
  // session. Krista Lozada's Bono Familiar was drawn on twice within ten
  // seconds -- once by her, once by Grace Valencia -- and both writes computed
  // 0 + 1, so the bono recorded one session while paying for two.
  const { data: bono } = await supabase
    .from('package_purchases')
    .select('id, patient_id, package_name, sessions_used, sessions_total, price_cents')
    .eq('id', pkg.id)
    .maybeSingle()
  if (!bono || bono.sessions_used >= bono.sessions_total) {
    error.value = t('That bono has no sessions left.', 'Ese bono no tiene sesiones restantes.')
    savingPayment.value = false
    await refreshSummary()
    return
  }

  // Compare-and-set on the count we just read: if a relative took a session in
  // between, this matches nothing and the visit is not silently charged to a
  // session the bono never gave up.
  const { data: claimed } = await supabase
    .from('package_purchases')
    .update({ sessions_used: bono.sessions_used + 1 })
    .eq('id', bono.id)
    .eq('sessions_used', bono.sessions_used)
    .select('id')
    .maybeSingle()
  if (!claimed) {
    error.value = t('Someone just used a session from this bono. Try again.', 'Alguien acaba de usar una sesión de este bono. Inténtalo de nuevo.')
    savingPayment.value = false
    await refreshSummary()
    return
  }

  // What this visit was worth against the bono: the bono's own per-session
  // value (total price ÷ total sessions), which is what the patient actually
  // paid per visit when they bought it -- not this appointment type's
  // standalone/drop-in price. Recorded on the session row for history; it is
  // not billed, because the patient already paid it at the sale.
  const perSessionCents = Math.round(bono.price_cents / bono.sessions_total)

  // The visit itself, on the bono's own history -- and, since this release,
  // the bono's own history. It is no longer the visit's only record: since the
  // PracticeHub re-migration a visit is also CHARGED, at the bono's
  // per-session rate, because that is what draws the prepayment down.
  //
  // 0161 removed the charge for the opposite reason -- back then a bono's
  // value lived on a spendable credit ledger AND on the counter, so charging
  // per visit and settling from that credit spent the same money twice. The
  // credit ledger no longer holds it: the money is in the balance, once, and
  // the charge below is what consumes it. Pay 264 for a bono, take a 44 EUR
  // visit, the balance reads 220 -- which is what PracticeHub shows and what
  // all 7,018 imported visits already look like.
  //
  // patient_id is the person in the chair, not the bono's owner: on a family
  // bono the visit belongs to whoever took it, even though the sessions come
  // off the owner's bono. used_at is the appointment's own time, so a session
  // logged late still lands on the day of the visit.
  const { data: appt } = await supabase.from('appointments').select('starts_at').eq('id', props.appointmentId).maybeSingle()
  await supabase.from('package_sessions').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    package_purchase_id: bono.id,
    appointment_id: props.appointmentId,
    amount_cents: perSessionCents,
    used_at: appt?.starts_at ?? new Date().toISOString(),
  })

  // The visit's charge, at the bono's per-session rate rather than the
  // appointment type's walk-in price -- that rate is what the patient actually
  // paid per visit when they bought the bono.
  //
  // Marked paid when the patient's balance already covers it, which for a
  // prepaid bono it does. That is the same rule settle_imported_invoices()
  // applied to the imported history, so a visit taken today is recorded the
  // way every visit before it was.
  // Captured out here: TypeScript loses the null-narrowing on `bono` inside a
  // closure, and the name is all the charge needs.
  const bonoName = bono.package_name
  // Captured out here for the same reason as the name above: TypeScript loses
  // the null-narrowing on `bono` inside the closure.
  const bonoPurchaseId = bono.id
  async function chargeTheVisit(): Promise<void> {
    const { data: chargeNumber } = await supabase.rpc('next_invoice_number', { p_account_id: store.accountId! })
    if (!chargeNumber) {
      error.value = t('Could not allocate a receipt number.', 'No se ha podido asignar un número de recibo.')
      return
    }
    const { data: created } = await supabase
      .from('invoices')
      .insert({
        account_id: store.accountId!,
        patient_id: props.patientId,
        appointment_id: props.appointmentId,
        invoice_number: chargeNumber,
        status: balanceCents.value >= perSessionCents ? 'paid' : 'unpaid',
        total_cents: perSessionCents,
      })
      .select('id')
      .single()
    if (created) {
      await supabase.from('invoice_line_items').insert({
        account_id: store.accountId!,
        invoice_id: created.id,
        description: bonoSessionDescription(bonoName),
        package_purchase_id: bonoPurchaseId,
        quantity: 1,
        price_cents: perSessionCents,
      })
    }
  }

  // An invoice this visit already carries. Since ensureInvoice() stopped
  // firing on open there is usually none -- but there are two ways to get here
  // with one: an appointment invoiced before that change, and a visit
  // deliberately charged at the walk-in price and then settled with the bono
  // after all. Either way the walk-in price is the wrong number now.
  //
  // Extras (a product, an added service: the lines carrying a service_id) are
  // real money owed on top of the bono, so those keep their invoice.
  if (invoice.value) {
    const extraLines = lineItems.value.filter((l) => l.service_id)
    const baseLine = lineItems.value.find((l) => !l.service_id)

    if (extraLines.length === 0 && payments.value.length === 0) {
      // Nothing chargeable and nothing collected: the invoice should never have
      // existed. Deleting is safe here precisely because there are no payments --
      // payments cascade on invoice delete, so this branch must stay guarded on
      // payments being empty or it would destroy real money records.
      await supabase.from('invoices').delete().eq('id', invoice.value.id)
      invoice.value = null
      lineItems.value = []
    } else {
      // Something stays billable. Drop the covered visit line and reprice, so
      // the patient is charged for the extras only.
      if (baseLine) {
        await supabase.from('invoice_line_items').delete().eq('id', baseLine.id)
        lineItems.value = lineItems.value.filter((l) => l.id !== baseLine.id)
      }
      const totalCents = lineItems.value.reduce((sum, l) => sum + l.price_cents * l.quantity, 0)
      await supabase.from('invoices').update({ total_cents: totalCents }).eq('id', invoice.value.id)
      invoice.value.total_cents = totalCents
    }
  }

  await chargeTheVisit()

  // Completing the visit is unchanged -- it happened, whatever paid for it.
  // No 'invoice.paid' event and no auto-send: with the visit covered by the
  // bono there is either no invoice at all, or one still open for the extras.
  await supabase.from('appointments').update({ status: 'completed' }).eq('id', props.appointmentId)
  emit('completed')
  fire('appointment.completed', { patientId: props.patientId, appointmentId: props.appointmentId })

  savingPayment.value = false
  await loadInvoice()
  await refreshSummary()
}

async function recordPayment() {
  if (!invoice.value) return
  error.value = ''
  const rows = paymentRows.value.filter((r) => paymentRowCents(r) > 0)
  if (rows.length === 0) return
  // balanceCents is negative when the patient owes money, so this must only
  // run when a credit row actually exists -- otherwise 0 > a negative
  // balance reads as "exceeded" and blocks a plain cash/card payment.
  // Capped by the credit LEDGER, not the balance. Since the re-migration a
  // balance carries prepaid bono money -- pay 264 for a bono and the balance
  // reads 264 until visits draw it down -- and that money is not spendable
  // twice: it buys the sessions. Offering it here as "credit on account" would
  // let it be spent again while the counter still holds the visits, which is
  // exactly the double-count migration 0161 removed.
  if (paymentCreditCents.value > 0 && paymentCreditCents.value > creditLedgerCents.value) {
    error.value = t('Amount exceeds available credit.', 'El importe supera el crédito disponible.')
    return
  }
  savingPayment.value = true

  const { data: insertedPayments } = await supabase
    .from('payments')
    .insert(
      rows.map((r) => ({
        account_id: store.accountId!,
        patient_id: props.patientId,
        invoice_id: invoice.value!.id,
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
      serviceName: props.appointmentTypeName,
    })
  }
  const creditRows = rows.filter((r) => r.method === 'credit')
  if (creditRows.length > 0) {
    await supabase.from('account_credits').insert(
      creditRows.map((r) => ({
        account_id: store.accountId!,
        patient_id: props.patientId,
        amount_cents: -paymentRowCents(r),
        reason: `Applied to invoice ${invoice.value!.invoice_number}`,
        invoice_id: invoice.value!.id,
        created_by: store.teamMember?.id ?? null,
      })),
    )
  }

  // Decided from the database, not from the totals this dialog loaded when it
  // opened -- see utils/settleInvoice.
  if (await settleInvoiceIfCovered(supabase, invoice.value.id)) {
    // Recording full payment implies the visit happened -- mirrors PracticeHub's
    // "Process" button, which finalizes the invoice and completes the visit
    // in one action rather than requiring a separate status change.
    await supabase.from('appointments').update({ status: 'completed' }).eq('id', props.appointmentId)
    emit('completed')
    fire('invoice.paid', { patientId: props.patientId, appointmentId: props.appointmentId, invoiceId: invoice.value.id })
    fire('appointment.completed', { patientId: props.patientId, appointmentId: props.appointmentId })

    const { data: patient } = await supabase.from('patients').select('invoice_email_enabled, email').eq('id', props.patientId).maybeSingle()
    if (patient?.invoice_email_enabled && patient.email) {
      // Best-effort -- a failed auto-send shouldn't block having just
      // completed the visit and taken payment.
      useStaffFetch(`/api/invoices/${invoice.value.id}/send`, { method: 'POST' }).catch(() => {})
    }
  }

  savingPayment.value = false
  await loadInvoice()
  await refreshSummary()
}
</script>

<template>
  <div class="space-y-4 text-sm">
    <div class="rounded-card border border-line bg-surface-subtle p-3">
      <div v-if="summaryLoading" class="text-ink-faint">{{ t('Loading patient summary…', 'Cargando resumen del paciente…') }}</div>
      <div v-else class="space-y-1.5">
        <p class="flex items-center gap-1.5">
          <span class="text-ink-muted2">{{ t('Balance:', 'Saldo:') }}</span>
          <UiBalancePill :available-cents="availableCents" :balance-cents="balanceCents" />
          <span v-if="balanceCents === 0" class="font-medium text-ink-700">€0.00</span>
        </p>
        <p v-if="activeMembership">
          <span class="text-ink-muted2">{{ t('Membership:', 'Membresía:') }}</span>
          <span class="ml-1 font-medium text-ink-900">{{ activeMembership.membership_name }}</span>
          <span class="ml-1 rounded-ctlSm bg-success-bg px-1.5 py-0.5 text-xs font-medium text-success-text">{{ t('active', 'activa') }}</span>
        </p>
        <p v-else class="text-ink-faint">{{ t('No active membership', 'Sin membresía activa') }}</p>
        <div v-if="activePackages.length > 0" class="flex flex-wrap items-center gap-1">
          <span class="text-ink-muted2">{{ t('Packages:', 'Bonos:') }}</span>
          <span
            v-for="p in activePackages"
            :key="p.id"
            class="inline-flex items-center gap-1.5 rounded-ctlSm bg-brand-tint px-1.5 py-0.5 text-xs font-medium text-brand-text"
          >
            {{ p.package_name }}: {{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }}
            <span
              v-if="p.shared"
              class="rounded-ctlSm bg-info-bg px-1 py-0.5 text-[10px] font-semibold text-info-text"
              :title="p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido')"
            >
              {{ t('Shared', 'Compartido') }}
            </span>
          </span>
        </div>
      </div>
    </div>

    <div v-if="loadingInvoice" class="text-ink-faint">{{ t('Loading receipt…', 'Cargando recibo…') }}</div>
    <p v-else-if="!invoice && appointmentIsUpcoming" class="text-ink-faint">
      {{ t("This appointment hasn't happened yet — no receipt until it does.", 'Esta cita todavía no ha ocurrido: no habrá recibo hasta entonces.') }}
    </p>
    <p v-else-if="!invoice && !can('billing_access')" class="text-ink-faint">{{ t('No receipt for this appointment yet.', 'Todavía no hay recibo para esta cita.') }}</p>
    <!-- Covered by a bono and nothing extra was added, so there is no invoice
    to show. Say so explicitly: an empty panel reads as something failing. -->
    <div v-else-if="!invoice && packageCoverage" class="rounded-card border border-line bg-surface p-3">
      <p class="text-[13px] font-medium text-ink-700">
        {{ t('Covered by', 'Cubierta por') }} {{ packageCoverage.packageName || t('a bono', 'un bono') }}
      </p>
      <p class="mt-0.5 text-[12.5px] text-ink-muted2">
        {{ t('Worth', 'Valor') }} €{{ (packageCoverage.amountCents / 100).toFixed(2) }} —
        {{ t('paid when the bono was bought.', 'pagada al comprar el bono.') }}
      </p>
    </div>
    <!-- Past visit, nothing billed against it yet. This is the choice that
    used to be made for reception by ensureInvoice() running on open: charge
    the visit, or spend a bono session. Until one is pressed, no invoice
    exists and nothing is owed. -->
    <div v-else-if="!invoice" class="rounded-card border border-line bg-surface p-3">
      <p class="text-[13px] font-medium text-ink-700">{{ t('Not charged yet', 'Sin cobrar') }}</p>
      <p class="mt-0.5 text-[12.5px] text-ink-muted2">
        {{ appointmentTypeName || t('Appointment', 'Cita') }}<span v-if="visitPriceCents > 0"> — €{{ (visitPriceCents / 100).toFixed(2) }}</span>
      </p>
      <!-- A patient holding a bono has already paid for this visit, so that
      is the action rather than the footnote it used to be: the filled button
      was "Charge EUR 55.00" and the bono a small "Or use a package session:"
      line beneath it, so the obvious click charged a bono patient the walk-in
      price on top of the bono they had already bought. Each button states the
      rate it will charge -- the bono's -- so the two can be compared before
      either is pressed. -->
      <div v-if="activePackages.length > 0" class="mt-2 flex flex-wrap items-center gap-2">
        <button
          v-for="p in activePackages"
          :key="p.id"
          type="button"
          :disabled="savingPayment"
          class="rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          @click="usePackageSession(p)"
        >
          {{ savingPayment ? t('Working…', 'Procesando…') : `${t('Use', 'Usar')} ${p.package_name} — ${perSessionLabel(p)}` }}
          <span class="font-normal opacity-80">({{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }})</span>
          <span v-if="p.shared" class="ml-1 rounded-ctlSm bg-info-bg px-1 py-0.5 text-[10px] font-semibold text-info-text">
            {{ p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido') }}
          </span>
        </button>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2" :class="activePackages.length > 0 ? 'border-t border-line-divider pt-2' : ''">
        <button
          type="button"
          :disabled="savingPayment"
          :class="
            activePackages.length > 0
              ? 'rounded-ctl border border-line-control px-3 py-1.5 text-sm font-medium text-ink-700 hover:border-line-controlHover hover:text-ink-900 disabled:opacity-50'
              : 'rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50'
          "
          @click="chargeVisit"
        >
          {{ savingPayment ? t('Working…', 'Procesando…') : activePackages.length > 0 ? `${chargeLabel} ${t('instead', 'en su lugar')}` : chargeLabel }}
        </button>
      </div>
    </div>
    <div v-else-if="invoice" class="rounded-card border border-line bg-surface p-3">
      <p v-if="packageCoverage" class="mb-2 border-b border-line-divider pb-2 text-[12.5px] text-ink-muted2">
        {{ t('Covered by', 'Cubierta por') }}
        <span class="font-medium text-ink-700">{{ packageCoverage.packageName || t('a bono', 'un bono') }}</span>
        — {{ t('charged at the bono rate against money already paid.', 'cargada a la tarifa del bono contra dinero ya pagado.') }}
      </p>
      <div class="flex items-center justify-between">
        <NuxtLink :to="`/billing/${invoice.id}`" class="font-medium text-brand-text hover:text-brand-hover">{{ invoice.invoice_number }}</NuxtLink>
        <div class="flex items-center gap-2">
          <span
            class="rounded-ctlSm px-1.5 py-0.5 text-xs font-medium"
            :class="invoice.status === 'paid' ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'"
          >
            {{ invoice.status }}
          </span>
          <span v-if="sendResult" class="text-xs text-ink-faint">{{ sendResult }}</span>
          <button
            v-else-if="can('billing_access')"
            type="button"
            class="text-xs font-medium text-brand-text hover:text-brand-hover disabled:opacity-50"
            :disabled="sendingInvoice"
            @click="sendInvoiceEmail"
          >
            {{ sendingInvoice ? t('Sending…', 'Enviando…') : t('Send receipt', 'Enviar recibo') }}
          </button>
        </div>
      </div>
      <ul class="mt-2 space-y-1">
        <li v-for="line in lineItems" :key="line.id" class="flex items-center justify-between text-ink-700">
          <span>{{ line.description }} &times;{{ line.quantity }}</span>
          <span class="flex items-center gap-2">
            €{{ ((line.price_cents * line.quantity) / 100).toFixed(2) }}
            <button
              v-if="can('billing_access') && invoice.status !== 'paid'"
              type="button"
              class="text-ink-faint hover:text-danger-text"
              @click="removeLineItem(line)"
            >
              ✕
            </button>
          </span>
        </li>
      </ul>

      <select
        v-if="can('billing_access') && invoice.status !== 'paid'"
        v-model="addServiceId"
        class="mt-2 w-full rounded-ctl border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-700 focus:border-brand focus:outline-none"
        @change="addLineItem"
      >
        <option value="" disabled>{{ t('-- Add Service/Product --', '-- Añadir servicio/producto --') }}</option>
        <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }} (€{{ (s.price_cents / 100).toFixed(2) }})</option>
      </select>

      <div class="mt-2 space-y-0.5 border-t border-line-divider pt-2 text-right">
        <p class="text-ink-muted2">{{ t('Total:', 'Total:') }} €{{ (invoice.total_cents / 100).toFixed(2) }}</p>
        <p class="text-ink-muted2">{{ t('Paid:', 'Pagado:') }} €{{ (paidCents / 100).toFixed(2) }}</p>
        <p class="font-semibold text-ink-900">{{ t('Balance due:', 'Saldo pendiente:') }} €{{ (balanceDueCents / 100).toFixed(2) }}</p>
      </div>

      <form
        v-if="can('payments_allocate') && invoice.status !== 'void' && balanceDueCents > 0"
        class="mt-3 space-y-2 border-t border-line-divider pt-3"
        @submit.prevent="recordPayment"
      >
        <div v-for="(row, i) in paymentRows" :key="i" class="flex items-end gap-2">
          <div>
            <label class="block text-xs font-medium text-ink-700">{{ t('Amount (€)', 'Importe (€)') }}</label>
            <input v-model="row.amount" type="number" step="0.01" min="0" class="mt-1 w-24 rounded-ctl border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-700 focus:border-brand focus:outline-none" />
          </div>
          <div>
            <label class="block text-xs font-medium text-ink-700">{{ t('Method', 'Método') }}</label>
            <select v-model="row.method" class="mt-1 rounded-ctl border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-700 focus:border-brand focus:outline-none">
              <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
              <option v-if="creditLedgerCents > 0" value="credit">{{ t('Credit on account', 'Crédito en cuenta') }} (€{{ (creditLedgerCents / 100).toFixed(2) }} {{ t('available', 'disponible') }})</option>
            </select>
          </div>
          <button v-if="paymentRows.length > 1" type="button" class="mb-2 text-xs text-ink-faint hover:text-danger-text" @click="removePaymentRow(i)">
            {{ t('Remove', 'Quitar') }}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="text-xs font-medium text-ink-muted hover:text-brand-text" @click="addPaymentRow">
            + {{ t('Split into another method', 'Dividir en otro método') }}
          </button>
          <span v-if="paymentRows.length > 1" class="text-xs text-ink-faint">{{ t('Total:', 'Total:') }} €{{ (paymentTotalCents / 100).toFixed(2) }}</span>
          <button type="submit" :disabled="savingPayment || paymentTotalCents <= 0" class="rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50">
            {{ savingPayment ? t('Processing…', 'Procesando…') : t('Process', 'Procesar') }}
          </button>
        </div>
      </form>
      <div
        v-if="can('billing_access') && invoice.status !== 'paid' && activePackages.length > 0"
        class="mt-2 flex flex-wrap items-center gap-2 border-t border-line-divider pt-2"
      >
        <span class="text-xs text-ink-muted2">{{ t('Or use a package session:', 'O usar una sesión de bono:') }}</span>
        <button
          v-for="p in activePackages"
          :key="p.id"
          type="button"
          class="rounded-ctl border border-brand-tintBorder bg-brand-tint px-2 py-1 text-xs font-medium text-brand-text hover:brightness-95"
          @click="usePackageSession(p)"
        >
          {{ p.package_name }} ({{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }})
          <span v-if="p.shared" class="ml-1 rounded-ctlSm bg-info-bg px-1 py-0.5 text-[10px] font-semibold text-info-text">
            {{ p.ownerName ? t(`Shared by ${p.ownerName}`, `Compartido por ${p.ownerName}`) : t('Shared', 'Compartido') }}
          </span>
        </button>
      </div>
      <ul v-if="payments.length > 0" class="mt-2 space-y-0.5 text-xs text-ink-muted2">
        <li v-for="p in payments" :key="p.id">{{ new Date(p.paid_at).toLocaleDateString() }} &middot; {{ p.method }} &middot; €{{ (p.amount_cents / 100).toFixed(2) }}</li>
      </ul>

    </div>
    <p v-if="error" class="text-danger-text">{{ error }}</p>
  </div>
</template>
