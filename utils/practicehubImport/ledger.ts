import { formatEur } from '~/utils/billing'
import { linkInvoicesToAppointments, type LinkableAppointment, type LinkableInvoice } from '~/utils/importInvoiceLink'
import { practiceHubList, type PracticeHubImportContext, type PracticeHubPlan, type PracticeHubStepPlanner } from '~/utils/practicehubImport/types'
import { pairWithBookedCharges } from '~/utils/stripeMembershipSync'

// The Ledger step, run on the server: PracticeHub's ledger as PracticeHub
// actually keeps it -- one invoice per visit, one payment per payment, and no
// invented link between them. The browser importer
// (components/import/PracticeHubLedgerImporter.vue) does the same from a live
// read; the rules below are its rules, and where a helper is shared the
// component imports it from here.
//
// This replaces the reconstruction the Payments importer does. That one had a
// real constraint behind it -- payments.invoice_id was NOT NULL, so a payment
// could only exist by hanging off an invoice, and PracticeHub exposes no
// allocation between the two -- so it raised one paid invoice PER PAYMENT.
// The result reads as "invoices by payment" against PracticeHub's "invoice per
// visit", and reconciling the two has been the source of every billing
// confusion since the migration: a visit with no same-day payment looked like
// a bono visit, a bono looked like unpaid debt, and 566 patients who had never
// paid were never imported at all. 0170 removed the constraint (payments
// carry their own patient now), so the two sides can be imported as they are.
//
// Allocation: PracticeHub records none, and this invents none. Payments
// arrive unallocated and stay that way -- which is what they are, and on one
// account EUR 32,213.50 of them across 208 patients has no invoice to attach
// to anyway, mostly unused bono value. What DOES get derived is each imported
// invoice's status, by walking a patient's invoices oldest-first against the
// total they have paid; see settle_imported_invoices(). No payment row is
// touched by that, and no balance moves, because a balance is paid minus
// invoiced regardless of what any status says.
//
// Insert-only: nothing here deletes, and nothing entered in QuiroFlow is
// touched. Each invoice and payment is recognised by its PracticeHub id
// ("phinv-" / "phpay-"), so a second run -- or the next slice of this one --
// adds only what is new.

// --- PracticeHub's rows, as the Classic API sends them ---------------------------------

export interface PracticeHubLedgerPatient { id: number; patient_number: string }
export interface PracticeHubLedgerPaymentMethod { id: number; name: string }
export interface PracticeHubLedgerInvoice { id: number; appointment_id: string | null; patient_id: string; total: string; created: string }
export interface PracticeHubLedgerPayment { id: number; amount: string; payment_type_id: string; patient_id: string; note: string | null; created: string }

// --- shared with the browser importer ------------------------------------------------

/** A PracticeHub amount ("45.00") in cents. */
export const practiceHubCents = (value: string | null | undefined) => Math.round(parseFloat(value ?? '0') * 100)

/**
 * The payment method a PracticeHub payment method becomes.
 *
 * payments.method only accepts card | cash | other, and PracticeHub's names
 * are free text ("GoCardless - Direct Debit Payments").
 *
 * A plain substring test, so "GoCardless" reads as card: that is what every
 * import so far has written, and changing it would split one clinic's
 * history across two methods.
 */
export function practiceHubPaymentMethodKey(name: string): 'cash' | 'card' | 'other' {
  const lower = name.toLowerCase()
  return lower.includes('cash') ? 'cash' : lower.includes('card') ? 'card' : 'other'
}

/**
 * The invoice number an imported PracticeHub invoice carries. Its own series,
 * clear of both INV- and the PH- rows the old reconstruction left behind, so
 * the two can sit side by side while the reconciliation is checked.
 */
export const practiceHubInvoiceNumber = (ref: string) => `PHI-${ref.replace('phinv-', '')}`

// --- what to write, worked out without touching the database --------------------------

