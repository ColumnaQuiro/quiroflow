import { stripHtml } from './practiceHubStickyNotes'
import { wallClockToUtc } from './clinicClock'

// The Patients and Appointments importers were written against PracticeHub's
// CSV exports, which a clinic has to download by hand from Settings -> Data
// Exports. Everything in them is also in PracticeHub's Classic API -- the same
// one every other import step already reads -- so these turn API records into
// the rows the importers already understand, and the clinic pastes a key
// instead of exporting two files.
//
// The API is also the more correct source, in two ways the CSV is not:
//
// - "Patient Number" in the CSV is the patient's CUSTOM reference (a DNI, a
//   passport) whenever they have one. Every later step matches on the real
//   patient number, so those patients' payments and bonos silently never
//   arrived (utils/practicehubReferences.ts). Here it is always the number.
//
// Appointment times are the clinic's wall clock in both ("2026-08-06
// 17:30:00", no zone), while created dates are UTC in both. The importer read
// appointment times in the browser's time zone, which is only right when
// whoever runs the import sits in the clinic's; practiceHubWallClock reads them
// in the clinic's.
//
// Checked field by field against a live export of 1,531 patients and 8,667
// appointments on 30 Oct 2026: every field below agreed, apart from records
// edited since the export.

/** A Classic /patients record, as far as the import reads it. */
export interface PHApiPatient {
  id: number | string
  patient_number: string | number | null
  custom_reference?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  dob?: string | null
  created?: string | null
  balance?: string | number | null
  locale?: string | null
  note?: string | null
  numbers?: { number: string | null; type?: string | null; iso2?: string | null }[] | null
  communication_preferences?: { marketing?: { sms?: number | boolean | null; email?: number | boolean | null } | null } | null
  default_practitioners?: { practitioner_id: number | string }[] | null
  referral_source_type?: string | null
  referral_source_id?: number | string | null
}

/** A Classic /appointments record, as far as the import reads it. */
export interface PHApiAppointment {
  id: number | string
  patient_id: number | string | null
  practitioner_id?: number | string | null
  appointment_type_id?: number | string | null
  start: string | null
  end: string | null
  status?: string | null
  note?: string | null
}

export interface PHNamed {
  id: number | string
  name?: string | null
  first_name?: string | null
  last_name?: string | null
}

type Row = Record<string, string>

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function nameOf(record: PHNamed | undefined): string {
  if (!record) return ''
  return text(record.name) || `${text(record.first_name)} ${text(record.last_name)}`.trim()
}

function byId<T extends { id: number | string }>(records: T[]): Map<string, T> {
  // Ids arrive as numbers from one endpoint and strings from another
  // (/patients has referral_source_id: "12" against /referral_sources id: 12).
  return new Map(records.map((r) => [String(r.id), r]))
}

/**
 * A PracticeHub created/updated timestamp as an ISO instant. These are UTC:
 * the CSV's "Patient Created" writes it with no zone ("2024-03-05 09:15:00"),
 * which `new Date()` would read as the browser's local time. Not for
 * appointment times, which are the clinic's wall clock (practiceHubWallClock).
 */
