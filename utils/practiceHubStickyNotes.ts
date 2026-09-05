// Pure helpers behind the PracticeHub Sticky Notes importer
// (components/import/PracticeHubStickyNotesImporter.vue). Kept out of the
// component so the field-detection and note-normalisation rules -- the parts
// that have to survive PracticeHub returning something unexpected -- can be
// reasoned about (and exercised) on their own.

// Only `id` and `patient_number` are relied on; the rest of the record is
// read dynamically, since which key carries the sticky note is exactly what
// has to be discovered.
export type PracticeHubPatientRecord = Record<string, unknown> & { patient_number?: unknown }

// PracticeHub's public API reference is behind their SSO, and the field
// mapping guessed from their docs' example responses has already been wrong
// twice on this migration (see PracticeHubPatientPackagesImporter.vue). So
// rather than hard-coding one key and silently importing nothing when it's
// named something else, find it in the response itself -- exact matches
// first, then anything containing "sticky".
//
// It turned out to be wrong a third time: the real API calls it plain `note`,
// with nothing sticky-sounding anywhere in the response, so the importer
// reported "No sticky note field found" and refused to guess. Checked against
// the live API before adding it -- of 100 patients, 61 had a `note`, running
// 21 to 594 characters (median 188), which is sticky-note length rather than
// long-form clinical notes, and the content is what you'd expect on one
// ("le toca pagar 40 euros...", posture/health percentage summaries). It
// arrives as an HTML fragment, which stripHtml below already handles.
//
// `note` goes last on purpose. It is the most generic name here, so any
// instance that does return a sticky-specific key still wins over it -- and
// the preview names the field it settled on ("Reading from PracticeHub field:
// note") so a wrong guess is visible before anything is written.
const STICKY_CANDIDATES = ['sticky_note', 'sticky_notes', 'stickynote', 'sticky']
const FALLBACK_CANDIDATES = ['note']

export function collectFieldNames(records: PracticeHubPatientRecord[]): string[] {
  const keys = new Set<string>()
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    for (const key of Object.keys(record)) keys.add(key)
  }
  return [...keys].sort()
}

// Not every patient has a sticky note, so the key can be absent from the
// first few records and present later -- this looks across all of them.
export function detectStickyField(records: PracticeHubPatientRecord[]): string | null {
  const keys = collectFieldNames(records)
  for (const candidate of STICKY_CANDIDATES) {
    const exact = keys.find((key) => key.toLowerCase() === candidate)
    if (exact) return exact
  }
  const sticky = keys.find((key) => key.toLowerCase().includes('sticky'))
  if (sticky) return sticky
  // Only once nothing sticky-named exists at all: anything explicitly named
  // "sticky" is a better answer than the generic `note` this falls back to.
  for (const candidate of FALLBACK_CANDIDATES) {
    const exact = keys.find((key) => key.toLowerCase() === candidate)
    if (exact) return exact
  }
  return null
}

// PracticeHub stores several of its free-text fields as HTML fragments (the
// patient log importer hits the same thing), so a sticky note can arrive as
// "Alergia<br>al latex" rather than plain text.
export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export function readStickyNote(record: PracticeHubPatientRecord, field: string): string {
  const raw = record[field]
  if (typeof raw !== 'string' && typeof raw !== 'number') return ''
  return stripHtml(String(raw))
}

export interface ExistingPatient {
  id: string
  label: string
  sticky: string | null
}

export interface StickyNoteCandidate {
  patientId: string
  label: string
  patientNumber: string
  current: string | null
  next: string
}

export interface StickyNotePlan {
  candidates: StickyNoteCandidate[]
  skippedEmpty: number
  skippedUnmatched: number
  skippedUnchanged: number
}

// Sticky notes only ever land on a patient that's already here -- this never
// creates patients, so running it before the Patients import just reports
// everything as unmatched rather than half-populating records.
export function buildStickyNotePlan(
  records: PracticeHubPatientRecord[],
  field: string,
  existingByPatientNumber: Map<string, ExistingPatient>,
): StickyNotePlan {
  const plan: StickyNotePlan = { candidates: [], skippedEmpty: 0, skippedUnmatched: 0, skippedUnchanged: 0 }

  for (const record of records) {
    const note = readStickyNote(record, field)
    if (!note) {
      plan.skippedEmpty++
      continue
    }
    const patientNumber = record.patient_number === null || record.patient_number === undefined ? '' : String(record.patient_number)
    const existing = patientNumber ? existingByPatientNumber.get(patientNumber) : undefined
    if (!existing) {
      plan.skippedUnmatched++
      continue
    }
    // Re-runnable: a note already matching what PracticeHub holds is left
    // alone, so a second pass after fixing a few stragglers is a no-op.
    if ((existing.sticky ?? '') === note) {
      plan.skippedUnchanged++
      continue
    }
    plan.candidates.push({
      patientId: existing.id,
      label: existing.label,
      patientNumber,
      current: existing.sticky,
      next: note,
    })
  }

  return plan
}
