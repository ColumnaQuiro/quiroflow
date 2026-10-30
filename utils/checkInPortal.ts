// The front-desk check-in portal (pages/check-in/[token].vue): a patient types
// their date of birth as six digits, DDMMAA, the way PracticeHub's portal asks
// for it, and is matched against the visits about to start at that location.

export interface PortalBirthDate {
  day: number
  month: number
  /** The year's last two digits: 85 for 1985 and for 2085. */
  yy: number
}

/** Six digits, DDMMAA, as a date that exists (29 Feb only in a leap year of either century), or null. */
export function parsePortalBirthDate(digits: string): PortalBirthDate | null {
  if (!/^\d{6}$/.test(digits)) return null
  const day = Number(digits.slice(0, 2))
  const month = Number(digits.slice(2, 4))
  const yy = Number(digits.slice(4, 6))
  if (month < 1 || month > 12 || day < 1) return null
  // 2000 is a leap year and 1900 is not, so 290200 is valid and 290201 not;
  // any yy divisible by 4 is a leap year in one century or the other.
  const daysInMonth = new Date(Date.UTC(yy % 4 === 0 ? 2000 : 2001, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  return { day, month, yy }
}

/** Whether a patient's date_of_birth (YYYY-MM-DD) is the date typed. Two years a century apart match: nobody at one desk in one morning is both. */
export function birthDateMatches(dateOfBirth: string | null | undefined, typed: PortalBirthDate): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '')
  if (!m) return false
  return Number(m[1]) % 100 === typed.yy && Number(m[2]) === typed.month && Number(m[3]) === typed.day
}

/**
 * A name as the "is this you?" screen shows it, to a waiting room: the first
 * name's first letter and the surname's initial. "María García" -> "M••• G."
 */
export function maskedPortalName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const first = (firstName ?? '').trim()
  const last = (lastName ?? '').trim()
  const parts = [first ? `${first[0]!.toUpperCase()}•••` : '', last ? `${last[0]!.toUpperCase()}.` : '']
  return parts.filter(Boolean).join(' ') || '•••'
}

export interface PortalVisit {
  id: string
  patient_id: string
  starts_at: string
  checked_in_at: string | null
}

/**
 * Which visit a date of birth checks in, among the visits at this location
 * that are about to start or under way and whose patient has that birthday.
 *   - none: nobody due has that date of birth
 *   - choose: more than one patient does; the portal asks which one, and the
 *     answer comes back as `chosenId`
 *   - visit: this one -- the patient's earliest not yet checked in, or their
 *     earliest if all are (which the portal shows as "already checked in")
 * A chosen id that is not among them is `none`: the screen was left open too
 * long, or someone is guessing.
 */
export function pickPortalVisit<V extends PortalVisit>(visits: V[], chosenId?: string | null): { kind: 'none' } | { kind: 'choose'; options: V[] } | { kind: 'visit'; visit: V } {
  const sorted = [...visits].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const firstFor = (patientId: string) => {
    const theirs = sorted.filter((v) => v.patient_id === patientId)
    return theirs.find((v) => !v.checked_in_at) ?? theirs[0]!
  }
  if (chosenId) {
    const chosen = sorted.find((v) => v.id === chosenId)
    return chosen ? { kind: 'visit', visit: firstFor(chosen.patient_id) } : { kind: 'none' }
  }
  const patients = [...new Set(sorted.map((v) => v.patient_id))]
  if (patients.length === 0) return { kind: 'none' }
  if (patients.length === 1) return { kind: 'visit', visit: firstFor(patients[0]!) }
  return { kind: 'choose', options: patients.map(firstFor) }
}
