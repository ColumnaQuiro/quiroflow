import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { attendanceCertificateText, certificateLanguage, visitWasAttended, type AttendanceCertificateText } from '~/utils/attendanceCertificate'

// A justificante de asistencia for one visit, as a PDF -- see
// utils/attendanceCertificate.ts for what it says and why it says nothing
// clinical. The clinic header is the receipt's (name, legal name, NIF,
// address, logo), read live like the receipt's: this is not a fiscal
// document and a clinic that has moved wants a reprint to say so.

export interface AttendanceCertificateData {
  patientId: string
  text: AttendanceCertificateText
  clinic: { name: string; legalName: string | null; address: string | null; taxId: string | null } | null
  logoBuffer: Buffer | null
  language: 'es' | 'en'
}

export type CertificateLoad = { ok: true; data: AttendanceCertificateData } | { ok: false; reason: 'not_found' | 'not_attended' }

export async function loadAttendanceCertificateData(
  supabase: SupabaseClient<Database>,
  accountId: string,
  appointmentId: string,
  language?: string | null,
): Promise<CertificateLoad> {
  const { data: appt } = await supabase
    .from('appointments')
    .select('id, patient_id, clinic_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, deleted_at, practitioner_name, team_members(full_name)')
    .eq('id', appointmentId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!appt || !appt.patient_id) return { ok: false, reason: 'not_found' }
  if (!visitWasAttended(appt)) return { ok: false, reason: 'not_attended' }

  const [{ data: patient }, { data: clinic }] = await Promise.all([
    supabase.from('patients').select('first_name, last_name, national_id, preferred_language').eq('id', appt.patient_id).maybeSingle(),
    supabase.from('clinics').select('name, legal_name, address, tax_id, timezone, logo_storage_path').eq('id', appt.clinic_id).maybeSingle(),
  ])
  if (!patient) return { ok: false, reason: 'not_found' }

  let logoBuffer: Buffer | null = null
  if (clinic?.logo_storage_path) {
    try {
      const { data: publicUrl } = supabase.storage.from('clinic-logos').getPublicUrl(clinic.logo_storage_path)
      const res = await fetch(publicUrl.publicUrl)
      if (res.ok) logoBuffer = Buffer.from(await res.arrayBuffer())
    } catch {
      logoBuffer = null
    }
  }

  const lang = certificateLanguage(language ?? patient.preferred_language)
  const teamMember = appt.team_members as unknown as { full_name: string } | null
  const text = attendanceCertificateText({
    patientName: [patient.first_name, patient.last_name].filter(Boolean).join(' '),
    nationalId: patient.national_id,
    clinicName: clinic?.legal_name || clinic?.name || '',
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
    timeZone: clinic?.timezone || DEFAULT_CLINIC_TIMEZONE,
    practitionerName: teamMember?.full_name ?? appt.practitioner_name ?? null,
    issuedAt: new Date(),
    language: lang,
  })

  return {
    ok: true,
    data: {
      patientId: appt.patient_id,
      text,
      clinic: clinic ? { name: clinic.name, legalName: clinic.legal_name, address: clinic.address, taxId: clinic.tax_id } : null,
      logoBuffer,
      language: lang,
    },
  }
}

export async function generateAttendanceCertificatePdf(data: AttendanceCertificateData): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const headerTop = 50
    if (data.logoBuffer) {
      try {
        doc.image(data.logoBuffer, 50, headerTop, { fit: [120, 60] })
      } catch {
        // Unsupported image: the certificate is still valid without it.
        data.logoBuffer = null
      }
    }
    if (data.clinic) {
      const x = data.logoBuffer ? 185 : 50
      doc.fillColor('#000').fontSize(14).font('Helvetica-Bold').text(data.clinic.name, x, headerTop + 5)
      doc.fontSize(10).font('Helvetica').fillColor('#555')
      if (data.clinic.legalName && data.clinic.legalName !== data.clinic.name) doc.text(data.clinic.legalName, x)
      if (data.clinic.taxId) doc.text(`${data.language === 'en' ? 'Tax ID' : 'NIF'}: ${data.clinic.taxId}`, x)
      if (data.clinic.address) doc.text(data.clinic.address, x)
    }

    doc.x = 50
    doc.y = Math.max(doc.y, headerTop + 70) + 40
    doc.fillColor('#000').fontSize(18).font('Helvetica-Bold').text(data.text.title, 50, doc.y, { width: 495, align: 'center' })
    doc.moveDown(2)
    doc.fontSize(12).font('Helvetica').fillColor('#111').text(data.text.body, 50, doc.y, { width: 495, align: 'justify', lineGap: 4 })
    doc.moveDown(1.2)
    doc.text(data.text.closing, { width: 495, align: 'justify', lineGap: 4 })

    doc.moveDown(4)
    const signTop = doc.y
    doc.moveTo(320, signTop + 50).lineTo(545, signTop + 50).strokeColor('#999').stroke()
    doc.fontSize(10).fillColor('#555').text(data.text.signatureLabel, 320, signTop + 56, { width: 225, align: 'center' })
    if (data.text.practitionerLine) doc.text(data.text.practitionerLine, 320, doc.y + 2, { width: 225, align: 'center' })

    doc.end()
  })
}
