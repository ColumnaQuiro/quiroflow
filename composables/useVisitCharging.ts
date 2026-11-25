import { invoiceDueCents, settleInvoiceIfCovered } from '../utils/settleInvoice'
import { chargeBonoVisit } from '../utils/bonoVisitInvoice'
import { bonoPerSessionCents, creditExceedsSpendable, isVisitUpcoming, lineItemsTotalCents, linePriceChangeable, newVisitReceiptStatus, openingPaymentRows, receiptStatusAfterLinesChange, visitLineMissing, visitReceiptEditable } from '../utils/visitCharging'
import { completeVisit } from '../utils/completeVisit'
import { ledgerDrawCents } from '../utils/owing'
import { recordBonoSale, type SoldBono } from '../utils/bonoSale'

// Charging one visit: raising its invoice, adding and removing lines, drawing
// it from a bono, and taking payment for it -- with the factura, the credit
// ledger entry, settling the invoice, completing the visit and the
// automations that hang off each.
//
// ONE implementation for both front ends. The calendar's Billing tab on the
// web (components/calendar/AppointmentBillingTab.vue) and the visit screen in
// the staff app (mobile/pages/calendar/[id].vue) each used to carry their own
// copy, and the app's had drifted a long way: it raised an invoice the moment
// billing was opened, numbered it from a head count of every invoice it could
// see, wrote facturas with no tax breakdown, settled from totals loaded when
// the screen opened, and let a second tap take a second bono session. Every
// fix the web picked up -- each one written up below, at the line it governs
// -- had to be made twice and usually was not.
//
// Store-free on purpose. The app has no Pinia (mobile/nuxt.config.ts), so
// useAccountStore does not exist there: who is charging -- the account, the
// team member, what their role allows -- comes in as arguments. And value
// imports are relative, because inside the app `~` is mobile/.
export interface VisitChargingContext {
  appointmentId: MaybeRefOrGetter<string>
  patientId: MaybeRefOrGetter<string>
  /** What the visit's own line says, and what its factura describes. */
  appointmentTypeName: MaybeRefOrGetter<string | null | undefined>
  /** The visit's price: the practitioner's own price for the type when they have one. */
  appointmentTypePriceCents: MaybeRefOrGetter<number | null | undefined>
  accountId: MaybeRefOrGetter<string | null | undefined>
  /** Recorded as created_by on a credit spend. */
  teamMemberId: MaybeRefOrGetter<string | null | undefined>
  /** usePermission().can's semantics: an owner can do everything. */
  can: (permission: string) => boolean
  /** The visit was just completed (paid in full, or drawn from a bono). */
  onCompleted?: () => void
}

export interface VisitInvoice { id: string; invoice_number: string; status: string; total_cents: number }
export interface VisitLineItem {
  id: string
  description: string
  quantity: number
  price_cents: number
  service_id: string | null
  package_purchase_id?: string | null
  /** The price before a special price was set; null when it never was. */
  list_price_cents?: number | null
  price_change_reason?: string | null
}
// What the panel reads of a line. One string, so the three reads and inserts
// cannot come back with different shapes.
const LINE_COLUMNS = 'id, description, quantity, price_cents, service_id, package_purchase_id, list_price_cents, price_change_reason'
export interface VisitPaymentRow { id: string; amount_cents: number; method: string; paid_at: string }
export interface VisitServiceOption { id: string; name: string; price_cents: number }
export interface VisitBonoTemplate { id: string; name: string; session_count: number; price_cents: number; installment_options: unknown }
export interface VisitBonoSale {
  packageId: string
  /** 1 is at once; N one of the bono's split options. */
  installments: number
  /** Paid now; the rest stays owed on the bono. */
  amountCents: number
  /** A special price for this sale, at once only (utils/bonoSale). Null: the bono's own. */
  priceCents?: number | null
  method: string
}
export interface VisitBonoOption { id: string; package_name: string; sessions_used: number; sessions_total: number; price_cents: number }

