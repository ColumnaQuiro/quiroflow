import PDFDocument from 'pdfkit'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// PracticeHub's "Download/Send Statement" -- a PDF of the patient's whole
// Account Ledger (same merge logic as components/patients/AccountLedger.vue,
// re-derived server-side since that component's data lives client-side) plus
// a closing balance. Shared by the download and email-send endpoints.
export interface StatementRow {
  ref: string
  date: string
  description: string
  debitCents: number
  creditCents: number
}
export interface StatementDocumentData {
  patient: { firstName: string; lastName: string | null; email: string | null }
  clinic: { name: string; legalName: string | null; address: string | null; taxId: string | null; footerText: string | null } | null
  rows: StatementRow[]
  closingBalanceCents: number
  generatedAt: string
}

export async function loadStatementDocumentData(supabase: SupabaseClient<Database>, patientId: string): Promise<StatementDocumentData | null> {
  const { data: patient } = await supabase.from('patients').select('first_name, last_name, email, account_id').eq('id', patientId).maybeSingle()
  if (!patient) return null

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_cents, created_at')
    .eq('patient_id', patientId)
    .order('created_at')
  const invoiceIds = (invoices ?? []).map((i) => i.id)

  const [{ data: payments }, { data: credits }, { data: clinicRow }] = await Promise.all([
    invoiceIds.length > 0
      ? supabase.from('payments').select('id, amount_cents, method, paid_at').in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [] as { id: string; amount_cents: number; method: string; paid_at: string }[] }),
    supabase.from('account_credits').select('id, amount_cents, reason, created_at').eq('patient_id', patientId).order('created_at'),
    supabase.from('clinics').select('name, legal_name, address, tax_id, invoice_footer_text').eq('account_id', patient.account_id).order('created_at').limit(1).maybeSingle(),
  ])

  const rows: StatementRow[] = []
  for (const inv of invoices ?? []) {
    rows.push({
      ref: inv.invoice_number,
      date: inv.created_at,
      description: inv.status === 'void' ? 'Invoice (void)' : 'Invoice',
      debitCents: inv.status === 'void' ? 0 : inv.total_cents,
      creditCents: 0,
    })
  }
  ;(payments ?? []).forEach((p, i) => {
    rows.push({ ref: `PAY-${i + 1}`, date: p.paid_at, description: `Payment — ${p.method}`, debitCents: 0, creditCents: p.amount_cents })
  })
  ;(credits ?? []).forEach((c, i) => {
    rows.push({
      ref: `CR-${i + 1}`,
      date: c.created_at,
      description: c.reason ?? 'Account credit',
      debitCents: c.amount_cents < 0 ? -c.amount_cents : 0,
      creditCents: c.amount_cents > 0 ? c.amount_cents : 0,
    })
  })
  rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const closingBalanceCents = rows.reduce((sum, r) => sum + r.creditCents - r.debitCents, 0)

  return {
    patient: { firstName: patient.first_name, lastName: patient.last_name, email: patient.email },
    clinic: clinicRow
      ? { name: clinicRow.name, legalName: clinicRow.legal_name, address: clinicRow.address, taxId: clinicRow.tax_id, footerText: clinicRow.invoice_footer_text }
      : null,
    rows,
    closingBalanceCents,
    generatedAt: new Date().toISOString(),
  }
}

export function generateStatementPdf(data: StatementDocumentData): Promise<Buffer> {
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

    doc.fillColor('#000').fontSize(18).font('Helvetica-Bold').text('Account Statement')
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#555')
      .text(`Generated ${new Date(data.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`)
    doc.moveDown(1)

    doc.fillColor('#000').fontSize(12).font('Helvetica-Bold').text(`${data.patient.firstName} ${data.patient.lastName ?? ''}`.trim())
    doc.moveDown(1.5)

    const col = { ref: 50, date: 115, desc: 195, debit: 385, credit: 465 }
    let y = doc.y
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
    doc.text('Ref', col.ref, y)
    doc.text('Date', col.date, y)
    doc.text('Description', col.desc, y)
    doc.text('Debit', col.debit, y, { width: 70, align: 'right' })
    doc.text('Credit', col.credit, y, { width: 80, align: 'right' })
    doc
      .moveTo(50, y + 14)
      .lineTo(545, y + 14)
      .strokeColor('#ddd')
      .stroke()

    y += 20
    doc.font('Helvetica').fillColor('#333').fontSize(8.5)
    for (const row of data.rows) {
      if (y > 740) {
        doc.addPage()
        y = 50
      }
      doc.text(row.ref, col.ref, y, { width: 60 })
      doc.text(new Date(row.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), col.date, y, { width: 75 })
      doc.text(row.description, col.desc, y, { width: 185 })
      doc.text(row.debitCents > 0 ? `€${(row.debitCents / 100).toFixed(2)}` : '', col.debit, y, { width: 70, align: 'right' })
      doc.text(row.creditCents > 0 ? `€${(row.creditCents / 100).toFixed(2)}` : '', col.credit, y, { width: 80, align: 'right' })
      y += 16
    }

    if (y > 740) {
      doc.addPage()
      y = 50
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
      .text(
        `Closing balance: €${(Math.abs(data.closingBalanceCents) / 100).toFixed(2)} ${data.closingBalanceCents < 0 ? 'due' : 'credit'}`,
        col.debit,
        y + 14,
        { width: 200, align: 'right' },
      )

    if (data.clinic?.footerText) {
      doc.font('Helvetica').fontSize(9).fillColor('#777').text(data.clinic.footerText, 50, y + 50, { width: 495 })
    }

    doc.end()
  })
}
