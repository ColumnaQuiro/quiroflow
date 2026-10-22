// A patient's age, from their date of birth ("1990-09-27"). Worked out on the
// calendar date rather than through `new Date(dob)`, which reads a bare date
// as UTC midnight and so puts it on the previous day anywhere west of
// Greenwich -- a birthday a day early. The banner, the patients list and the
// data export each had their own copy of this; they share this one now.

/** Today's calendar date where the browser is, as YYYY-MM-DD. */
function localToday(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Whole years from `dateOfBirth` to `today`. Null when there is no date, it is
 * not a date, or it is in the future -- a half-typed year in a date input
 * ("0019-…") is not a 2,000-year-old patient.
 */
export function patientAge(dateOfBirth: string | null | undefined, today: string | Date = new Date()): number | null {
  const dob = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '')
  if (!dob) return null
  const on = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof today === 'string' ? today : localToday(today))
  if (!on) return null
  let years = Number(on[1]) - Number(dob[1])
  // Not yet had this year's birthday. Someone born on 29 February turns a
  // year older on 1 March in a year without one.
  if (on[2]! + on[3]! < dob[2]! + dob[3]!) years--
  return years >= 0 && years < 130 ? years : null
}

/** Under the age of majority in Spain. */
export const ADULT_AGE = 18