export function useVisitCharging(ctx: VisitChargingContext) {
  const supabase = useSupabaseClient()
  const { fire } = useAutomations()
  const { issueFactura } = useFacturas()
  const t = useT()

  const appointmentId = () => toValue(ctx.appointmentId)
  const patientId = () => toValue(ctx.patientId)
  const accountId = () => toValue(ctx.accountId)!

  const summary = usePatientFinancialSummary(patientId)
  const { balanceCents, creditLedgerCents, spendableCreditCents, refresh: refreshSummary } = summary

  const invoice = ref<VisitInvoice | null>(null)
  const lineItems = ref<VisitLineItem[]>([])
  const payments = ref<VisitPaymentRow[]>([])
  const services = ref<VisitServiceOption[]>([])
  const addServiceId = ref('')
  const loadingInvoice = ref(true)
  // Whether THIS appointment itself hasn't happened yet. Opening billing must
  // not invoice a visit that hasn't occurred: a patient owes nothing for a
  // future booking until it actually happens or someone deliberately bills
  // them (e.g. the patient's own Billing tab).
  const appointmentIsUpcoming = ref(true)

  // 'credit' triggers a compound operation: a payments row (method: 'credit')
  // plus a negative account_credits row -- the same pattern the patient's main
  // Billing tab already uses for "Apply credit" (BillingTab.vue). Rows can
  // split one payment across methods (part cash, part card) -- see
  // useSplitPayment.
  const { methods: paymentMethods, ensureLoaded: ensurePaymentMethodsLoaded, defaultMethod } = usePaymentMethods()
  // Charging a visit opens on card whenever the clinic takes card: that is how
  // most visits are paid at the desk. Not the clinic's first method, which is
  // cash for every clinic as seeded, and Settings has no way to reorder them.
  // A clinic that has switched card off still gets its own first method.
  const visitDefaultMethod = computed(() => (paymentMethods.value.some((m) => m.key === 'card') ? 'card' : defaultMethod.value))
  const {
    rows: paymentRows,
    addRow: addPaymentRow,
    removeRow: removePaymentRow,
    centsOf: paymentRowCents,
    totalCents: paymentTotalCents,
    creditCents: paymentCreditCents,
  } = useSplitPayment('cash', computed(() => paymentMethods.value.map((m) => m.key)))
  const saving = ref(false)
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
   * A visit drawn from a prepaid bono is exactly that shape: chargeBonoVisit()
   * raises the charge and marks it paid because the balance already covers it --
   * the money went in when the bono was bought -- so no payment row is ever
   * created. settle_imported_invoices() left the whole migrated history looking
   * the same way.
   *
   * Reading the balance from payment rows alone therefore showed the full
   * session price as still due and put the take-payment box in front of
   * reception, on a visit the patient had already paid for. Five patients paid
   * twice on 15 Sep that way -- EUR 206 between them -- all of them
   * holding a bono with nothing outstanding.
   *
   * Status is the right thing to trust here: deletePayment recomputes it from
   * what is actually left, so a 'paid' invoice with no payments means covered,
   * never stale.
   */
  const balanceDueCents = computed(() => invoiceDueCents(invoice.value, paidCents.value))

  const visitPriceCents = computed(() => toValue(ctx.appointmentTypePriceCents) ?? 0)

  // A patient who has checked in is being seen, whatever the clock says about
  // the slot. Early arrivals are routine -- in at 10:16 for 10:30, treated, and
  // at the desk by 10:25 -- and going by starts_at alone told reception "no
  // receipt until it happens" and refused to charge a visit that had happened.
  async function loadAppointmentTiming() {
    const { data } = await supabase.from('appointments').select('starts_at, checked_in_at').eq('id', appointmentId()).maybeSingle()
    appointmentIsUpcoming.value = isVisitUpcoming(data)
  }

  // Other receipts on this appointment, beside the one the panel shows. Set
  // when there is more than one, so the panel can say so rather than leave
  // them invisible.
  const otherReceipts = ref<{ id: string; invoice_number: string; status: string; total_cents: number }[]>([])

  // Reads the invoice for this appointment, if someone has raised one. Opening
  // billing is a read -- see ensureInvoice() for why it must never write.
  //
  // One appointment can carry more than one receipt: a visit with extras that
  // is then drawn from a bono keeps the extras on their receipt and charges the
  // session on its own (utils/bonoVisitInvoice), and older data has the odd
  // pair too. This read was .maybeSingle(), which ERRORS on two rows -- the
  // error was dropped, data came back null, and the receipt still open for the
  // extras vanished from the tab. So: every receipt, and the one shown is the
  // one reception may still have to act on -- not void, not a refund, still
  // open before settled, newest first -- with the rest named beside it.
  async function findInvoice(): Promise<VisitInvoice | null> {
    const { data, error: readError } = await supabase
      .from('invoices')
      .select('id, invoice_number, status, total_cents, is_refund, created_at')
      .eq('appointment_id', appointmentId())
      .order('created_at', { ascending: false })
    if (readError) {
      error.value = readError.message
      otherReceipts.value = []
      return null
    }
    const candidates = (data ?? []).filter((i) => i.status !== 'void' && !i.is_refund)
    const chosen = candidates.find((i) => i.status !== 'paid') ?? candidates[0] ?? null
    otherReceipts.value = chosen
      ? candidates
          .filter((i) => i.id !== chosen.id)
          .map((i) => ({ id: i.id, invoice_number: i.invoice_number, status: i.status, total_cents: i.total_cents }))
      : []
    return chosen ? { id: chosen.id, invoice_number: chosen.invoice_number, status: chosen.status, total_cents: chosen.total_cents } : null
  }

  // Set when this visit has already been drawn from a bono. Doubles as the
  // "don't raise an invoice" flag for ensureInvoice() and as what the panel
  // shows in place of invoice lines -- otherwise a covered visit renders an
  // empty billing panel, since there is no invoice left to display.
  const packageCoverage = ref<{ packageName: string; amountCents: number } | null>(null)

  async function loadPackageCoverage() {
    const { data } = await supabase
      .from('package_sessions')
      .select('amount_cents, package_purchases(package_name)')
      .eq('appointment_id', appointmentId())
      .maybeSingle()
    const row = data as unknown as { amount_cents: number; package_purchases: { package_name: string } | null } | null
    packageCoverage.value = row ? { packageName: row.package_purchases?.package_name ?? '', amountCents: row.amount_cents } : null
  }

  // Creates the invoice on demand. Called only from an actual billing action --
  // today that is chargeVisit(), reached by pressing "Charge" on a visit nobody
  // has billed yet -- and never from opening billing.
  //
  // It used to run on open, so merely looking at a past appointment's billing
  // raised an unpaid invoice at the appointment type's list price, before
  // anyone had said how the visit would be paid. Three things then compounded:
  //
  //   - a visit the patient settled with their bono still got an invoice, and
  //     usePackageSession()'s cleanup below only deletes it when nothing was
  //     added and nothing was collected -- so any other case left a phantom
  //     debt standing against the patient;
  //   - the payment row was pre-filled with the full balance, and
  //     useSplitPayment defaults the method to cash, so the panel opened one
  //     click away from recording a full-price cash payment nobody had made.
  //     Ten such payments (EUR 560, nine exactly at list price) were recorded
  //     this way since go-live;
  //   - every visit anyone glanced at consumed an invoice number.
  //
  // The app's visit screen kept doing all of that after the web stopped, and
  // numbered the invoice from a head count of every invoice it could see
  // rather than from next_invoice_number -- a number another receipt could
  // already hold.
  //
  // Nothing is written now until someone chooses how the visit is paid: charge
  // it, or spend a bono session. For an appointment that hasn't happened yet
  // there is nothing to bill at all, so this returns null and the caller no-ops.
  async function ensureInvoice(): Promise<VisitInvoice | null> {
    const existing = await findInvoice()

    if (existing) return existing
    if (!ctx.can('billing_access')) return null
    if (appointmentIsUpcoming.value) return null

    // A visit already drawn from a bono is not a billing event -- the patient
    // paid for it when they bought the bono. The panel hides the Charge button
    // once a session has been spent, so this is the backstop for a screen that
    // was already open when the bono was used somewhere else.
    // loadPackageCoverage() runs first, so this reads an already-fetched value
    // rather than querying again.
    if (packageCoverage.value) return null

    const { data: invoiceNumber, error: numberError } = await supabase.rpc('next_invoice_number', { p_account_id: accountId() })
    if (numberError || !invoiceNumber) {
      error.value = numberError?.message ?? t('Could not allocate a receipt number.', 'No se ha podido asignar un número de recibo.')
      return null
    }
    const priceCents = toValue(ctx.appointmentTypePriceCents) ?? 0
    const description = toValue(ctx.appointmentTypeName) ?? 'Appointment'

    const { data: newInvoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        account_id: accountId(),
        patient_id: patientId(),
        appointment_id: appointmentId(),
        invoice_number: invoiceNumber,
        // A free visit owes nothing: settled on the spot, or it is an unpaid
        // 0 € receipt forever. See newVisitReceiptStatus.
        status: newVisitReceiptStatus(priceCents),
        total_cents: priceCents,
      })
      .select('id, invoice_number, status, total_cents')
      .single()

    if (invoiceError) {
      error.value = invoiceError.message
      return null
    }

    await supabase.from('invoice_line_items').insert({
      account_id: accountId(),
      invoice_id: newInvoice.id,
      description,
      quantity: 1,
      price_cents: priceCents,
    })

    return newInvoice
  }

  // A third party pays (part of) this visit: the patient's line holds their
  // copago, 0 € when the insurer covers it all. See visitLineMissing.
  const chargedToThirdParty = ref(false)

  async function loadInvoice() {
    loadingInvoice.value = true
    error.value = ''

    await loadPackageCoverage()
    const inv = await findInvoice()

    invoice.value = inv
    lineItems.value = []
    payments.value = []
    chargedToThirdParty.value = false
    if (inv) {
      const [{ data: lines }, { data: pays }, { count: tpCharges, error: tpError }] = await Promise.all([
        supabase.from('invoice_line_items').select(LINE_COLUMNS).eq('invoice_id', inv.id),
        supabase.from('payments').select('id, amount_cents, method, paid_at').eq('invoice_id', inv.id).order('paid_at', { ascending: false }),
        supabase.from('third_party_charges').select('id', { count: 'exact', head: true }).eq('invoice_id', inv.id).eq('status', 'pending'),
      ])
      lineItems.value = lines ?? []
      payments.value = pays ?? []
      // A failed read counts as charged: offering the full price on a visit an
      // insurer covers is the mistake to avoid, and the add-the-visit control
      // missing for one load is not.
      chargedToThirdParty.value = !!tpError || (tpCharges ?? 0) > 0
      openPaymentRows()
    }
    loadingInvoice.value = false
  }

  // The form as it opens on what is due: credit first when the patient has
  // some (utils/visitCharging openingPaymentRows). Remembered, so the credit
  // figure arriving after the invoice -- the summary loads on its own -- can
  // redo it, but only while nobody has touched the form.
  let openedRowsKey = ''
  function openPaymentRows() {
    paymentRows.value = openingPaymentRows(balanceDueCents.value, spendableCreditCents.value, visitDefaultMethod.value).map((r) => ({
      method: r.method,
      amount: (r.cents / 100).toFixed(2),
    }))
    openedRowsKey = JSON.stringify(paymentRows.value)
  }
  watch(spendableCreditCents, () => {
    if (openedRowsKey && JSON.stringify(paymentRows.value) === openedRowsKey) openPaymentRows()
  })

  // Everything the billing panel needs before it can render. A read: nothing
  // here writes, whatever state the visit is in.
  async function init() {
    await ensurePaymentMethodsLoaded()
    for (const row of paymentRows.value) if (row.method !== 'credit') row.method = visitDefaultMethod.value
    const { data: svc } = await supabase.from('services_products').select('id, name, price_cents').order('name')
    services.value = svc ?? []
    await loadAppointmentTiming()
    await loadInvoice()
  }

  async function recalcInvoiceTotal() {
    if (!invoice.value) return
    const totalCents = lineItemsTotalCents(lineItems.value)
    // A free visit's receipt is raised paid; a product sold on it makes it
    // owed again (receiptStatusAfterLinesChange).
    const status = receiptStatusAfterLinesChange({
      status: invoice.value.status,
      totalCents,
      paidCents: paidCents.value,
      coveredByBono: !!packageCoverage.value,
    })
    await supabase.from('invoices').update({ total_cents: totalCents, status }).eq('id', invoice.value.id)
    invoice.value.total_cents = totalCents
    invoice.value.status = status
    openPaymentRows()
  }

  // Whether lines can still be added to or taken off the receipt -- see
  // visitReceiptEditable for the free-visit exception to "paid is closed".
  const receiptEditable = computed(() =>
    visitReceiptEditable({
      status: invoice.value?.status,
      totalCents: invoice.value?.total_cents ?? 0,
      paidCents: paidCents.value,
      coveredByBono: !!packageCoverage.value,
    }),
  )

  // "Charge" on an unbilled visit: raise the invoice at the appointment type's
  // price, which is exactly what opening billing used to do by itself. The
  // difference is that a person now says so.
  //
  // On a receipt that exists but is missing the visit (visitMissing below), it
  // puts the visit on at today's price instead -- the receipt raised while the
  // type still cost 0 €, which no other control could repair.
  async function chargeVisit() {
    if (saving.value) return
    if (invoice.value) {
      if (visitMissing.value) await addVisitLine()
      return
    }
    saving.value = true
    error.value = ''
    const inv = await ensureInvoice()
    saving.value = false
    if (!inv) return
    // A free visit was settled as it was raised, which is exactly what a
    // payment covering it would have done -- so it completes the visit the
    // same way (recordPayment, afterThirdPartyChange).
    if (inv.status === 'paid') {
      const { completedNow } = await completeVisit(supabase, appointmentId())
      ctx.onCompleted?.()
      if (completedNow) fire('appointment.completed', { patientId: patientId(), appointmentId: appointmentId() })
      await refreshSummary()
    }
    await loadInvoice()
  }

  // The open receipt has no priced line for the visit itself: see
  // utils/visitCharging visitLineMissing for how one ends up that way.
  const visitMissing = computed(() =>
    visitLineMissing({
      invoiceStatus: invoice.value?.status,
      coveredByBono: !!packageCoverage.value,
      chargedToThirdParty: chargedToThirdParty.value,
      visitPriceCents: visitPriceCents.value,
      lines: lineItems.value,
    }),
  )

  // Puts the visit on its receipt at the type's current price, replacing a
  // visit line left at 0 € by a price set after the receipt was raised.
  async function addVisitLine() {
    if (!invoice.value || !visitMissing.value || saving.value || !ctx.can('billing_access')) return
    saving.value = true
    error.value = ''
    const invoiceId = invoice.value.id
    const stale = lineItems.value.filter((l) => l.service_id == null && l.price_cents === 0)
    if (stale.length > 0) {
      const { error: deleteError } = await supabase.from('invoice_line_items').delete().in('id', stale.map((l) => l.id))
      if (deleteError) {
        error.value = deleteError.message
        saving.value = false
        return
      }
      lineItems.value = lineItems.value.filter((l) => !stale.includes(l))
    }
    const { data, error: insertError } = await supabase
      .from('invoice_line_items')
      .insert({
        account_id: accountId(),
        invoice_id: invoiceId,
        description: toValue(ctx.appointmentTypeName) ?? 'Appointment',
        quantity: 1,
        price_cents: visitPriceCents.value,
      })
      .select(LINE_COLUMNS)
      .single()
    if (insertError || !data) {
      error.value = insertError?.message ?? t('Could not add the visit.', 'No se ha podido añadir la visita.')
      saving.value = false
      return
    }
    lineItems.value.push(data)
    await recalcInvoiceTotal()
    saving.value = false
  }

  async function addLineItem() {
    if (!invoice.value || !addServiceId.value) return
    const svc = services.value.find((s) => s.id === addServiceId.value)
    if (!svc) return

    const { data } = await supabase
      .from('invoice_line_items')
      .insert({
        account_id: accountId(),
        invoice_id: invoice.value.id,
        service_id: svc.id,
        description: svc.name,
        quantity: 1,
        price_cents: svc.price_cents,
      })
      .select(LINE_COLUMNS)
      .single()

    if (data) lineItems.value.push(data)
    addServiceId.value = ''
    await recalcInvoiceTotal()
  }

  async function removeLineItem(item: VisitLineItem) {
    await supabase.from('invoice_line_items').delete().eq('id', item.id)
    lineItems.value = lineItems.value.filter((l) => l.id !== item.id)
    await recalcInvoiceTotal()
  }

  // Whether this line can be given a special price (seniors, students...)
  // before it is charged -- utils/visitCharging linePriceChangeable. Closed
  // the moment anything has been paid on the receipt.
  function canChangeLinePrice(line: VisitLineItem): boolean {
    if (!ctx.can('billing_access') || !invoice.value) return false
    return linePriceChangeable({
      invoiceStatus: invoice.value.status,
      totalCents: invoice.value.total_cents,
      paymentCount: payments.value.length,
      coveredByBono: !!packageCoverage.value,
      chargedToThirdParty: chargedToThirdParty.value,
      line,
    })
  }

  // A special price on the visit's line, with the reason it is kept under.
  // One call, change_invoice_line_price, which re-checks under a lock that
  // nothing has been paid on the receipt -- a payment, and with it a factura,
  // may have been taken from another screen since this one loaded -- and
  // recomputes the total. Setting the line's original price back is how the
  // special price is undone. Returns whether it was saved.
  async function changeLinePrice(line: VisitLineItem, priceCents: number, reason: string | null): Promise<boolean> {
    if (saving.value || !canChangeLinePrice(line)) return false
    saving.value = true
    error.value = ''
    const { error: rpcError } = await supabase.rpc('change_invoice_line_price', {
      p_line_id: line.id,
      p_price_cents: priceCents,
      p_reason: reason ?? undefined,
    })
    saving.value = false
    if (rpcError) {
      await loadInvoice()
      // After the reload, which clears the panel's error.
      error.value =
        rpcError.code === '42501'
          ? t('Your role cannot change prices on receipts.', 'Tu rol no permite cambiar precios en los recibos.')
          : rpcError.code === '23514'
            ? t(
                'This price can no longer be changed: the receipt has payments or is closed.',
                'Este precio ya no se puede cambiar: el recibo tiene pagos o está cerrado.',
              )
            : rpcError.message
      return false
    }
    // A visit made free is settled as it is repriced, and completes the way a
    // free visit charged from scratch does -- which is exactly what
    // afterThirdPartyChange does for a visit an insurer covers in full.
    await afterThirdPartyChange()
    return true
  }

  async function usePackageSession(pkg: VisitBonoOption) {
    // No invoice required: a bono visit is normally billed straight from the
    // unbilled panel, with nothing raised against it at all. (The app's copy
    // required one, which only worked because it raised one on open.)
    if (pkg.sessions_used >= pkg.sessions_total) return
    // This visit is already settled -- e.g. billed from the other front end
    // while this screen was still open. Spending a session here too would burn
    // a real session for a visit that isn't taking one: the invoice is already
    // paid, so there is nothing left to charge, and the session would vanish
    // with no payment, no credit, and (before this check) no package_sessions
    // row behind it either. One patient's newly-bought "maintenance" bono
    // lost a session this way when it, not the bono actually being visited,
    // was tapped on an appointment already paid from the web tab.
    if (invoice.value?.status === 'paid') {
      error.value = t('This visit has already been billed.', 'Esta visita ya ha sido facturada.')
      return
    }
    saving.value = true

    // Has this visit already taken a session? The compare-and-set below does
    // not answer that: it defends against a SHARED bono being drawn on from two
    // patients' screens at once, where the second write must lose. A second
    // click on the same screen is not that -- it reads the count the first one
    // left behind, claims the next session legitimately, and takes a second
    // session for a visit that only happened once. One patient's bono lost
    // 44 EUR that way, two clicks 18 seconds apart.
    //
    // Read from the database, not from anything this screen is holding: the
    // first click's own write is what has to be seen.
    const { data: existingSession } = await supabase
      .from('package_sessions')
      .select('id, package_purchase_id, package_purchases(package_name)')
      .eq('appointment_id', appointmentId())
      .maybeSingle()
    if (existingSession) {
      const takenFrom = (existingSession as unknown as { package_purchases: { package_name: string } | null }).package_purchases?.package_name
      error.value = takenFrom
        ? t(`This visit is already covered by ${takenFrom}.`, `Esta visita ya está cubierta por ${takenFrom}.`)
        : t('This visit has already taken a session from a bono.', 'Esta visita ya ha usado una sesión de un bono.')
      saving.value = false
      await refreshSummary()
      return
    }

    // Re-read the bono rather than trusting the copy this screen loaded.
    // `activePackages` includes bonos SHARED from another patient (a family
    // bono), and a shared bono is being drawn on from several patients' screens
    // at once, so the copy in hand goes stale the moment a relative uses a
    // session. One family's Bono Familiar was drawn on twice within ten
    // seconds -- once by its owner, once by a relative -- and both writes computed
    // 0 + 1, so the bono recorded one session while paying for two.
    const { data: bono } = await supabase
      .from('package_purchases')
      .select('id, patient_id, package_name, sessions_used, sessions_total, price_cents, is_closed')
      .eq('id', pkg.id)
      .maybeSingle()
    if (!bono || bono.sessions_used >= bono.sessions_total) {
      error.value = t('That bono has no sessions left.', 'Ese bono no tiene sesiones restantes.')
      saving.value = false
      await refreshSummary()
      return
    }
    // A bono PracticeHub has closed is not offered here -- activePackages
    // leaves it out -- but its counter still has sessions on it, so the check
    // above would wave it through if a stale copy of the list ever reached this
    // far.
    if (bono.is_closed) {
      error.value = t('That bono is closed and cannot be used.', 'Ese bono está cerrado y no se puede usar.')
      saving.value = false
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
      saving.value = false
      await refreshSummary()
      return
    }

    // What this visit was worth against the bono -- see bonoPerSessionCents.
    const perSessionCents = bonoPerSessionCents(bono)

    // The visit itself, on the bono's own history. It is no longer the visit's
    // only record: since the PracticeHub re-migration a visit is also CHARGED,
    // at the bono's per-session rate, because that is what draws the
    // prepayment down.
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
    const { data: appt } = await supabase.from('appointments').select('starts_at').eq('id', appointmentId()).maybeSingle()
    await supabase.from('package_sessions').insert({
      account_id: accountId(),
      patient_id: patientId(),
      package_purchase_id: bono.id,
      appointment_id: appointmentId(),
      amount_cents: perSessionCents,
      used_at: appt?.starts_at ?? new Date().toISOString(),
    })

    // The visit's charge, at the bono's per-session rate rather than the
    // appointment type's walk-in price -- that rate is what the patient actually
    // paid per visit when they bought the bono. Marked paid when the (family)
    // balance already covers it, the rule settle_imported_invoices() applied to
    // the imported history.
    //
    // On the receipt this visit already has, when it has one: see
    // utils/bonoVisitInvoice for what is reused, what stays owed, and why a
    // receipt with extras keeps them on their own. This used to reprice that
    // receipt and then insert the session's charge as a second receipt for the
    // same appointment, which made the first one disappear from this tab.
    const { error: chargeError } = await chargeBonoVisit(supabase, {
      accountId: accountId(),
      patientId: patientId(),
      appointmentId: appointmentId(),
      perSessionCents,
      bonoName: bono.package_name,
      bonoPurchaseId: bono.id,
      ownBalanceCents: balanceCents.value,
    })

    // Completing the visit is unchanged -- it happened, whatever paid for it.
    // No 'invoice.paid' event and no auto-send: with the visit covered by the
    // bono there is either no invoice at all, or one still open for the extras.
    // 'appointment.completed' fires only if this is what completed it: the
    // app's "Finish visit" may have done so already (utils/completeVisit).
    const { completedNow } = await completeVisit(supabase, appointmentId())
    ctx.onCompleted?.()
    if (completedNow) fire('appointment.completed', { patientId: patientId(), appointmentId: appointmentId() })

    saving.value = false
    await loadInvoice()
    await refreshSummary()
    // After the reload, which clears the panel's error. The session is taken
    // and the visit recorded; it is the charge that needs looking at.
    if (chargeError) {
      error.value = t(
        `The session was taken, but its charge could not be recorded: ${chargeError}`,
        `La sesión se ha usado, pero no se ha podido registrar su cargo: ${chargeError}`,
      )
    }
  }

  // The clinic's bonos, for selling one at the checkout. Loaded on demand:
  // most visits are paid by a bono the patient already holds, or in money.
  const bonoTemplates = ref<VisitBonoTemplate[]>([])
  async function loadBonoTemplates() {
    const { data } = await supabase.from('packages').select('id, name, session_count, price_cents, installment_options').order('name')
    bonoTemplates.value = (data ?? []) as VisitBonoTemplate[]
  }
  /** Selling a bono needs what the patient record's sale needs, plus taking money. */
  const canSellBono = computed(() => (ctx.can('packages_edit') || ctx.can('billing_config')) && ctx.can('payments_allocate'))

  // utils/bonoSale, with this patient's credit, and the summary read again
  // after. Sets error when nothing was sold.
  async function recordSale(sale: VisitBonoSale) {
    saving.value = true
    const result = await recordBonoSale(
      supabase,
      { issueFactura, t },
      {
        accountId: accountId(),
        patientId: patientId(),
        teamMemberId: toValue(ctx.teamMemberId) ?? null,
        packageId: sale.packageId,
        installments: sale.installments,
        amountCents: sale.amountCents,
        priceCents: sale.priceCents ?? null,
        method: sale.method,
        spendableCreditCents: spendableCreditCents.value,
        creditLedgerCents: creditLedgerCents.value,
      },
    )
    saving.value = false
    await refreshSummary()
    if (!result.purchase) error.value = result.error ?? t('Could not sell the bono.', 'No se ha podido vender el bono.')
    return result
  }

  // The next bono, after this visit has drawn the last session of the one
  // before. The checkout's sale makes the visit the new bono's first session,
  // so it is only offered while the visit is unpaid -- and the visit that
  // finishes a bono is paid by that bono, so the moment the patient decides to
  // buy another was the one moment the appointment could not sell it, and the
  // desk had to go to the record (19 Nov). This sells it and takes nothing:
  // its first session is the next visit's.
  /** Returns the bono sold, or null when nothing was. */
  async function sellNextBono(sale: VisitBonoSale): Promise<SoldBono | null> {
    error.value = ''
    const { purchase, error: saleError } = await recordSale(sale)
    if (!purchase) return null
    if (saleError) {
      const why = /[.!?]$/.test(saleError) ? saleError : `${saleError}.`
      error.value = t(
        `${purchase.package_name} was sold. ${why} Record the payment on the patient's Billing tab.`,
        `${purchase.package_name} se ha vendido. ${why} Registra el pago en la ficha del paciente.`,
      )
    }
    return purchase
  }

  // A patient who has just decided to buy a bono, at the end of the visit
  // that convinced them: the visit is its first session. Reception used to
  // leave the appointment, sell the bono on the patient's record, and come
  // back to draw the session -- three screens for one decision.
  //
  // The sale is utils/bonoSale, the same function the record sells through;
  // the session is usePackageSession, exactly as if the bono had been bought
  // the day before. In that order, and with the patient's balance read again
  // between them: the session's charge is marked paid when the balance covers
  // it, and the balance only covers it once the money just taken is in it.
  /** Returns the bono sold, or null when nothing was. */
  async function sellBonoForVisit(sale: VisitBonoSale): Promise<string | null> {
    error.value = ''
    // Visit taken care of from elsewhere since this screen opened (the other
    // front end, a second tab): selling now would sell a bono for a visit that
    // will not draw on it.
    const { data: existingSession } = await supabase.from('package_sessions').select('id').eq('appointment_id', appointmentId()).maybeSingle()
    if (existingSession || invoice.value?.status === 'paid') {
      error.value = t('This visit has already been billed.', 'Esta visita ya ha sido facturada.')
      await loadInvoice()
      return null
    }
    const { purchase, error: saleError } = await recordSale(sale)
    if (!purchase) return null
    // Sold, but the money was refused. The session is NOT taken: charged now
    // it would sit unpaid against a balance the payment never reached, and
    // the visit would read as settled by a bono nobody has paid for. The bono
    // is on the list now, so taking the session is one press once the money
    // is sorted -- and selling again would sell it twice.
    if (saleError) {
      const why = /[.!?]$/.test(saleError) ? saleError : `${saleError}.`
      error.value = t(
        `${purchase.package_name} was sold. ${why} Record the payment on the patient's Billing tab, then use a session here.`,
        `${purchase.package_name} se ha vendido. ${why} Registra el pago en la ficha del paciente y después usa una sesión aquí.`,
      )
      return purchase.id
    }
    await usePackageSession(purchase)
    return purchase.id
  }

  async function recordPayment() {
    if (!invoice.value) return
    error.value = ''
    const rows = paymentRows.value.filter((r) => paymentRowCents(r) > 0)
    if (rows.length === 0) return
    // Capped by what is spendable, not the balance -- see creditExceedsSpendable.
    if (creditExceedsSpendable(paymentCreditCents.value, spendableCreditCents.value)) {
      error.value = t('Amount exceeds available credit.', 'El importe supera el crédito disponible.')
      return
    }
    saving.value = true

    const { data: insertedPayments, error: insertError } = await supabase
      .from('payments')
      .insert(
        rows.map((r) => ({
          account_id: accountId(),
          patient_id: patientId(),
          invoice_id: invoice.value!.id,
          amount_cents: paymentRowCents(r),
          method: r.method,
          purpose: 'visit' as const,
        })),
      )
      .select('id, amount_cents, method')
    // One insert for every row, so all or nothing -- and nothing means nothing
    // else is written either. The credit rows below restate these payments;
    // written alone they take credit off the patient for money that never
    // reached the receipt. The same rule BillingTab's takePayment follows.
    if (insertError || !insertedPayments?.length) {
      error.value =
        t('The payment could not be recorded', 'No se pudo registrar el pago') + (insertError?.message ? `: ${insertError.message}` : '.')
      saving.value = false
      return
    }

    // A factura for the money that actually came in, through useFacturas so it
    // carries the account's tax breakdown -- the app's copy inserted its own
    // row without one. 'credit' rows are excluded: spending account credit
    // moves no money and was already documented when that credit was paid in,
    // so issuing a second document would count one payment twice in the
    // fiscal series.
    let facturaMissing = false
    for (const p of insertedPayments ?? []) {
      if (p.method === 'credit') continue
      const issued = await issueFactura({
        accountId: accountId(),
        patientId: patientId(),
        paymentId: p.id,
        amountCents: p.amount_cents,
        purpose: 'visit',
        serviceName: toValue(ctx.appointmentTypeName) ?? undefined,
      })
      if (!issued) facturaMissing = true
    }
    const creditRows = rows.filter((r) => r.method === 'credit')
    // Only the part drawn from the ledger gets a row: the rest was paid ahead
    // and has no row to take it off -- see utils/owing ledgerDrawCents.
    const fromLedgerCents = ledgerDrawCents(creditRows.reduce((sum, r) => sum + paymentRowCents(r), 0), creditLedgerCents.value)
    if (fromLedgerCents > 0) {
      await supabase.from('account_credits').insert({
        account_id: accountId(),
        patient_id: patientId(),
        amount_cents: -fromLedgerCents,
        // A spend: in the credit ledger, never in the balance (utils/owing balanceCreditCentsOf).
        is_spend: true,
        reason: `Applied to invoice ${invoice.value!.invoice_number}`,
        invoice_id: invoice.value!.id,
        created_by: toValue(ctx.teamMemberId) ?? null,
      })
    }

    // Decided from the database, not from the totals this screen loaded when it
    // opened -- see utils/settleInvoice.
    if (await settleInvoiceIfCovered(supabase, invoice.value.id)) {
      // Recording full payment implies the visit happened -- mirrors PracticeHub's
      // "Process" button, which finalizes the invoice and completes the visit
      // in one action rather than requiring a separate status change.
      // Paying a visit that was already finished does not complete it again,
      // so 'appointment.completed' is not fired a second time.
      const { completedNow } = await completeVisit(supabase, appointmentId())
      ctx.onCompleted?.()
      fire('invoice.paid', { patientId: patientId(), appointmentId: appointmentId(), invoiceId: invoice.value.id })
      if (completedNow) fire('appointment.completed', { patientId: patientId(), appointmentId: appointmentId() })

      const { data: patient } = await supabase.from('patients').select('invoice_email_enabled, email').eq('id', patientId()).maybeSingle()
      if (patient?.invoice_email_enabled && patient.email) {
        // Best-effort -- a failed auto-send shouldn't block having just
        // completed the visit and taken payment.
        useStaffFetch(`/api/invoices/${invoice.value.id}/send`, { method: 'POST' }).catch(() => {})
      }
    }

    saving.value = false
    await loadInvoice()
    await refreshSummary()
    // After the reload, which clears the panel's error.
    if (facturaMissing) {
      error.value = t(
        'The payment was recorded, but its factura could not be issued. The payment has no factura yet.',
        'El pago se ha registrado, pero no se ha podido emitir su factura. El pago aún no tiene factura.',
      )
    }
  }

  // After the visit was charged to a third party, or taken off one
  // (components/calendar/ThirdPartyVisitCharge.vue). The receipt now holds the
  // patient's share only, and when that is nothing the visit is settled and
  // complete exactly as a payment covering it would leave it -- otherwise it
  // sits as an unpaid receipt for EUR 0.00 and on the unbilled lists.
  async function afterThirdPartyChange() {
    const inv = await findInvoice()
    if (inv && inv.status !== 'paid' && inv.total_cents === 0 && (await settleInvoiceIfCovered(supabase, inv.id))) {
      const { completedNow } = await completeVisit(supabase, appointmentId())
      ctx.onCompleted?.()
      if (completedNow) fire('appointment.completed', { patientId: patientId(), appointmentId: appointmentId() })
    }
    await loadInvoice()
    await refreshSummary()
  }

  return {
    // The patient's money, for the summary above the receipt and the bono buttons.
    ...summary,
    invoice,
    lineItems,
    payments,
    services,
    addServiceId,
    loadingInvoice,
    appointmentIsUpcoming,
    packageCoverage,
    otherReceipts,
    saving,
    error,
    paidCents,
    balanceDueCents,
    visitPriceCents,
    paymentMethods,
    paymentRows,
    addPaymentRow,
    removePaymentRow,
    paymentTotalCents,
    sendingInvoice,
    sendResult,
    sendInvoiceEmail,
    init,
    loadAppointmentTiming,
    loadInvoice,
    chargeVisit,
    receiptEditable,
    visitMissing,
    addVisitLine,
    addLineItem,
    removeLineItem,
    canChangeLinePrice,
    changeLinePrice,
    usePackageSession,
    bonoTemplates,
    loadBonoTemplates,
    canSellBono,
    sellBonoForVisit,
    sellNextBono,
    recordPayment,
    afterThirdPartyChange,
  }
}
