import type { PracticeHubConnection } from './usePracticeHubApi'

// Remembers the last-entered PracticeHub connection for the current page
// session only (module-level, never persisted to localStorage or the DB) --
// so switching between the Patients/Appointments/Payments/etc. import tabs
// during one migration session doesn't require re-typing the API key each
// time. Cleared on page reload, same as before this existed.
const sharedConnection = ref<PracticeHubConnection | null>(null)

export function usePracticeHubConnection() {
  return sharedConnection
}
