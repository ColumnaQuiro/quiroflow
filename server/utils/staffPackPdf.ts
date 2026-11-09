import { formatWorked } from '~/utils/workday'
import { packAbsenceText, payLineLabel, type PackPerson } from '~/utils/staffGestoriaPack'

// The gestoría pack as a PDF to read: one block per person, employees first
// and autónomos/socios apart. pdfkit is imported inside the function, not at
// the top: everything under server/utils is evaluated on every cold start.
const eur = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`
const num = (n: number) => String(n).replace('.', ',')

export async function staffPackPdf(pack: { employees: PackPerson[]; others: PackPerson[] }, month: string, employer: { name: string; taxId: string | null }): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text('Datos para las nóminas')
    doc.fontSize(10).font('Helvetica').fillColor('#333')
    doc.text(`Empresa: ${employer.name}${employer.taxId ? ` · CIF/NIF ${employer.taxId}` : ''}`)
    doc.text(`Periodo: ${monthName}`)
    doc.fillColor('#666').text('Cifras del mes según QuiroFlow: jornada fichada, ausencias aprobadas y retribución variable. No es una nómina.')
    doc.moveDown(1)

    const person = (p: PackPerson, employee: boolean) => {
      if (doc.y > 700) doc.addPage()
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text(p.name)
      doc.fontSize(9.5).font('Helvetica').fillColor('#333')
      doc.text([p.employmentLabel, p.modality, p.weeklyHours ? `${num(p.weeklyHours)} h/semana` : ''].filter(Boolean).join(' · '))
      doc.text(`Días trabajados: ${p.daysWorked} · Horas fichadas: ${formatWorked(p.minutesClocked)}${p.contractedMinutes !== null ? ` · Según contrato: ${formatWorked(p.contractedMinutes)}` : ''}`)
      if (employee) doc.text(`Vacaciones este mes: ${num(p.holidayDaysThisMonth)} días · Le quedan este año: ${p.holidayDaysLeft === null ? '—' : num(p.holidayDaysLeft)} días`)
      doc.text(`Ausencias: ${p.absences.length ? p.absences.map((a) => packAbsenceText(a)).join('; ') : 'ninguna'}`)
      if (p.payCents !== null) {
        doc.text(`${employee ? 'Retribución variable' : 'A facturar'}: ${eur(p.payCents)}`)
        for (const l of p.payLines) doc.text(`   ${payLineLabel(l.key)}: ${eur(l.cents)}${l.detail ? ` (${l.detail})` : ''}`)
      }
      if (p.contractChanges.length) doc.text(`Cambios de contrato: ${p.contractChanges.join('; ')}`)
      doc.moveDown(0.8)
    }

    doc.fontSize(13).font('Helvetica-Bold').fillColor('#000').text('Personal en nómina')
    doc.moveDown(0.4)
    if (!pack.employees.length) doc.fontSize(10).font('Helvetica').text('Nadie este mes.').moveDown(0.8)
    for (const p of pack.employees) person(p, true)
    if (pack.others.length) {
      doc.moveDown(0.5)
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#000').text('Autónomos y socios')
      doc.fontSize(9.5).font('Helvetica').fillColor('#666').text('Lo que sale de su retribución es lo que facturan, no una línea de nómina.')
      doc.moveDown(0.4)
      for (const p of pack.others) person(p, false)
    }
    doc.end()
  })
}
