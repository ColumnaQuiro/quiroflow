import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { certificateLanguage, visitWasAttended } from '~/utils/attendanceCertificate'
import { LETTER_MERGE_FIELDS } from '~/utils/docFields'
import { parseLetterHtml, type LetterRun } from '~/utils/letters'

// Letters (20261023064438_letters.sql): the values a template's merge fields
// are filled with, and the PDF a saved letter prints as.
//
// The letterhead is the justificante's and the receipt's (clinic name, legal
// name, NIF, address, logo), read live: a letter is not a fiscal document,
// and a clinic that has moved wants a reprint to say so.

export interface LetterClinic {
  id: string
  name: string
  legalName: string | null
  address: string | null
  taxId: string | null
  timezone: string
  logoStoragePath: string | null
}

// The clinic asked for, if it is this account's; otherwise the account's
// first, as receipts fall back to.
export async function loadLetterClinic(supabase: SupabaseClient<Database>, accountId: string, clinicId: string | null): Promise<LetterClinic | null> {
  const columns = 'id, name, legal_name, address, tax_id, timezone, logo_storage_path'
  let row = clinicId ? (await supabase.from('clinics').select(columns).eq('id', clinicId).eq('account_id', accountId).maybeSingle()).data : null
  if (!row) row = (await supabase.from('clinics').select(columns).eq('account_id', accountId).order('created_at').limit(1).maybeSingle()).data
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    address: row.address,
    taxId: row.tax_id,
    timezone: row.timezone || DEFAULT_CLINIC_TIMEZONE,
    logoStoragePath: row.logo_storage_path,
  }
}

export interface LetterDraftInput {
  accountId: string
  patientId: string
  clinic: LetterClinic | null
  // visit_notes_access: without it the clinical fields stay blank, as the
  // record hides them.
  clinical: boolean
  authorTeamMemberId: string
}

