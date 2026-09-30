import PDFDocument from 'pdfkit'
import { VERIFACTU_QR_LABEL, VERIFACTU_QR_LEGEND } from '../../utils/verifactuQr'
import { exemptionClause, facturaTaxFor } from '../../utils/facturaTax'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// PDF points per millimetre: the Orden sizes the VERI*FACTU QR in mm.
const MM = 72 / 25.4

// Shared by the invoice PDF endpoint and the email-send endpoint, so the
// downloaded PDF, the emailed PDF, and the on-screen invoice can't drift
// out of sync with each other.
export interface InvoiceDocumentData {
  invoiceNumber: string
  createdAt: string
  totalCents: number
  paidCents: number
  balanceDueCents: number
  lineItems: { description: string; quantity: number; price_cents: number }[]
  patient: {
    firstName: string
    lastName: string | null
    email: string | null
    address: string | null
    city: string | null
    postalCode: string | null
    country: string | null
    nationalId: string | null
    dateOfBirth?: string | null
  }
  clinic: { name: string; legalName: string | null; address: string | null; taxId: string | null; footerText: string | null } | null
  logoBuffer: Buffer | null
  nextAppointmentDate: string | null
  hideNextVisit: boolean
  // A factura reuses this whole layout -- same clinic header, same logo, same
  // footer -- and differs in two words and one line, so it sets these rather
  // than the PDF being written twice and drifting.
  //
  // documentTitle: "Factura F-2026-0001" instead of the visit document's own
  // "Recibo INV-0001".
  // showTotalsBreakdown: a factura IS the payment, so "Paid" and "Balance due"
  // are noise at best and, on a document that says what someone handed over,
  // actively confusing.
  documentTitle?: string
  showTotalsBreakdown?: boolean
  // The tax a factura was issued under. Absent on the visit document, which is
  // a receipt rather than an invoice, so the block simply does not print.
  //
  // RD 1619/2012 requires an invoice to state the base imponible and the rate
  // and cuota, or to cite the provision it is exempt under -- a line reading
  // only "Total" satisfies neither. The same figures are what a VERI*FACTU
  // registro de facturación carries.
  tax?: { baseCents: number; rateBp: number; amountCents: number; exemptionClause: string | null } | null
  // The VERI*FACTU QR, on facturas only (see utils/verifactuQr.ts). `png` is
  // the code itself, rendered at error-correction level M as the Orden
  // requires; `url` is what it encodes, kept for tests and for anyone
  // debugging a "not found" from the AEAT.
  verifactuQr?: { url: string; png: Buffer } | null
  // What the clinic chose to show on its receipts (Settings > Invoicing).
  // Only the receipt carries it: a factura leaves it out and prints what the
  // law requires, whatever these switches say.
  receipt?: {
    showDob: boolean
    showNationalId: boolean
    showTaxes: boolean
    showPayments: boolean
    showBalance: boolean
    showAccountBalance: boolean
    showPractitioner: boolean
    showLogo: boolean
    practitionerName: string | null
    // The patient's whole-account balance, as the patient list shows it:
    // positive is credit, negative is owed. Null when not shown.
    accountBalanceCents: number | null
    // The account's tax rule applied to the total, as the factura for this
    // money would state it. A receipt is not a fiscal document; this only
    // tells the patient what the price contains.
    tax: { baseCents: number; rateBp: number; amountCents: number; exemptionClause: string | null }
  }
  // The receipt email's own subject and message, from Settings > Invoicing.
  // Null leaves the built-in wording.
  email?: { subject: string | null; body: string | null }
}

// "123 Main St" + "28001 Madrid" + "Spain" on their own lines, skipping any
// that are empty rather than leaving blank lines or stray commas.
function addressLines(address: string | null, city: string | null, postalCode: string | null, country: string | null): string[] {
  const lines: string[] = []
  if (address) lines.push(address)
  const cityLine = [postalCode, city].filter(Boolean).join(' ')
  if (cityLine) lines.push(cityLine)
  if (country) lines.push(country)
  return lines
}

