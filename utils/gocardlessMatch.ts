// Which patient a GoCardless customer is, suggested for a person to confirm.
//
// A clinic coming from PracticeHub has its patients' mandates in its own
// GoCardless account, created against GoCardless CUSTOMERS that know nothing
// of QuiroFlow. Pairing them is a suggestion, never an automatic write: the
// import screen shows it and a member of staff confirms, changes or skips it.
// A wrong pair would charge one patient's membership to another's bank.
//
// Pure: no database, no network.

export interface MatchablePatient {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  /** patients.phone_search: every contact number as its digits, space-separated (20261118122723). */
  phone_search: string | null
}

export interface MatchableCustomer {
  email: string | null
  given_name: string | null
  family_name: string | null
  company_name: string | null
  phone_number: string | null
  metadata?: Record<string, string> | null
}

/**
 * `metadata` is our own patient id read back from the GoCardless customer
 * (GOCARDLESS_PATIENT_METADATA_KEY): someone confirmed that pair before.
 * `loose` marks a name that is only similar ("J. Muestra" for "Jorge
 * Muestra"), which the screen labels differently from the same name.
 */
export type MandateMatch =
  | { patientId: string; by: 'metadata' | 'email' | 'phone' | 'name'; loose?: boolean }
  | { patientId: null; by: null; ambiguous: boolean }

/** The key QuiroFlow writes its patient id under on a GoCardless customer. */
export const GOCARDLESS_PATIENT_METADATA_KEY = 'quiroflow_patient_id'
const GOCARDLESS_METADATA_MAX_KEYS = 3

/**
 * The customer metadata to write so it names `patientId` (or, given null, no
 * longer names anyone), or null when nothing should be written.
 *
 * A metadata update REPLACES the whole object and GoCardless allows three
 * keys, which other apps on the account (PracticeHub) may be using: their
 * keys are kept, and when all three are theirs ours is not written at all.
 */
export function mergedCustomerMetadata(current: Record<string, string> | null | undefined, patientId: string | null): Record<string, string> | null {
  const existing = { ...(current ?? {}) }
  const ours = existing[GOCARDLESS_PATIENT_METADATA_KEY]
  if (patientId) {
    if (ours === patientId) return null
    if (ours === undefined && Object.keys(existing).length >= GOCARDLESS_METADATA_MAX_KEYS) return null
    return { ...existing, [GOCARDLESS_PATIENT_METADATA_KEY]: patientId }
  }
  if (ours === undefined) return null
  delete existing[GOCARDLESS_PATIENT_METADATA_KEY]
  return existing
}

/** Lower case, accents and punctuation gone, single spaces: "José  García-Pérez" -> "jose garcia perez". */
export function mandateNameKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The last nine digits, which is a Spanish number whatever prefix it was written with. */
function phoneKey(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : null
}

const tokens = (value: string | null | undefined) => mandateNameKey(value).split(' ').filter(Boolean)

/**
 * Whether a customer's name could be this patient's when it is not the same
 * name: an initial for the first name ("J. Muestra"), or one surname where
 * the patient has two ("Jorge Muestra" for "Jorge Muestra Ejemplo"). The
 * first name has to agree on its first word or initial, and every surname
 * the customer gives has to be one of the patient's.
 */
function looselyNamed(givenName: string | null, familyName: string | null, patient: MatchablePatient): boolean {
  const given = tokens(givenName)
  const family = tokens(familyName)
  const first = tokens(patient.first_name)
  const last = tokens(patient.last_name)
  if (!given.length || !family.length || !first.length || !last.length) return false
  const g = given[0]!
  const p = first[0]!
  const firstAgrees = g === p || (g.length === 1 && p.startsWith(g)) || (p.length === 1 && g.startsWith(p))
  return firstAgrees && family.every((f) => last.includes(f))
}

/**
 * The patient a customer most likely is. Tries our own patient id on the
 * customer, then email, then phone, then full name, then a similar name, and
 * only accepts a criterion that points at exactly ONE patient: two patients
 * sharing an email (a parent and a child, often) is not a match, it is a
 * question for whoever is looking at the screen.
 */
export function suggestMandatePatient(customer: MatchableCustomer, patients: MatchablePatient[]): MandateMatch {
  let ambiguous = false
  const only = (candidates: MatchablePatient[]) => {
    if (candidates.length > 1) ambiguous = true
    return candidates.length === 1 ? candidates[0]!.id : null
  }

  const tagged = customer.metadata?.[GOCARDLESS_PATIENT_METADATA_KEY]
  if (tagged && patients.some((p) => p.id === tagged)) return { patientId: tagged, by: 'metadata' }

  const email = customer.email?.trim().toLowerCase()
  if (email) {
    const id = only(patients.filter((p) => p.email?.trim().toLowerCase() === email))
    if (id) return { patientId: id, by: 'email' }
  }

  const phone = phoneKey(customer.phone_number)
  if (phone) {
    const id = only(patients.filter((p) => (p.phone_search ?? '').split(/\s+/).some((n) => phoneKey(n) === phone)))
    if (id) return { patientId: id, by: 'phone' }
  }

  const name = mandateNameKey([customer.given_name, customer.family_name].filter(Boolean).join(' ') || customer.company_name)
  if (name) {
    const same = patients.filter((p) => mandateNameKey(`${p.first_name} ${p.last_name ?? ''}`) === name)
    const id = only(same)
    if (id) return { patientId: id, by: 'name' }
    // Only when no patient has the very same name: two Pablo Ruiz are a
    // question, not a reason to look for a third that is merely similar.
    if (!same.length) {
      const similar = only(patients.filter((p) => looselyNamed(customer.given_name, customer.family_name, p)))
      if (similar) return { patientId: similar, by: 'name', loose: true }
    }
  }

  return { patientId: null, by: null, ambiguous }
}
