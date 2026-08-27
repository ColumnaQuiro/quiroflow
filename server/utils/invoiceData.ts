import PDFDocument from 'pdfkit'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

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
  }
  clinic: { name: string; legalName: string | null; address: string | null; taxId: string | null; footerText: string | null } | null
  logoBuffer: Buffer | null
  nextAppointmentDate: string | null
  hideNextVisit: boolean
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
      'invoice_number, created_at, total_cents, account_id, patient_id, patients(first_name, last_name, email, address, city, postal_code, country, national_id), appointments(clinic_id)',
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
      .gt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from('accounts').select('hide_next_visit_on_invoices').eq('id', invoice.account_id).maybeSingle(),
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
  } | null
  const appointment = invoice.appointments as unknown as { clinic_id: string } | null

  // Most invoices come from an appointment (which has a clinic_id); a
  // package/membership sale invoice doesn't, so this falls back to the
  // account's first clinic -- accurate for the common single-clinic case.
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
        }
      : { firstName: '', lastName: null, email: null, address: null, city: null, postalCode: null, country: null, nationalId: null },
    clinic: clinicRow
      ? { name: clinicRow.name, legalName: clinicRow.legal_name, address: clinicRow.address, taxId: clinicRow.tax_id, footerText: clinicRow.invoice_footer_text }
      : null,
    logoBuffer,
    nextAppointmentDate: nextAppointment?.starts_at ?? null,
    hideNextVisit: !!account?.hide_next_visit_on_invoices,
  }
}

export function generateInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    if (data.logoBuffer) {
      try {
        doc.image(data.logoBuffer, 50, 45, { fit: [120, 60] })
      } catch {
        // Corrupt/unsupported image format -- skip it rather than fail the whole invoice.
      }
    }

    if (data.clinic) {
      const clinicX = data.logoBuffer ? 185 : 50
      doc.fontSize(14).font('Helvetica-Bold').text(data.clinic.legalName || data.clinic.name, clinicX, 50)
      doc.fontSize(10).font('Helvetica').fillColor('#555')
      for (const line of addressLines(data.clinic.address, null, null, null)) doc.text(line, clinicX)
      if (data.clinic.taxId) doc.text(`Tax ID: ${data.clinic.taxId}`, clinicX)
      doc.moveDown(1.5)
    }
    if (data.logoBuffer && doc.y < 115) doc.y = 115

    doc.x = 50
    doc.fillColor('#000').fontSize(18).font('Helvetica-Bold').text(`Invoice ${data.invoiceNumber}`, 50)
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#555')
      .text(`Issued ${new Date(data.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, 50)
    doc.moveDown(1)

    doc.fillColor('#000').fontSize(12).font('Helvetica-Bold').text(`${data.patient.firstName} ${data.patient.lastName ?? ''}`.trim(), 50)
    doc.fontSize(10).font('Helvetica').fillColor('#555')
    for (const line of addressLines(data.patient.address, data.patient.city, data.patient.postalCode, data.patient.country)) doc.text(line, 50)
    if (data.patient.nationalId) doc.text(`ID: ${data.patient.nationalId}`, 50)
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
    doc.text(`Subtotal: €${(data.totalCents / 100).toFixed(2)}`, col.price, totalsY, { width: 145, align: 'right' })
    totalsY += 15
    doc.text(`Paid: €${(data.paidCents / 100).toFixed(2)}`, col.price, totalsY, { width: 145, align: 'right' })
    totalsY += 18
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#000')
      .text(`Balance due: €${(data.balanceDueCents / 100).toFixed(2)}`, col.price, totalsY, { width: 145, align: 'right' })

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
