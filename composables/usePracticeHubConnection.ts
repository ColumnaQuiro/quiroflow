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

// Loads the connection saved on the account (accounts.practicehub_*, set
// from Settings -> Import -> PracticeHub -> General) into the same
// in-memory ref every importer's connect form reads from, so a saved
// connection survives page reloads without going back to localStorage --
// this still only touches accounts, which the client already reads/writes
// directly (see pages/settings/whatsapp.vue for the identical pattern with
// whatsapp_access_token).
export async function loadSavedPracticeHubConnection() {
  if (sharedConnection.value) return
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const { data } = await supabase
    .from('accounts')
    .select('practicehub_base_url, practicehub_api_key, practicehub_contact_email')
    .eq('id', store.accountId!)
    .maybeSingle()
  if (data?.practicehub_base_url && data?.practicehub_api_key) {
    sharedConnection.value = {
      baseUrl: data.practicehub_base_url,
      apiKey: data.practicehub_api_key,
      appDetails: `QuiroFlow=${data.practicehub_contact_email ?? ''}`,
    }
  }
}
