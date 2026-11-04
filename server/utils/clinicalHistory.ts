import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { parseVisitNote, type NoteSection } from '~/utils/visitNote'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { loadClinicLogo, loadLetterClinic, type LetterClinic } from '~/server/utils/letterData'

// "Download PDF" on the patient's Clinical tab: every visit note, in one
// document, on the clinic's letterhead. Asked for on 4 Nov 2026 by a
// practitioner who could only read the notes one at a time on screen and was
// used to PracticeHub handing over the whole history as a file -- for writing
// a report, or for the patient who asks how their care has gone.
//
// Reads the same rows components/patients/ClinicalTab.vue shows, with the
// caller's own client: visit_notes RLS (visit_notes_access) decides what is
// in it, exactly as it decides what is on screen.
//
// Oldest visit first, unlike the screen. The screen answers "what did I do
// last time"; a history on paper is read as a course of care, start to end.

export type ClinicalHistoryLang = 'es' | 'en'

export interface ClinicalHistoryNote {
  visitAt: string
  typeName: string | null
  practitionerName: string | null
  body: string
}

export interface ClinicalHistoryData {
  patient: {
    fullName: string
    dateOfBirth: string | null
    chiefComplaint: string | null
    diagnosis: string | null
    redFlags: string | null
    yellowFlags: string | null
    goals: string | null
  }
  notes: ClinicalHistoryNote[]
  clinic: LetterClinic | null
  logoBuffer: Buffer | null
  generatedBy: string | null
}

export async function loadClinicalHistoryData(
  supabase: SupabaseClient<Database>,
  accountId: string,
  patientId: string,
  teamMemberId: string,
): Promise<ClinicalHistoryData | null> {
  const [{ data: patient }, { data: rows }, { data: me }] = await Promise.all([
    supabase
      .from('patients')
      .select('first_name, last_name, date_of_birth, chief_complaint, diagnosis, red_flags, yellow_flags, goals, clinic_id')
      .eq('id', patientId)
      .eq('account_id', accountId)
      .maybeSingle(),
    supabase
      .from('visit_notes')
      .select('body, created_at, appointments!inner(starts_at, patient_id, appointment_types(name), team_members(full_name), practitioner_name)')
      .eq('appointments.patient_id', patientId),
    supabase.from('team_members').select('full_name').eq('id', teamMemberId).maybeSingle(),
  ])
  if (!patient) return null

  const clinic = await loadLetterClinic(supabase, accountId, patient.clinic_id)
  const logoBuffer = await loadClinicLogo(supabase, clinic?.logoStoragePath ?? null)

  const notes = (rows ?? [])
    .map((row) => {
      const appt = row.appointments as unknown as {
        starts_at: string
        appointment_types: { name: string } | null
        team_members: { full_name: string } | null
        practitioner_name: string | null
      } | null
      return {
        visitAt: appt?.starts_at ?? row.created_at,
        typeName: appt?.appointment_types?.name ?? null,
        practitionerName: appt?.team_members?.full_name ?? appt?.practitioner_name ?? null,
        body: row.body,
      }
    })
    .filter((n) => n.body?.trim())
    .sort((a, b) => a.visitAt.localeCompare(b.visitAt))

  const trimmed = (v: string | null) => v?.trim() || null
  return {
    patient: {
      fullName: [patient.first_name, patient.last_name].filter(Boolean).join(' '),
      dateOfBirth: patient.date_of_birth,
      chiefComplaint: trimmed(patient.chief_complaint),
      diagnosis: trimmed(patient.diagnosis),
      redFlags: trimmed(patient.red_flags),
      yellowFlags: trimmed(patient.yellow_flags),
      goals: trimmed(patient.goals),
    },
    notes,
    clinic,
    logoBuffer,
    generatedBy: me?.full_name ?? null,
  }
}

