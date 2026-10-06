// While reception mode is on (useReceptionLock), every route leads back to
// the patient's forms: a reload, a relaunch, a swipe back or a stray link all
// end up there instead of on the clinic's day. Only ReceptionExit's unlock
// lets the app go anywhere else.
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return
  const lock = useReceptionLock().current()
  if (!lock) return
  const home = `/reception/${lock.patientId}`
  if (to.path !== home) return navigateTo(home, { replace: true })
})