export function practiceHubUtc(value: string | null | undefined): string {
  const raw = text(value)
  if (!raw) return ''
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
  const d = new Date(hasZone ? raw : `${raw.replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/**
 * A PracticeHub appointment time ("2026-08-06 17:30:00", the clinic's wall
 * clock) as the instant it is in `timeZone`. A value carrying a zone is read
 * as it says. Null when it is not a time.
 */
export function practiceHubWallClock(value: string | null | undefined, timeZone: string): Date | null {
  const raw = text(value)
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  return new Date(wallClockToUtc(m[1], `${m[2]}:${m[3]}`, timeZone) + Number(m[4] ?? 0) * 1000)
}

const flag = (value: unknown) => (value === true || value === 1 || value === '1' ? '1' : '0')

/** Patients in the shape of the CSV export's rows, keyed by PracticeHub's patient number. */
export function practiceHubPatientRows(
  patients: PHApiPatient[],
  lookups: { practitioners: PHNamed[]; referralSources: PHNamed[]; tagsByPatientNumber?: Map<string, string[]> },
): Row[] {
  const practitioners = byId(lookups.practitioners)
  const sources = byId(lookups.referralSources)
  const patientsById = byId(patients)

  return patients.map((p) => {
    const patientNumber = text(p.patient_number)
    const numbers = (p.numbers ?? []).filter((n) => text(n.number))
    // The CSV has one Mobile and one Home column; the API has every number.
    // The rest go in "Other Numbers", so a second mobile is not dropped.
    const mobile = numbers.find((n) => text(n.type).toLowerCase() === 'mobile')
    const home = numbers.find((n) => text(n.type).toLowerCase() === 'home')
    const others = numbers.filter((n) => n !== mobile && n !== home)

    let referral = ''
    if (p.referral_source_type === 'referral_source') referral = nameOf(sources.get(text(p.referral_source_id)))
    // Referred by another patient: the CSV names them, so this does too. A
    // referrer since deleted has no name to give, and the CSV leaves it blank.
    else if (p.referral_source_type === 'patient') referral = nameOf(patientsById.get(text(p.referral_source_id)))

    const marketing = p.communication_preferences?.marketing
    return {
      'Patient Number': patientNumber,
      'First Name': text(p.first_name),
      'Last Name': text(p.last_name),
      'Email Address': text(p.email),
      'Date of Birth': text(p.dob),
      'Patient Created': practiceHubUtc(p.created),
      'Account Balance': text(p.balance),
      'Preferred Language': text(p.locale),
      'Note': stripHtml(text(p.note)),
      'Mobile': text(mobile?.number),
      'Home': text(home?.number),
      'Other Numbers': others.map((n) => text(n.number)).join('\n'),
      'SMS Marketing': flag(marketing?.sms),
      'Email Marketing': flag(marketing?.email),
      'Default Practitioner': nameOf(practitioners.get(text(p.default_practitioners?.[0]?.practitioner_id))),
      'Referral Source': referral,
      'Tags': (lookups.tagsByPatientNumber?.get(patientNumber) ?? []).join(', '),
    }
  })
}

/** Appointments in the shape of the CSV export's rows. */
export function practiceHubAppointmentRows(
  appointments: PHApiAppointment[],
  lookups: { patients: PHApiPatient[]; practitioners: PHNamed[]; appointmentTypes: PHNamed[] },
): Row[] {
  const patients = byId(lookups.patients)
  const practitioners = byId(lookups.practitioners)
  const types = byId(lookups.appointmentTypes)

  return appointments.map((a) => ({
    'Internal Appt ID': text(a.id),
    // Blank for a patient PracticeHub has since deleted; the importer counts
    // those as having no patient, as it does for the CSV.
    'Patient Number': text(patients.get(text(a.patient_id))?.patient_number),
    // As PracticeHub gives them, like the CSV: the clinic's wall clock.
    'Start': text(a.start),
    'End': text(a.end),
    'Practitioner': nameOf(practitioners.get(text(a.practitioner_id))),
    'Appointment Type': nameOf(types.get(text(a.appointment_type_id))),
    'Status': text(a.status),
    'Note': stripHtml(text(a.note)),
  }))
}

/**
 * The CSV's "Patient Number", corrected to PracticeHub's real patient number
 * when it is a custom reference instead. Unchanged when nothing says otherwise.
 */
export function practiceHubPatientNumberMap(patients: Pick<PHApiPatient, 'patient_number' | 'custom_reference'>[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const p of patients) {
    const custom = text(p.custom_reference)
    const number = text(p.patient_number)
    if (custom && number) map.set(custom, number)
  }
  return map
}
