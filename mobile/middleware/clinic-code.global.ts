// Gates /login and /signup behind /join until a clinic code has been
// entered once -- claim_patient_profile() needs it to know which clinic's
// patients row to link (see composables/useIdentity.ts). Mirrors the root
// app's middleware/portal.global.ts pattern (path allowlist, early return).
//
// clinic_gate_seen also satisfies this -- set when a staff member taps
// "I'm on the clinic's team" on /join instead of entering a code, since
// they resolve via team_members and have nothing to join. Checking it here
// (not just clinic_slug) is what stops that skip from looping back to /join.
export default defineNuxtRouteMiddleware((to) => {
  if (!['/login', '/signup'].includes(to.path)) return
  if (import.meta.client && (localStorage.getItem('clinic_slug') || localStorage.getItem('clinic_gate_seen'))) return
  return navigateTo('/join')
})
