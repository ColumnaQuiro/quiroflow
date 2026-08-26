import PDFDocument from 'pdfkit'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// Reuses the exact query shape components/patients/AppointmentsTab.vue already
// builds client-side for the "Visit history" table, so the sent document and
// the on-screen list can't drift apart.
export interface AppointmentHistoryRow {
  startsAt: string
  status: string
  typeName: string | null
  practitionerName: string | null
}
export interface AppointmentHistoryData {
  patient: { firstName: string; lastName: string | null; email: string | null }
  rows: AppointmentHistoryRow[]
}

const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'Missed',
  booked: 'Booked',
}

export async function loadAppointmentHistoryData(supabase: SupabaseClient<Database>, patientId: string): Promise<AppointmentHistoryData | null> {
  const { data: patient } = await supabase.from('patients').select('first_name, last_name, email').eq('id', patientId).maybeSingle()
  if (!patient) return null

  const { data: appointments } = await supabase
    .from('appointments')
    .select('starts_at, status, practitioner_name, appointment_types(name), team_members(full_name)')
    .eq('patient_id', patientId)
    .order('starts_at', { ascending: false })

  const rows: AppointmentHistoryRow[] = (appointments ?? []).map((a) => {
    const type = a.appointment_types as unknown as { name: string } | null
    const teamMember = a.team_members as unknown as { full_name: string } | null
    return {
      startsAt: a.starts_at,
      status: a.status,
      typeName: type?.name ?? null,
      practitionerName: teamMember?.full_name ?? a.practitioner_name ?? null,
    }
  })

  return {
    patient: { firstName: patient.first_name, lastName: patient.last_name, email: patient.email },
    rows,
  }
}

export function generateAppointmentHistoryPdf(data: AppointmentHistoryData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text('Appointment History')
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#555')
      .text(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`)
    doc.moveDown(1)

    doc.fillColor('#000').fontSize(12).font('Helvetica-Bold').text(`${data.patient.firstName} ${data.patient.lastName ?? ''}`.trim())
    doc.moveDown(1.5)

    const col = { date: 50, type: 200, practitioner: 350, status: 470 }
    let y = doc.y
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
    doc.text('Date', col.date, y)
    doc.text('Type', col.type, y)
    doc.text('Practitioner', col.practitioner, y)
    doc.text('Status', col.status, y, { width: 75, align: 'right' })
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
      doc.text(new Date(row.startsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), col.date, y, { width: 140 })
      doc.text(row.typeName ?? 'N/A', col.type, y, { width: 140 })
      doc.text(row.practitionerName ?? 'N/A', col.practitioner, y, { width: 110 })
      doc.text(STATUS_LABEL[row.status] ?? row.status, col.status, y, { width: 75, align: 'right' })
      y += 16
    }

    if (data.rows.length === 0) {
      doc.text('No appointments yet.', col.date, y)
    }

    doc.end()
  })
}
