// When the database or a server route last refused a write because the
// account is read-only (an ended trial past its grace week, or a cancelled
// plan), set by plugins/read-only.client.ts. layouts/default.vue watches it
// and, when it follows something the person just did, asks for a card
// instead of the generic "that change could not be saved".
//
// Module-scoped like useSupabaseFailureNotice: one plain ref, client-only.
const refusedAt = ref(0)

export function useReadOnlyPrompt() {
  return { refusedAt }
}
