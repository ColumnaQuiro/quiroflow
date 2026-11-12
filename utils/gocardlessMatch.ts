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
  /** patients.phone_search: every contact number, national digits, space-separated. */
  phone_search: string | null
}

export interface MatchableCustomer {
  email: string | null
  given_name: string | null
  family_name: string | null
  company_name: string | null
  phone_number: string | null
}

export type MandateMatch = { patientId: string; by: 'email' | 'phone' | 'name' } | { patientId: null; by: null; ambiguous: boolean }

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

/**
 * The patient a customer most likely is. Tries email, then phone, then full
 * name, and only accepts a criterion that points at exactly ONE patient:
 * two patients sharing an email (a parent and a child, often) is not a
 * match, it is a question for whoever is looking at the screen.
 */
export function suggestMandatePatient(customer: MatchableCustomer, patients: MatchablePatient[]): MandateMatch {
  let ambiguous = false
  const only = (candidates: MatchablePatient[]) => {
    if (candidates.length > 1) ambiguous = true
    return candidates.length === 1 ? candidates[0]!.id : null
  }

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
    const id = only(patients.filter((p) => mandateNameKey(`${p.first_name} ${p.last_name ?? ''}`) === name))
    if (id) return { patientId: id, by: 'name' }
  }

  return { patientId: null, by: null, ambiguous }
}