export async function loadInvoiceDocumentData(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
): Promise<InvoiceDocumentData | null> {
  const { data: invoice } = await supabase
    .from('invoices')
    .select(
      'invoice_number, created_at, total_cents, account_id, patient_id, patients(first_name, last_name, email, address, city, postal_code, country, national_id, date_of_birth), appointments(clinic_id, practitioner_id, practitioner_name)',
    )
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return null

  const [{ data: lineItems }, { data: payments }, { data: nextAppointment }, { data: account }] = await Promise.all([
    supabase.from('invoice_line_items').select('description, quantity, price_cents').eq('invoice_id', invoiceId),
    supabase.from('payments').select('amount_cents').eq('invoice_id', invoiceId),
    supabase
      .from('appointments')
      .select('starts_at')
      .eq('patient_id', invoice.patient_id)
      .neq('status', 'cancelled')
      // Not one the clinic deleted (status stays 'booked' when it does).
      .is('deleted_at', null)
      .gt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('accounts')
      .select(
        'hide_next_visit_on_invoices, show_dob_on_invoices, show_ssn_on_invoices, show_taxes_on_invoices, hide_invoice_balance, hide_account_balance, hide_payments_on_invoices, hide_provider_on_invoices, hide_logo_on_invoices, invoice_email_subject, invoice_email_body, factura_tax_rate_bp, factura_tax_exemption_code',
      )
      .eq('id', invoice.account_id)
      .maybeSingle(),
  ])

  const patient = invoice.patients as unknown as {
    first_name: string
    last_name: string | null
    email: string | null
    address: string | null
    city: string | null
    postal_code: string | null
    country: string | null
    national_id: string | null
    date_of_birth: string | null
  } | null
  const appointment = invoice.appointments as unknown as { clinic_id: string; practitioner_id: string | null; practitioner_name: string | null } | null

  // The practitioner by their current name, falling back to the name the
  // appointment was imported with. Only fetched when the receipt shows it.
  let practitionerName: string | null = null
  if (!account?.hide_provider_on_invoices && appointment) {
    if (appointment.practitioner_id) {
      const { data: member } = await supabase.from('team_members').select('full_name').eq('id', appointment.practitioner_id).maybeSingle()
      practitionerName = member?.full_name ?? null
    }
    practitionerName ??= appointment.practitioner_name
  }

  // The balance the patient list and the Billing tab show (the
  // patient_live_balances view, through the live_balance_cents computed
  // field): positive is credit. Not the statement's running sum, which counts
  // a payment made from credit, and the credit it came from, as money twice.
  let accountBalanceCents: number | null = null
  if (account && !account.hide_account_balance) {
    const { data: live } = await supabase.from('patients').select('live_balance_cents').eq('id', invoice.patient_id).maybeSingle()
    accountBalanceCents = (live as { live_balance_cents: number | null } | null)?.live_balance_cents ?? null
  }

  // Most invoices come from an appointment (which has a clinic_id); a
  // package/membership sale invoice doesn't, so this falls back to the
  // account's first clinic -- accurate for the common single-clinic case.
  //
  // Read live, deliberately, unlike a factura (see facturaData.ts and
  // 20260924135318). This is the receipt: a statement of what a visit cost and
  // what is still owed, not a fiscal document. It has no number in a fiscal
  // series and no registro behind it, it is re-rendered precisely because its
  // balance moves, and a clinic that has moved wants a reprinted receipt to
  // show where to find it now. What must never move -- the document that
  // evidences the money for Hacienda -- is the factura, and that one is frozen.
  const { data: clinicRow } = appointment?.clinic_id
    ? await supabase.from('clinics').select('name, legal_name, address, tax_id, invoice_footer_text, logo_storage_path').eq('id', appointment.clinic_id).maybeSingle()
    : await supabase
        .from('clinics')
        .select('name, legal_name, address, tax_id, invoice_footer_text, logo_storage_path')
        .eq('account_id', invoice.account_id)
        .order('created_at')
        .limit(1)
        .maybeSingle()

  const paidCents = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)

  // Fetched server-side (not just a URL) so generateInvoicePdf can embed it
  // with pdfkit's doc.image(), which needs bytes, not a link -- best-effort,
  // a broken/slow logo fetch shouldn't block generating the rest of the invoice.
  let logoBuffer: Buffer | null = null
  if (clinicRow?.logo_storage_path) {
    try {
      const { data: publicUrl } = supabase.storage.from('clinic-logos').getPublicUrl(clinicRow.logo_storage_path)
      const res = await fetch(publicUrl.publicUrl)
      if (res.ok) logoBuffer = Buffer.from(await res.arrayBuffer())
    } catch {
      logoBuffer = null
    }
  }

  return {
    invoiceNumber: invoice.invoice_number,
    createdAt: invoice.created_at,
    totalCents: invoice.total_cents,
    paidCents,
    balanceDueCents: invoice.total_cents - paidCents,
    lineItems: lineItems ?? [],
    patient: patient
      ? {
          firstName: patient.first_name,
          lastName: patient.last_name,
          email: patient.email,
          address: patient.address,
          city: patient.city,
          postalCode: patient.postal_code,
          country: patient.country,
          nationalId: patient.national_id,
          dateOfBirth: patient.date_of_birth,
        }
      : { firstName: '', lastName: null, email: null, address: null, city: null, postalCode: null, country: null, nationalId: null },
    clinic: clinicRow
      ? { name: clinicRow.name, legalName: clinicRow.legal_name, address: clinicRow.address, taxId: clinicRow.tax_id, footerText: clinicRow.invoice_footer_text }
      : null,
    logoBuffer,
    nextAppointmentDate: nextAppointment?.starts_at ?? null,
    hideNextVisit: !!account?.hide_next_visit_on_invoices,
    receipt: receiptOptions(account, invoice.total_cents, practitionerName, accountBalanceCents),
    email: { subject: account?.invoice_email_subject?.trim() || null, body: account?.invoice_email_body?.trim() || null },
  }
}

