// Whether a newer build than the one this tab is running has been published,
// set by plugins/stale-build-reload.client.ts. layouts/default.vue shows the
// staff a banner for it; the next navigation reloads the app either way.
//
// Module-scoped like useSupabaseFailureNotice: one plain ref, client-only.
const available = ref(false)

export function useNewVersion() {
  return { available }
}