export interface PracticeHubInvoiceCandidate {
  ref: string
  patientId: string
  appointmentId: string | null
  totalCents: number
  createdAt: string
}
export interface PracticeHubPaymentCandidate {
  ref: string
  patientId: string
  amountCents: number
  method: string
  paidAt: string
}
export interface PracticeHubLedgerOurInvoice { id: string; external_reference: string | null; appointment_id: string | null; patient_id: string; created_at: string }
export interface PracticeHubLedgerOurAppointment { id: string; external_reference: string | null; patient_id: string; starts_at: string; status: string; clinic_id: string | null }

export interface PracticeHubLedgerInput {
  methods: PracticeHubLedgerPaymentMethod[]
  patients: PracticeHubLedgerPatient[]
  invoices: PracticeHubLedgerInvoice[]
  payments: PracticeHubLedgerPayment[]
  ourPatients: { id: string; external_reference: string | null }[]
  ourAppointments: PracticeHubLedgerOurAppointment[]
  /** Every invoice here, imported or not: which visits are already invoiced counts them all. */
  ourInvoices: PracticeHubLedgerOurInvoice[]
  /** External references of the payments already here. */
  havePaymentRefs: Set<string>
  /**
   * Charges the Stripe webhook booked that no PracticeHub payment has claimed
   * yet (payments with a stripe_invoice_id and no external reference). A
   * PracticeHub payment that is one of them adopts it instead of being
   * created a second time (utils/stripeMembershipSync.ts).
   */
  stripeBooked?: StripeBookedCharge[]
  timezoneOfClinic: (clinicId: string | null) => string | null | undefined
}

export interface StripeBookedCharge { id: string; patient_id: string; amount_cents: number; paid_at: string; method: string }

export interface PracticeHubLedgerRows {
  invoices: PracticeHubInvoiceCandidate[]
  /** Invoices an earlier run imported without a visit, that can be linked now. Only appointment_id is written to them. */
  invoicesToLink: { id: string; ref: string; appointmentId: string }[]
  payments: PracticeHubPaymentCandidate[]
  /**
   * PracticeHub payments that are a Stripe charge already booked here: the
   * booked payment takes the PracticeHub reference (so later runs see it as
   * imported) and nothing new is written.
   */
  paymentsToAdopt: { paymentId: string; ref: string }[]
  skipped: { invoicesAlready: number; paymentsAlready: number; invoicesUnmatched: number; paymentsUnmatched: number }
  phTotals: { invoicedCents: number; paidCents: number }
}