const LABELS = {
  es: {
    title: 'Historial clínico',
    born: 'Fecha de nacimiento',
    generated: (date: string, by: string | null) => (by ? `Generado el ${date} por ${by}` : `Generado el ${date}`),
    chiefComplaint: 'Motivo de consulta',
    diagnosis: 'Diagnóstico de trabajo',
    redFlags: 'Señales rojas',
    yellowFlags: 'Señales amarillas',
    goals: 'Objetivos',
    notes: (n: number) => `Notas de visita (${n})`,
    none: 'No hay notas de visita.',
    author: 'Autor sin registrar',
    page: (i: number, n: number) => `Página ${i} de ${n}`,
    confidential: 'Documento confidencial con datos de salud.',
    sections: { Subjective: 'Subjetivo', Objective: 'Objetivo', Action: 'Actuación', Plan: 'Plan' } as Record<NoteSection, string>,
  },
  en: {
    title: 'Clinical history',
    born: 'Date of birth',
    generated: (date: string, by: string | null) => (by ? `Generated on ${date} by ${by}` : `Generated on ${date}`),
    chiefComplaint: 'Chief complaint',
    diagnosis: 'Working diagnosis',
    redFlags: 'Red flags',
    yellowFlags: 'Yellow flags',
    goals: 'Goals',
    notes: (n: number) => `Visit notes (${n})`,
    none: 'No visit notes.',
    author: 'Author not recorded',
    page: (i: number, n: number) => `Page ${i} of ${n}`,
    confidential: 'Confidential document containing health data.',
    sections: { Subjective: 'Subjective', Objective: 'Objective', Action: 'Action', Plan: 'Plan' } as Record<NoteSection, string>,
  },
}

// The standard PDF fonts only carry WinAnsi (Latin-1 plus a few, which covers
// Spanish, the euro sign and typographic quotes). Notes are typed freely, and
// an arrow or a ≥ outside that set prints as garbage rather than failing, so
// the common ones are spelled out and anything else is replaced visibly.
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const SPELLED: Record<string, string> = { '→': '->', '←': '<-', '↑': '^', '↓': 'v', '≥': '>=', '≤': '<=', '≠': '!=', '✓': 'OK', '✔': 'OK', '−': '-', '\t': '    ' }
export function pdfSafe(text: string): string {
  let out = ''
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!
    if (ch in SPELLED) out += SPELLED[ch]
    else if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(ch)) out += ch
    else if (code < 0x20) continue
    else out += '?'
  }
  return out
}