type ReceiptAccount = {
  show_dob_on_invoices: boolean
  show_ssn_on_invoices: boolean
  show_taxes_on_invoices: boolean
  hide_invoice_balance: boolean
  hide_account_balance: boolean
  hide_payments_on_invoices: boolean
  hide_provider_on_invoices: boolean
  hide_logo_on_invoices: boolean
  factura_tax_rate_bp: number | null
  factura_tax_exemption_code: string | null
}

// The switches read as "show"; the columns are a mix of show_* and hide_*.
// An account that could not be read prints what receipts always printed.
export function receiptOptions(account: ReceiptAccount | null, totalCents: number, practitionerName: string | null, accountBalanceCents: number | null): NonNullable<InvoiceDocumentData['receipt']> {
  const tax = facturaTaxFor(totalCents, account)
  return {
    showDob: !!account?.show_dob_on_invoices,
    showNationalId: account ? account.show_ssn_on_invoices : true,
    showTaxes: !!account?.show_taxes_on_invoices,
    showPayments: !account?.hide_payments_on_invoices,
    showBalance: !account?.hide_invoice_balance,
    showAccountBalance: !!account && !account.hide_account_balance && accountBalanceCents !== null,
    showPractitioner: !!account && !account.hide_provider_on_invoices && !!practitionerName,
    showLogo: !account?.hide_logo_on_invoices,
    practitionerName,
    accountBalanceCents,
    tax: { baseCents: tax.taxBaseCents, rateBp: tax.taxRateBp, amountCents: tax.taxAmountCents, exemptionClause: exemptionClause(tax.taxExemptionCode) },
  }
}