export function practiceHubLedgerRows(input: PracticeHubLedgerInput): PracticeHubLedgerRows {
  const skipped = { invoicesAlready: 0, paymentsAlready: 0, invoicesUnmatched: 0, paymentsUnmatched: 0 }
  const methodById = new Map(input.methods.map((m) => [String(m.id), practiceHubPaymentMethodKey(m.name)] as const))

  // PracticeHub's own id is not what we store: every importer keys on
  // patient_number, the "Patient Number" the CSV exports.
  const numberByPhId = new Map(input.patients.map((p) => [String(p.id), p.patient_number]))
  const patientByRef = new Map(input.ourPatients.filter((p) => p.external_reference).map((p) => [p.external_reference as string, p.id]))
  const patientOf = (phPatientId: string) => patientByRef.get(numberByPhId.get(String(phPatientId)) ?? '')

  const haveInvoiceRefs = new Set(input.ourInvoices.map((i) => i.external_reference).filter(Boolean) as string[])

  const phTotals = {
    invoicedCents: input.invoices.reduce((sum, i) => sum + practiceHubCents(i.total), 0),
    paidCents: input.payments.reduce((sum, p) => sum + practiceHubCents(p.amount), 0),
  }

  const invoices: PracticeHubInvoiceCandidate[] = []
  for (const inv of input.invoices) {
    const ref = `phinv-${inv.id}`
    if (haveInvoiceRefs.has(ref)) {
      skipped.invoicesAlready++
      continue
    }
    const patientId = patientOf(inv.patient_id)
    if (!patientId) {
      skipped.invoicesUnmatched++
      continue
    }
    invoices.push({ ref, patientId, appointmentId: null, totalCents: practiceHubCents(inv.total), createdAt: inv.created })
  }

  // Which visit each invoice belongs to: PracticeHub's own link, else the
  // patient's one chargeable visit that day -- see utils/importInvoiceLink.
  // Invoices imported by an earlier run without a visit go through the same
  // rule, so a visit imported since, or one the date now identifies, is
  // linked on this run rather than never.
  const phAppointmentByRef = new Map(input.invoices.map((inv) => [`phinv-${inv.id}`, inv.appointment_id ? String(inv.appointment_id) : null]))
  const unlinkedImported = input.ourInvoices.filter((i) => i.external_reference?.startsWith('phinv-') && !i.appointment_id)
  const linkable: LinkableInvoice[] = [
    ...invoices.map((c) => ({ ref: c.ref, patientId: c.patientId, phAppointmentId: phAppointmentByRef.get(c.ref) ?? null, createdAt: c.createdAt })),
    ...unlinkedImported.map((i) => ({
      ref: i.external_reference!,
      patientId: i.patient_id,
      phAppointmentId: phAppointmentByRef.get(i.external_reference!) ?? null,
      createdAt: i.created_at,
    })),
  ]
  const appointments: LinkableAppointment[] = input.ourAppointments.map((a) => ({
    id: a.id,
    patientId: a.patient_id,
    externalReference: a.external_reference,
    startsAt: a.starts_at,
    status: a.status,
    clinicId: a.clinic_id,
  }))
  const invoiced = new Set(input.ourInvoices.map((i) => i.appointment_id).filter((id): id is string => !!id))
  const links = linkInvoicesToAppointments(linkable, appointments, invoiced, input.timezoneOfClinic)
  for (const c of invoices) c.appointmentId = links.get(c.ref) ?? null
  const invoicesToLink = unlinkedImported
    .filter((i) => links.has(i.external_reference!))
    .map((i) => ({ id: i.id, ref: i.external_reference!, appointmentId: links.get(i.external_reference!)! }))

  const payments: PracticeHubPaymentCandidate[] = []
  for (const pay of input.payments) {
    const ref = `phpay-${pay.id}`
    if (input.havePaymentRefs.has(ref)) {
      skipped.paymentsAlready++
      continue
    }
    const patientId = patientOf(pay.patient_id)
    if (!patientId) {
      skipped.paymentsUnmatched++
      continue
    }
    // The note is read but not written, as the browser importer never wrote
    // it either: payments has no column for it.
    payments.push({ ref, patientId, amountCents: practiceHubCents(pay.amount), method: methodById.get(pay.payment_type_id) ?? 'other', paidAt: pay.created })
  }

  const { adopt, rest } = adoptBookedStripeCharges(payments, input.stripeBooked ?? [])
  return { invoices, invoicesToLink, payments: rest, paymentsToAdopt: adopt, skipped, phTotals }
}

/**
 * Splits PracticeHub payment candidates into those that are a Stripe charge
 * the webhook already booked -- the same patient, amount and days, not cash
 * -- and the rest. Shared with the browser importer.
 */
export function adoptBookedStripeCharges<T extends PracticeHubPaymentCandidate>(candidates: T[], booked: StripeBookedCharge[]): { adopt: { paymentId: string; ref: string }[]; rest: T[] } {
  const cashless = candidates.filter((c) => c.method !== 'cash')
  const { adopt } = pairWithBookedCharges(
    cashless,
    booked.map((b) => ({ id: b.id, patientId: b.patient_id, amountCents: b.amount_cents, paidAt: b.paid_at })),
  )
  const adopted = new Set(adopt.map((a) => a.incoming))
  return {
    adopt: adopt.map((a) => ({ paymentId: a.bookedId, ref: a.incoming.ref })),
    rest: candidates.filter((c) => !adopted.has(c)),
  }
}

