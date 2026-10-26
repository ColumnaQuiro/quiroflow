import { hasBusinessHoursConfigured, mergeWindows, practitionerWindowsForDay, type BusinessHours } from './businessHours'

// What the AI receptionist says about the clinic itself -- where it is, how
// to reach it, when patients are seen -- read from the clinic's settings
// rather than from a knowledge card. A clinic switching the receptionist on
// had to write those on a card first or it answered "¿dónde estáis?" with
// "lo consulto con mi compañera"; and a card is a second copy, out of step
// the day the address or the hours change.

/** A clinic as the receptionist's prompt describes it. */
export interface PromptClinic {
  name: string
  address: string | null
  phone: string | null
  email: string | null
  /** clinics.business_hours: what applies to a practitioner with no hours of their own. */
  clinicHours: BusinessHours | null
  /** The hours of each practitioner who takes bookings there (team_members.business_hours). */
  practitionerHours: (BusinessHours | null)[]
}

const DAYS: [string, string][] = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
]

/**
 * When patients are seen, a line a day: the hours of the practitioners who
 * take bookings, joined -- not the clinic's own hours, which on Columnaquiro
 * said Fridays 9:00-14:00 while nobody worked a Friday. A practitioner
 * without hours of their own works the clinic's (practitionerWindowsForDay).
 * Null when nothing says: no practitioner has hours and the clinic has none
 * to lend, so a closed day could not be told from an unconfigured one.
 */
export function clinicOpeningHours(clinic: Pick<PromptClinic, 'clinicHours' | 'practitionerHours'>): string[] | null {
  const clinicSet = hasBusinessHoursConfigured(clinic.clinicHours)
  const people = clinic.practitionerHours
  if (people.length === 0 && !clinicSet) return null
  if (people.some((hours) => !hasBusinessHoursConfigured(hours)) && !clinicSet) return null
  return DAYS.map(([key, day]) => {
    const clinicWindows = clinic.clinicHours?.[key] ?? []
    const windows = people.length ? mergeWindows(people.flatMap((hours) => practitionerWindowsForDay(clinicWindows, hours, key))) : mergeWindows(clinicWindows)
    return `${day}: ${windows.length ? windows.map(([from, to]) => `${from}-${to}`).join(' and ') : 'closed'}`
  })
}

/** The prompt section about the clinic: its address, phone, email and hours, from its settings. */
export function clinicDetailsSection(clinics: PromptClinic[]): string {
  if (!clinics.length) return ''
  const blocks = clinics.map((clinic) => {
    const hours = clinicOpeningHours(clinic)
    const address = clinic.address?.replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
    return [
      clinics.length > 1 ? `## ${clinic.name}` : `Name: ${clinic.name}`,
      address ? `Address: ${address}` : '',
      clinic.phone?.trim() ? `Phone: ${clinic.phone.trim()}` : '',
      clinic.email?.trim() ? `Email: ${clinic.email.trim()}` : '',
      hours ? `When patients are seen:\n${hours.map((line) => `- ${line}`).join('\n')}` : '',
    ].filter(Boolean).join('\n')
  })
  return [
    `# The clinic${clinics.length > 1 ? `\nIt has ${clinics.length} locations.` : ''}`,
    ...blocks,
    `This comes from the clinic's own settings: give it when they ask where the clinic is, how to reach it or when it is open, and it wins over anything the clinic knowledge says about the same thing. The times you offer for a visit still come only from the Booking list or find_free_times.`,
  ].join('\n\n')
}
