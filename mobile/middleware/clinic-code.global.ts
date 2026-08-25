// Gates /login and /signup behind /join until a clinic code has been
// entered once -- claim_patient_profile() needs it to know which clinic's
// patients row to link (see composables/useIdentity.ts). Mirrors the root
// app's middleware/portal.global.ts pattern (path allowlist, early return).
export default defineNuxtRouteMiddleware((to) => {
  if (!['/login', '/signup'].includes(to.path)) return
  if (import.meta.client && localStorage.getItem('clinic_slug')) return
  return navigateTo('/join')
})