// --- the step ------------------------------------------------------------------------

const CHUNK = 200
// ~0.6 ms an invoice measured in production, so a batch is ~1-2 s, well
// inside the 8 s statement timeout however large the clinic.
export const SETTLE_BATCH = 2000
/** Only a guard against looping forever: a call changing fewer than SETTLE_BATCH means it is done. */
const SETTLE_MAX_CALLS = 200

async function withConcurrency<T>(items: T[], n: number, run: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: n }, async () => { for (let x; (x = queue.shift()) !== undefined;) await run(x) }))
}

/**
 * Every row of one of the account's tables. Scoped to the account by hand --
 * this runs with the service role, so RLS is not there to do it -- and paged,
 * because PostgREST stops at 1,000 rows per request without saying so. The
 * first page says how many there are, and the rest are asked for several at a
 * time.
 */
async function readAll<T>(ctx: PracticeHubImportContext, table: string, columns: string, refPrefix?: string): Promise<T[]> {
  const PAGE = 1000
  const page = async (from: number, count: boolean) => {
    let q = (ctx.supabase.from(table as never) as any).select(columns, count ? { count: 'exact' } : undefined).eq('account_id', ctx.accountId)
    if (refPrefix) q = q.like('external_reference', `${refPrefix}%`)
    const { data, error, count: total } = await q.order('id').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    return { rows: (data ?? []) as T[], total: total as number | null | undefined }
  }
  const first = await page(0, true)
  if (first.rows.length < PAGE) return first.rows
  const pages: T[][] = [first.rows]
  if (first.total == null) {
    for (let from = PAGE; ; from += PAGE) { const next = await page(from, false); pages.push(next.rows); if (next.rows.length < PAGE) break }
    return pages.flat()
  }
  const starts: number[] = []
  for (let from = PAGE; from < first.total; from += PAGE) starts.push(from)
  await withConcurrency(starts, 6, async (from) => { pages[from / PAGE] = (await page(from, false)).rows })
  return pages.flat()
}

/** Charges the Stripe sync booked that no PracticeHub payment has claimed yet. */
async function readStripeBooked(ctx: PracticeHubImportContext): Promise<StripeBookedCharge[]> {
  const PAGE = 1000
  const out: StripeBookedCharge[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (ctx.supabase.from('payments' as never) as any)
      .select('id, patient_id, amount_cents, paid_at, method')
      .eq('account_id', ctx.accountId)
      .not('stripe_invoice_id', 'is', null)
      .is('external_reference', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`payments: ${error.message}`)
    out.push(...((data ?? []) as StripeBookedCharge[]))
    if ((data ?? []).length < PAGE) return out
  }
}

