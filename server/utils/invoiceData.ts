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
  lineItems: { description: string; quantity: number; price_cents: number }[]
  patient: { firstName: string; lastName: string | null; email: string | null; address: string | null; nationalId: string | null }
  clinic: { name: string; legalName: string | null; address: string | null; taxId: string | null } | null
}

export async function loadInvoiceDocumentData(
  supabase: SupabaseClient<Database>,
  invoiceId: string,
): Promise<InvoiceDocumentData | null> {
  const { data: invoice } = await supabase
    .from('invoices')
    .select('invoice_number, created_at, total_cents, account_id, patients(first_name, last_name, email, address, national_id), appointments(clinic_id)')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) return null

  const { data: lineItems } = await supabase.from('invoice_line_items').select('description, quantity, price_cents').eq('invoice_id', invoiceId)

  const patient = invoice.patients as unknown as {
    first_name: string
    last_name: string | null
    email: string | null
    address: string | null
    national_id: string | null
  } | null
  const appointment = invoice.appointments as unknown as { clinic_id: string } | null

  // Most invoices come from an appointment (which has a clinic_id); a
  // package/membership sale invoice doesn't, so this falls back to the
  // account's first clinic -- accurate for the common single-clinic case.
  const { data: clinicRow } = appointment?.clinic_id
    ? await supabase.from('clinics').select('name, legal_name, address, tax_id').eq('id', appointment.clinic_id).maybeSingle()
    : await supabase.from('clinics').select('name, legal_name, address, tax_id').eq('account_id', invoice.account_id).order('created_at').limit(1).maybeSingle()

  return {
    invoiceNumber: invoice.invoice_number,
    createdAt: invoice.created_at,
    totalCents: invoice.total_cents,
    lineItems: lineItems ?? [],
    patient: patient
      ? { firstName: patient.first_name, lastName: patient.last_name, email: patient.email, address: patient.address, nationalId: patient.national_id }
      : { firstName: '', lastName: null, email: null, address: null, nationalId: null },
    clinic: clinicRow ? { name: clinicRow.name, legalName: clinicRow.legal_name, address: clinicRow.address, taxId: clinicRow.tax_id } : null,
  }
}

export function generateInvoicePdf(data: InvoiceDocumentData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    if (data.clinic) {
      doc.fontSize(14).font('Helvetica-Bold').text(data.clinic.legalName || data.clinic.name)
      doc.fontSize(10).font('Helvetica').fillColor('#555')
      if (data.clinic.address) doc.text(data.clinic.address)
      if (data.clinic.taxId) doc.text(`Tax ID: ${data.clinic.taxId}`)
      doc.moveDown(1.5)
    }

    doc.fillColor('#000').fontSize(18).font('Helvetica-Bold').text(`Invoice ${data.invoiceNumber}`)
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#555')
      .text(`Issued ${new Date(data.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`)
    doc.moveDown(1)

    doc.fillColor('#000').fontSize(12).font('Helvetica-Bold').text(`${data.patient.firstName} ${data.patient.lastName ?? ''}`.trim())
    doc.fontSize(10).font('Helvetica').fillColor('#555')
    if (data.patient.address) doc.text(data.patient.address)
    if (data.patient.nationalId) doc.text(`ID: ${data.patient.nationalId}`)
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
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#000')
      .text(`Total: €${(data.totalCents / 100).toFixed(2)}`, col.price, y + 14, { width: 145, align: 'right' })

    doc.end()
  })
}