export async function generateClinicalHistoryPdf(data: ClinicalHistoryData, lang: ClinicalHistoryLang, now = new Date()): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  const L = LABELS[lang]
  const locale = lang === 'en' ? 'en-GB' : 'es-ES'
  const timeZone = data.clinic?.timezone ?? DEFAULT_CLINIC_TIMEZONE
  const longDate = (d: Date) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(d)
  // A date of birth is a calendar date, not an instant: no time zone.
  const dob = data.patient.dateOfBirth
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.patient.dateOfBirth}T00:00:00Z`))
    : null

  return new Promise((resolve, reject) => {
    // bufferPages so the footer can say "page i of n" once n is known.
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 60, left: 50, right: 50 }, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const left = 50
    const width = 495
    const bottom = doc.page.height - 60

    // The letterhead, as letters and the justificante lay it out.
    const headerTop = 50
    let logo = data.logoBuffer
    if (logo) {
      try {
        doc.image(logo, left, headerTop, { fit: [120, 60] })
      } catch {
        logo = null
      }
    }
    if (data.clinic) {
      const x = logo ? 185 : left
      doc.fillColor('#000').fontSize(14).font('Helvetica-Bold').text(pdfSafe(data.clinic.name), x, headerTop + 5)
      doc.fontSize(10).font('Helvetica').fillColor('#555')
      if (data.clinic.legalName && data.clinic.legalName !== data.clinic.name) doc.text(pdfSafe(data.clinic.legalName), x)
      if (data.clinic.taxId) doc.text(`NIF: ${pdfSafe(data.clinic.taxId)}`, x)
      if (data.clinic.address) doc.text(pdfSafe(data.clinic.address), x)
    }
    doc.y = Math.max(doc.y, headerTop + (logo ? 70 : 0)) + 28

    doc.fillColor('#000').fontSize(18).font('Helvetica-Bold').text(L.title, left, doc.y, { width })
    doc.moveDown(0.3)
    doc.fontSize(12).font('Helvetica-Bold').text(pdfSafe(data.patient.fullName), { width })
    doc.fontSize(9.5).font('Helvetica').fillColor('#555')
    if (dob) doc.text(`${L.born}: ${dob}`, { width })
    doc.text(pdfSafe(L.generated(longDate(now), data.generatedBy)), { width })
    doc.moveDown(1)

    // Keeps a heading with the first lines under it rather than stranding it
    // at the foot of a page.
    function room(needed: number) {
      if (doc.y + needed > bottom) doc.addPage()
    }

    function field(label: string, value: string | null) {
      if (!value) return
      const text = pdfSafe(value)
      room(34)
      doc.fillColor('#777').fontSize(8).font('Helvetica-Bold').text(label.toUpperCase(), left, doc.y, { width, characterSpacing: 0.4 })
      doc.moveDown(0.15)
      doc.fillColor('#111').fontSize(10.5).font('Helvetica').text(text, { width, lineGap: 2 })
      doc.moveDown(0.6)
    }

    const p = data.patient
    field(L.chiefComplaint, p.chiefComplaint)
    field(L.diagnosis, p.diagnosis)
    field(L.redFlags, p.redFlags)
    field(L.yellowFlags, p.yellowFlags)
    field(L.goals, p.goals)

    room(40)
    doc.moveDown(0.4)
    doc.fillColor('#000').fontSize(13).font('Helvetica-Bold').text(L.notes(data.notes.length), left, doc.y, { width })
    doc
      .moveTo(left, doc.y + 4)
      .lineTo(left + width, doc.y + 4)
      .strokeColor('#ccc')
      .stroke()
    doc.moveDown(0.8)

    if (data.notes.length === 0) {
      doc.fillColor('#555').fontSize(10.5).font('Helvetica').text(L.none, left, doc.y, { width })
    }

    for (const note of data.notes) {
      room(70)
      const heading = [longDate(new Date(note.visitAt)), note.typeName].filter(Boolean).join(' · ')
      doc.fillColor('#000').fontSize(11.5).font('Helvetica-Bold').text(pdfSafe(heading), left, doc.y, { width })
      doc.fillColor('#666').fontSize(9).font('Helvetica').text(pdfSafe(note.practitionerName ?? L.author), { width })
      doc.moveDown(0.4)

      // Structured notes keep their sections; anything else is printed as
      // written, as the Clinical tab shows it.
      const parsed = parseVisitNote(note.body)
      for (const section of parsed.sections) field(L.sections[section.label], section.text)
      if (parsed.preamble) {
        room(24)
        doc.fillColor('#111').fontSize(10.5).font('Helvetica').text(pdfSafe(parsed.preamble), left, doc.y, { width, lineGap: 2 })
        doc.moveDown(0.6)
      }

      doc
        .moveTo(left, doc.y + 2)
        .lineTo(left + width, doc.y + 2)
        .strokeColor('#e5e5e5')
        .stroke()
      doc.moveDown(1)
    }

    // The footer goes on afterwards, page by page. Writing below the bottom
    // margin would make pdfkit start a new page, so it is lifted for the
    // footer and put back.
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      const marginBottom = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      const y = doc.page.height - 40
      doc.fillColor('#888').fontSize(8).font('Helvetica')
      doc.text(pdfSafe(`${p.fullName} · ${L.confidential}`), left, y, { width: width - 80, lineBreak: false })
      doc.text(L.page(i - range.start + 1, range.count), left + width - 80, y, { width: 80, align: 'right', lineBreak: false })
      doc.page.margins.bottom = marginBottom
    }

    doc.end()
  })
}
