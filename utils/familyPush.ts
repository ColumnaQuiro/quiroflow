// Which pushes about a patient also reach the family members who manage them
// in the app (patient_managers, 20261106053857_family_accounts.sql), and on
// what terms. Kept beside the database's own rule: a guardian link stands
// while the person is under 16 (by date of birth; without one, while flagged a
// minor), a consent link until it is withdrawn.

/** Visits: any link. The clinic's replies, exercises and articles: 'full' links only. Announcements and broadcasts: nobody but the patient. */
export function familyPushReach(type: string | undefined): 'any' | 'full' | null {
  if (!type) return null
  if (type.startsWith('appointment_')) return 'any'
  if (type === 'patient_app_message' || type === 'exercises' || type === 'learn' || type === 'posture_comparison') return 'full'
  return null
}

export function guardianLinkStands(dateOfBirth: string | null | undefined, isMinor: boolean | null | undefined, today: Date = new Date()): boolean {
  if (!dateOfBirth) return Boolean(isMinor)
  const sixteen = new Date(Date.UTC(today.getUTCFullYear() - 16, today.getUTCMonth(), today.getUTCDate()))
  return new Date(`${dateOfBirth}T00:00:00Z`).getTime() > sixteen.getTime()
}

/** "Lucas · Mañana a las 10:00": the manager must know whose visit it is. */
export function familyPushTitle(firstName: string, title: string): string {
  return firstName ? `${firstName} · ${title}` : title
}
