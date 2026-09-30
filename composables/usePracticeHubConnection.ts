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

// Loads the connection saved in Settings -> Import -> Connection into the
// same in-memory ref every importer's connect form reads from, so a saved
// connection survives page reloads. It comes WITHOUT its key: the key lives
// in account_secrets and practicehub-proxy adds it server-side when a request
// carries none. (It was read straight from accounts, where every member of
// the clinic could fetch it.)
export async function loadSavedPracticeHubConnection() {
  if (sharedConnection.value) return
  const saved = await useStaffFetch<{ baseUrl: string | null; contactEmail: string | null; hasKey: boolean }>('/api/import/practicehub-connection').catch(() => null)
  if (saved?.baseUrl && saved.hasKey) {
    sharedConnection.value = {
      baseUrl: saved.baseUrl,
      apiKey: '',
      appDetails: `QuiroFlow=${saved.contactEmail ?? ''}`,
    }
  }
}