// Every LETTER_MERGE_FIELDS key, as text. Read with a client that sees all
// of the patient's visits (the route passes the service role, after its own
// patient check): a practitioner whose calendar scope is their own would
// otherwise count only the visits they took.
export async function letterMergeValues(supabase: SupabaseClient<Database>, input: LetterDraftInput): Promise<Record<string, string>> {
  const { accountId, patientId, clinic } = input
  const [{ data: patient }, { data: visits }, { data: author }] = await Promise.all([
    supabase
      .from('patients')
      .select('first_name, last_name, national_id, date_of_birth, address, postal_code, city, chief_complaint, diagnosis, default_practitioner_id, preferred_language')
      .eq('id', patientId)
      .eq('account_id', accountId)
      .maybeSingle(),
    supabase
      .from('appointments')
      .select('starts_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, deleted_at, practitioner_name, team_members(full_name)')
      .eq('patient_id', patientId)
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .lte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: false })
      .limit(5000),
    supabase.from('team_members').select('full_name').eq('id', input.authorTeamMemberId).maybeSingle(),
  ])
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  const attended = (visits ?? []).filter(visitWasAttended)
  const last = attended[0]

  let practitionerName = ''
  if (patient.default_practitioner_id) {
    const { data } = await supabase.from('team_members').select('full_name').eq('id', patient.default_practitioner_id).maybeSingle()
    practitionerName = data?.full_name ?? ''
  }
  if (!practitionerName && last) practitionerName = (last.team_members as unknown as { full_name: string } | null)?.full_name ?? last.practitioner_name ?? ''
  if (!practitionerName) practitionerName = author?.full_name ?? ''

  const lang = certificateLanguage(patient.preferred_language)
  const locale = lang === 'en' ? 'en-GB' : 'es-ES'
  const timeZone = clinic?.timezone ?? DEFAULT_CLINIC_TIMEZONE
  const longDate = (d: Date) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(d)
  // A date of birth is a calendar date, not an instant: no time zone.
  const dob = patient.date_of_birth ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${patient.date_of_birth}T00:00:00Z`)) : ''
  const cityLine = [patient.postal_code, patient.city].filter(Boolean).join(' ')

  return {
    full_name: [patient.first_name, patient.last_name].filter(Boolean).join(' '),
    first_name: patient.first_name ?? '',
    last_name: patient.last_name ?? '',
    national_id: patient.national_id ?? '',
    date_of_birth: dob,
    address: [patient.address, cityLine].filter(Boolean).join(', '),
    today: longDate(new Date()),
    clinic_name: clinic?.name ?? '',
    clinic_tax_id: clinic?.taxId ?? '',
    clinic_address: clinic?.address ?? '',
    practitioner_name: practitionerName,
    last_visit_date: last ? longDate(new Date(last.starts_at)) : '',
    visit_count: String(attended.length),
    chief_complaint: input.clinical ? (patient.chief_complaint ?? '') : '',
    diagnosis: input.clinical ? (patient.diagnosis ?? '') : '',
  }
}

export const CLINICAL_LETTER_FIELDS = LETTER_MERGE_FIELDS.filter((f) => f.clinical).map((f) => f.key)

export async function loadClinicLogo(supabase: SupabaseClient<Database>, path: string | null): Promise<Buffer | null> {
  if (!path) return null
  try {
    const { data: publicUrl } = supabase.storage.from('clinic-logos').getPublicUrl(path)
    const res = await fetch(publicUrl.publicUrl)
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}

export interface LetterPdfInput {
  body: string
  clinic: LetterClinic | null
  logoBuffer: Buffer | null
}

function fontFor(run: LetterRun) {
  if (run.bold && run.italic) return 'Helvetica-BoldOblique'
  if (run.bold) return 'Helvetica-Bold'
  if (run.italic) return 'Helvetica-Oblique'
  return 'Helvetica'
}

export async function generateLetterPdf(input: LetterPdfInput): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // The letterhead, laid out as the justificante's.
    const headerTop = 50
    let logo = input.logoBuffer
    if (logo) {
      try {
        doc.image(logo, 50, headerTop, { fit: [120, 60] })
      } catch {
        // Unsupported image: the letter is still a letter without it.
        logo = null
      }
    }
    if (input.clinic) {
      const x = logo ? 185 : 50
      doc.fillColor('#000').fontSize(14).font('Helvetica-Bold').text(input.clinic.name, x, headerTop + 5)
      doc.fontSize(10).font('Helvetica').fillColor('#555')
      if (input.clinic.legalName && input.clinic.legalName !== input.clinic.name) doc.text(input.clinic.legalName, x)
      if (input.clinic.taxId) doc.text(`NIF: ${input.clinic.taxId}`, x)
      if (input.clinic.address) doc.text(input.clinic.address, x)
    }
    doc.y = Math.max(doc.y, headerTop + (logo ? 70 : 0)) + 36

    const left = 50
    const width = 495
    const indent = 18
    doc.fillColor('#111').fontSize(11)
    let previous: string | null = null
    for (const block of parseLetterHtml(input.body)) {
      // A list's items sit close together; the paragraph after one does not.
      if (previous === 'li' && block.kind === 'p') doc.moveDown(0.4)
      previous = block.kind
      if (!block.runs.length && block.kind === 'p') {
        doc.moveDown(0.8)
        continue
      }
      const x = block.kind === 'li' ? left + indent : left
      const w = block.kind === 'li' ? width - indent : width
      const y = doc.y
      if (block.kind === 'li') {
        doc.font('Helvetica').text(block.ordered ? `${block.index}.` : '•', left, y, { width: indent, lineBreak: false })
        doc.y = y
      }
      // A <br> is its own run; each line between them is one chain of
      // continued text, since pdfkit does not break a continued line on "\n".
      const lines: LetterRun[][] = [[]]
      for (const run of block.runs) {
        if (run.text === '\n') lines.push([])
        else lines[lines.length - 1]!.push(run)
      }
      lines.forEach((line, l) => {
        const runs = line.length ? line : [{ text: ' ' }]
        runs.forEach((run, i) => {
          const options = { width: w, lineGap: 3, continued: i < runs.length - 1, underline: !!run.underline }
          doc.font(fontFor(run))
          if (i === 0) doc.text(run.text, x, l === 0 ? y : doc.y, options)
          else doc.text(run.text, options)
        })
      })
      doc.moveDown(block.kind === 'li' ? 0.2 : 0.6)
    }

    doc.end()
  })
}