export function generateInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // The VERI*FACTU QR comes first, above everything the system prints --
    // the AEAT's placement rules for a portrait page: at the top, near the
    // upper margin, centred, and the first QR on the document. 35 mm, inside
    // the 30-40 mm the Orden allows; "QR tributario:" above it and
    // "VERI*FACTU" right below, no smaller than the rest of the text, with
    // well over the 2 mm of clear space it needs on every side.
    let headerTop = 45
    if (data.verifactuQr) {
      const size = 35 * MM
      const pageWidth = doc.page.width
      doc.fillColor('#000').fontSize(10).font('Helvetica').text(VERIFACTU_QR_LABEL, 0, 30, { width: pageWidth, align: 'center' })
      doc.image(data.verifactuQr.png, (pageWidth - size) / 2, 52, { width: size, height: size })
      doc.fontSize(10).font('Helvetica-Bold').text(VERIFACTU_QR_LEGEND, 0, 52 + size + 10, { width: pageWidth, align: 'center' })
      headerTop = 52 + size + 40
    }

    // The receipt's switches (Settings > Invoicing); a factura has none and
    // prints everything below as it always has.
    const receipt = data.receipt
    const logo = receipt && !receipt.showLogo ? null : data.logoBuffer
    if (logo) {
      try {
        doc.image(logo, 50, headerTop, { fit: [120, 60] })
      } catch {
        // Corrupt/unsupported image format -- skip it rather than fail the whole invoice.
      }
    }

    if (data.clinic) {
      const clinicX = logo ? 185 : 50
      doc.fontSize(14).font('Helvetica-Bold').text(data.clinic.name, clinicX, headerTop + 5)
      doc.fontSize(10).font('Helvetica').fillColor('#555')
      if (data.clinic.legalName) doc.text(data.clinic.legalName, clinicX)
      for (const line of addressLines(data.clinic.address, null, null, null)) doc.text(line, clinicX)
      if (data.clinic.taxId) doc.text(`Tax ID: ${data.clinic.taxId}`, clinicX)
      doc.moveDown(1.5)
    }
    if (logo && doc.y < headerTop + 70) doc.y = headerTop + 70
    if (doc.y < headerTop) doc.y = headerTop

    doc.x = 50
    // A visit charge is a RECIBO, not a factura. Fiscally the invoice follows
  // the payment -- that is the facturas series (F-2026-0001), issued when the
  // patient actually hands money over. This document says what was done and
  // what it cost; calling it an "Invoice" put a second, parallel numbered
  // series in front of the patient for the same money.
  const isFactura = data.documentTitle !== undefined
  doc.fillColor('#000').fontSize(18).font('Helvetica-Bold').text(data.documentTitle ?? `Recibo ${data.invoiceNumber}`, 50)
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#555')
      .text(`Issued ${new Date(data.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, 50)
    // Said outright, so nobody -- patient, gestor or inspector -- mistakes a
    // recibo for the fiscal document. The factura is the one for the payment.
    if (!isFactura) {
      doc.fontSize(9).fillColor('#777').text('Justificante de visita. No es una factura: la factura se emite con el pago.', 50)
    }
    doc.moveDown(1)

    doc.fillColor('#000').fontSize(12).font('Helvetica-Bold').text(`${data.patient.firstName} ${data.patient.lastName ?? ''}`.trim(), 50)
    doc.fontSize(10).font('Helvetica').fillColor('#555')
    for (const line of addressLines(data.patient.address, data.patient.city, data.patient.postalCode, data.patient.country)) doc.text(line, 50)
    if (data.patient.nationalId && (!receipt || receipt.showNationalId)) doc.text(`ID: ${data.patient.nationalId}`, 50)
    if (receipt?.showDob && data.patient.dateOfBirth) doc.text(`Fecha de nacimiento: ${new Date(data.patient.dateOfBirth).toLocaleDateString('es-ES', { timeZone: 'UTC' })}`, 50)
    if (receipt?.showPractitioner && receipt.practitionerName) doc.text(`Profesional: ${receipt.practitionerName}`, 50)
    doc.moveDown(1.5)

    const col = { desc: 50, qty: 340, price: 400, total: 470 }
    const tableTop = doc.y
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
    doc.text('Description', col.desc, tableTop)
    doc.text('Qty', col.qty, tableTop, { width: 40, align: 'right' })
    doc.text('Price', col.price, tableTop, { width: 60, align: 'right' })
    doc.text('Total', col.total, tableTop, { width: 75, align: 'right' })
    doc
      .moveTo(50, tableTop + 14)
      .lineTo(545, tableTop + 14)
      .strokeColor('#ddd')
      .stroke()

    let y = tableTop + 20
    doc.font('Helvetica').fillColor('#333')
    for (const item of data.lineItems) {
      const lineTotal = (item.price_cents * item.quantity) / 100
      doc.text(item.description, col.desc, y, { width: 280 })
      doc.text(String(item.quantity), col.qty, y, { width: 40, align: 'right' })
      doc.text(`€${(item.price_cents / 100).toFixed(2)}`, col.price, y, { width: 60, align: 'right' })
      doc.text(`€${lineTotal.toFixed(2)}`, col.total, y, { width: 75, align: 'right' })
      y += 18
    }

    doc
      .moveTo(50, y + 4)
      .lineTo(545, y + 4)
      .strokeColor('#ddd')
      .stroke()

    let totalsY = y + 14
    doc.font('Helvetica').fontSize(10).fillColor('#555')
    if (data.showTotalsBreakdown === false) {
      // A factura states its base, then its tax, then the total. It used to
      // print the total alone, which is not an invoice's job: the reader has
      // to be able to see what was taxed and at what rate, or why it was not.
      if (data.tax) {
        doc.text(`Base imponible: €${(data.tax.baseCents / 100).toFixed(2)}`, col.price, totalsY, { width: 145, align: 'right' })
        totalsY += 15
        const taxLine = data.tax.exemptionClause
          ? 'IVA: exenta'
          : `IVA (${(data.tax.rateBp / 100).toFixed(0)}%): €${(data.tax.amountCents / 100).toFixed(2)}`
        doc.text(taxLine, col.price, totalsY, { width: 145, align: 'right' })
        totalsY += 18
      }
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#000')
        .text(`Total: €${(data.totalCents / 100).toFixed(2)}`, col.price, totalsY, { width: 145, align: 'right' })

      // The clause goes on its own line on the left, where a reader looks for
      // it, rather than squeezed into the totals column.
      if (data.tax?.exemptionClause) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#555')
          .text(data.tax.exemptionClause, 50, totalsY + 2, { width: 300 })
      }
    } else {
      if (receipt?.showTaxes) {
        const tax = receipt.tax
        doc.text(`Base: €${(tax.baseCents / 100).toFixed(2)}`, col.price, totalsY, { width: 145, align: 'right' })
        totalsY += 15
        doc.text(tax.exemptionClause ? 'IVA: exenta' : `IVA (${(tax.rateBp / 100).toFixed(0)}%): €${(tax.amountCents / 100).toFixed(2)}`, col.price, totalsY, { width: 145, align: 'right' })
        totalsY += 15
      }
      doc.text(`Subtotal: €${(data.totalCents / 100).toFixed(2)}`, col.price, totalsY, { width: 145, align: 'right' })
      totalsY += 15
      if (!receipt || receipt.showPayments) {
        doc.text(`Paid: €${(data.paidCents / 100).toFixed(2)}`, col.price, totalsY, { width: 145, align: 'right' })
        totalsY += 18
      }
      if (!receipt || receipt.showBalance) {
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor('#000')
          .text(`Balance due: €${(data.balanceDueCents / 100).toFixed(2)}`, col.price, totalsY, { width: 145, align: 'right' })
        totalsY += 18
      }
      if (receipt?.showAccountBalance && receipt.accountBalanceCents !== null) {
        const b = receipt.accountBalanceCents
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#555')
          .text(`Account balance: €${(Math.abs(b) / 100).toFixed(2)} ${b < 0 ? 'due' : 'credit'}`, col.price - 60, totalsY, { width: 205, align: 'right' })
        totalsY += 15
      }
      if (receipt?.showTaxes && receipt.tax.exemptionClause) {
        doc.font('Helvetica').fontSize(9).fillColor('#555').text(receipt.tax.exemptionClause, 50, y + 14, { width: 300 })
      }
    }

    let footerY = totalsY + 40
    if (data.clinic?.footerText) {
      doc.font('Helvetica').fontSize(9).fillColor('#777').text(data.clinic.footerText, 50, footerY, { width: 495 })
      footerY = doc.y + 10
    }
    if (!data.hideNextVisit) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#777')
        .text(`Your next visit: ${data.nextAppointmentDate ? new Date(data.nextAppointmentDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`, 50, footerY)
    }

    doc.end()
  })
}