export const planLedger: PracticeHubStepPlanner = async (ctx, snapshot): Promise<PracticeHubPlan> => {
  const { supabase, accountId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')
  const money = (cents: number) => formatEur(cents)

  const methods = practiceHubList<PracticeHubLedgerPaymentMethod>(snapshot, '/payment_methods')
  const phPatients = practiceHubList<PracticeHubLedgerPatient>(snapshot, '/patients')
  const phInvoices = practiceHubList<PracticeHubLedgerInvoice>(snapshot, '/invoices')
  const phPayments = practiceHubList<PracticeHubLedgerPayment>(snapshot, '/payments')

  const [ourPatients, ourAppointments, clinics, ourInvoices, ourPayments] = await Promise.all([
    readAll<{ id: string; external_reference: string | null }>(ctx, 'patients', 'id, external_reference'),
    // Every appointment, not only imported ones: a visit entered in QuiroFlow
    // is one an invoice can be linked to by its date.
    readAll<PracticeHubLedgerOurAppointment>(ctx, 'appointments', 'id, external_reference, patient_id, starts_at, status, clinic_id'),
    readAll<{ id: string; timezone: string | null }>(ctx, 'clinics', 'id, timezone'),
    // Every invoice, not only imported ones: a visit invoiced in QuiroFlow is
    // not free to take a PracticeHub invoice by date.
    readAll<PracticeHubLedgerOurInvoice>(ctx, 'invoices', 'id, external_reference, appointment_id, patient_id, created_at'),
    readAll<{ external_reference: string | null }>(ctx, 'payments', 'external_reference', 'phpay-'),
  ])
  const stripeBooked = await readStripeBooked(ctx)
  const timezoneByClinic = new Map(clinics.map((c) => [c.id, c.timezone]))

  const { invoices, invoicesToLink, payments, paymentsToAdopt, skipped, phTotals } = practiceHubLedgerRows({
    methods,
    patients: phPatients,
    invoices: phInvoices,
    payments: phPayments,
    ourPatients,
    ourAppointments,
    ourInvoices,
    havePaymentRefs: new Set(ourPayments.map((p) => p.external_reference).filter(Boolean) as string[]),
    stripeBooked,
    timezoneOfClinic: (clinicId) => (clinicId ? timezoneByClinic.get(clinicId) : null),
  })

  // Settlement runs whenever there is an imported invoice whose status it
  // may have to set -- one already here or one about to be -- and not only
  // when this run writes something. It is the LAST unit of work, so a slice
  // that stops anywhere before it, or between two of its batches, leaves a
  // plan that includes it again next slice; and it is safe to repeat,
  // because it recomputes every status from the payments each call and only
  // writes the invoices whose status still differs (see
  // 20261106120000_settle_imported_invoices_in_batches.sql). A run with
  // nothing new to write therefore still settles, which is what puts right a
  // slice that wrote payments and was cut off before settling them.
  const settle = invoices.length > 0 || ourInvoices.some((i) => i.external_reference?.startsWith('phinv-'))

  const invoicedCents = invoices.reduce((sum, i) => sum + i.totalCents, 0)
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0)
  const patientsAffected = new Set([...invoices.map((i) => i.patientId), ...payments.map((p) => p.patientId)]).size
  const date = (at: string) => at.slice(0, 10)
  const methodName = (method: string) =>
    method === 'cash' ? t('Cash', 'Efectivo') : method === 'card' ? t('Card', 'Tarjeta') : t('Other', 'Otro')

  return {
    stats: [
      { label: t('Invoices to create', 'Facturas a crear'), value: nf.format(invoices.length), tone: 'good' },
      { label: t('Invoiced', 'Facturado'), value: money(invoicedCents) },
      { label: t('Payments to create', 'Pagos a crear'), value: nf.format(payments.length), tone: 'good' },
      { label: t('Paid', 'Pagado'), value: money(paidCents) },
      { label: t('Patients affected', 'Pacientes afectados'), value: nf.format(patientsAffected) },
      { label: t('Invoices to link to their visit', 'Facturas a vincular a su visita'), value: nf.format(invoicesToLink.length) },
    ],
    columns: [
      { key: 'when', label: t('Date', 'Fecha') },
      { key: 'what', label: t('What', 'Qué') },
      { key: 'visit', label: t('Visit', 'Visita') },
      { key: 'amount', label: t('Amount', 'Importe') },
    ],
    rows: [
      ...invoices.map((c) => ({
        when: date(c.createdAt),
        what: `${t('Invoice', 'Factura')} ${practiceHubInvoiceNumber(c.ref)}`,
        visit: c.appointmentId ? t('Linked', 'Vinculada') : t('No visit', 'Sin visita'),
        amount: money(c.totalCents),
      })),
      ...invoicesToLink.map((l) => ({
        when: '',
        what: t(`Invoice ${practiceHubInvoiceNumber(l.ref)}, already here`, `Factura ${practiceHubInvoiceNumber(l.ref)}, ya importada`),
        visit: t('Linked now', 'Se vincula ahora'),
        amount: '',
      })),
      ...payments.map((p) => ({
        when: date(p.paidAt),
        what: `${t('Payment', 'Pago')} · ${methodName(p.method)}`,
        visit: '',
        amount: money(p.amountCents),
      })),
    ],
    warnings: [
      t(
        `PracticeHub holds ${money(phTotals.invoicedCents)} invoiced and ${money(phTotals.paidCents)} paid. Paid minus invoiced in what is created now: ${money(paidCents - invoicedCents)}.`,
        `PracticeHub tiene ${money(phTotals.invoicedCents)} facturado y ${money(phTotals.paidCents)} pagado. Pagado menos facturado en lo que se crea ahora: ${money(paidCents - invoicedCents)}.`,
      ),
      t(
        'Payments arrive unallocated, because PracticeHub records no allocation. Each invoice’s status is then worked out by covering the patient’s visits oldest first with what they paid; no payment is attached to an invoice, split or changed.',
        'Los pagos llegan sin asignar, porque PracticeHub no registra ninguna asignación. El estado de las facturas se deduce cubriendo las visitas más antiguas primero con lo pagado; ningún pago se asigna, divide ni modifica.',
      ),
      ...(skipped.invoicesAlready || skipped.paymentsAlready
        ? [t(
          `Already imported, so skipped: ${nf.format(skipped.invoicesAlready)} invoices, ${nf.format(skipped.paymentsAlready)} payments.`,
          `Ya importados, se omiten: ${nf.format(skipped.invoicesAlready)} facturas, ${nf.format(skipped.paymentsAlready)} pagos.`,
        )]
        : []),
      ...(paymentsToAdopt.length
        ? [t(
          `${nf.format(paymentsToAdopt.length)} payments are Stripe charges already recorded here by the Stripe sync, so they are matched to those instead of created again.`,
          `${nf.format(paymentsToAdopt.length)} pagos son cobros de Stripe ya registrados aquí por la sincronización de Stripe, así que se emparejan con ellos en vez de crearse otra vez.`,
        )]
        : []),
      ...(invoicesToLink.length
        ? [t(
          `${nf.format(invoicesToLink.length)} invoices already imported without their visit will be linked to it now.`,
          `${nf.format(invoicesToLink.length)} facturas ya importadas sin su visita se vincularán ahora a ella.`,
        )]
        : []),
      ...(skipped.invoicesUnmatched || skipped.paymentsUnmatched
        ? [t(
          `Skipped because their patient is not here yet: ${nf.format(skipped.invoicesUnmatched)} invoices, ${nf.format(skipped.paymentsUnmatched)} payments. Run Patients first.`,
          `Se omiten porque su paciente aún no está aquí: ${nf.format(skipped.invoicesUnmatched)} facturas, ${nf.format(skipped.paymentsUnmatched)} pagos. Ejecuta antes Pacientes.`,
        )]
        : []),
      t('Nothing is deleted. Invoices and payments already here stay exactly as they are.', 'No se elimina nada. Las facturas y pagos que ya están aquí se quedan tal cual.'),
    ],
    total: invoices.length + invoicesToLink.length + payments.length + paymentsToAdopt.length + (settle ? 1 : 0),

    // `written` counts invoices and payments created, invoices linked, and
    // invoices whose status settlement changed -- every row this touched, so
    // a slice spent settling a large clinic does not read as one that made no
    // progress.
    async apply(progress, shouldStop) {
      const errors: string[] = []
      let written = 0
      let done = 0

      for (let i = 0; i < invoices.length; i += CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = invoices.slice(i, i + CHUNK)
        const { data, error } = await supabase
          .from('invoices')
          .insert(
            chunk.map((c) => ({
              account_id: accountId,
              patient_id: c.patientId,
              appointment_id: c.appointmentId,
              invoice_number: practiceHubInvoiceNumber(c.ref),
              external_reference: c.ref,
              // Nothing is allocated yet; settlement below sets what the
              // patient's own payments cover.
              status: 'unpaid',
              total_cents: c.totalCents,
              created_at: c.createdAt,
            })),
          )
          .select('id')
        if (error) errors.push(t(`Invoices from PracticeHub reference ${chunk[0]?.ref} on were not created: ${error.message}`, `No se crearon las facturas desde la referencia de PracticeHub ${chunk[0]?.ref}: ${error.message}`))
        else written += data?.length ?? 0
        done += chunk.length
        progress(done)
      }

      for (const link of invoicesToLink) {
        if (shouldStop()) return { written, errors }
        // Only where it is still unlinked, so a link someone made by hand since
        // the plan is never overwritten.
        const { data, error } = await supabase
          .from('invoices')
          .update({ appointment_id: link.appointmentId })
          .eq('id', link.id)
          .eq('account_id', accountId)
          .is('appointment_id', null)
          .select('id')
        if (error) errors.push(t(`An invoice was not linked to its visit: ${error.message}`, `Una factura no se vinculó a su visita: ${error.message}`))
        else written += data?.length ?? 0
        progress(++done)
      }

      for (let i = 0; i < payments.length; i += CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = payments.slice(i, i + CHUNK)
        const { data, error } = await supabase
          .from('payments')
          .insert(
            chunk.map((c) => ({
              account_id: accountId,
              patient_id: c.patientId,
              // Unallocated on arrival. This is the row shape 0170 made
              // possible, and the reason this importer does not have to invent
              // an invoice to hang the money on.
              invoice_id: null,
              external_reference: c.ref,
              amount_cents: c.amountCents,
              method: c.method,
              paid_at: c.paidAt,
            })),
          )
          .select('id')
        if (error) errors.push(t(`Payments from PracticeHub reference ${chunk[0]?.ref} on were not created: ${error.message}`, `No se crearon los pagos desde la referencia de PracticeHub ${chunk[0]?.ref}: ${error.message}`))
        else written += data?.length ?? 0
        done += chunk.length
        progress(done)
      }

      for (const adopt of paymentsToAdopt) {
        if (shouldStop()) return { written, errors }
        // Only while it is still nobody's, so two runs cannot both claim it.
        const { data, error } = await supabase
          .from('payments')
          .update({ external_reference: adopt.ref })
          .eq('id', adopt.paymentId)
          .eq('account_id', accountId)
          .is('external_reference', null)
          .select('id')
        if (error) errors.push(t(`A Stripe charge was not matched to PracticeHub payment ${adopt.ref}: ${error.message}`, `Un cobro de Stripe no se emparejó con el pago de PracticeHub ${adopt.ref}: ${error.message}`))
        else written += data?.length ?? 0
        progress(++done)
      }

      if (settle) {
        // Sets invoice status only -- no payment is allocated, split or
        // otherwise touched. See the migration for why the pairing is
        // deliberately not made.
        //
        // In batches: every changed invoice writes an audit row, and a
        // clinic's whole history in one call outran the 8 s a signed-in
        // request is allowed (10,251 invoices did). The service role is let
        // through by the function's own guard (no auth.uid()) and holds
        // EXECUTE on it, but batching is kept: it is also what lets a slice
        // stop between calls. Each call changes at most SETTLE_BATCH and the
        // rest are left for the next, so a call changing fewer means it is
        // done.
        for (let call = 0; call < SETTLE_MAX_CALLS; call++) {
          if (shouldStop()) return { written, errors }
          const { data: settled, error } = await supabase.rpc('settle_imported_invoices', { p_account_id: accountId, p_limit: SETTLE_BATCH })
          if (error) {
            errors.push(t(`Some invoice statuses were not updated from the payments: ${error.message}`, `Algunos estados de factura no se actualizaron con los pagos: ${error.message}`))
            break
          }
          written += settled ?? 0
          if ((settled ?? 0) < SETTLE_BATCH) break
        }
        progress(++done)
      }

      return { written, errors }
    },
  }
}
