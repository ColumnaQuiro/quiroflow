import type { SupabaseFailure } from '../utils/supabaseFailures'

// The last Supabase query that failed in this tab, set by
// plugins/supabase-failures.client.ts. layouts/default.vue watches it to
// tell the staff that something on the page did not load; the public
// booking page, the patient portal and the shared documents do not, since
// "reload the page" is not advice for a patient.
//
// Module-scoped like useToast: one plain ref every reader shares, client-only.
const failure = ref<SupabaseFailure | null>(null)

export function useSupabaseFailureNotice() {
  return { failure }
}
