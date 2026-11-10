// A SecurityError thrown by history.replaceState while the page is closing.
//
// vue-router saves the scroll position into history.state from its own
// `beforeunload` listener, so that Back restores it. Firefox sometimes refuses
// that call as the document is torn down -- "SecurityError: The operation is
// insecure." -- most often on /book/:slug, which clinics embed as a
// cross-site iframe. Nothing is lost: the page is already going away, and
// the only casualty is a scroll position for a page nobody is coming back
// to. But it is uncaught, so it reaches Sentry as an unhandled error
// (JAVASCRIPT-NUXT-R, 9 Nov 2026).
//
// Not dropped by message: Firefox gives the same "The operation is insecure."
// for localStorage blocked inside a third-party frame, and that one is a real
// failure worth hearing about. So only a SecurityError raised during unload
// goes. A capture listener on window runs before vue-router's (bubble-phase)
// one, so the moment is recorded before the error can happen.

/** How long after `beforeunload` an error still counts as part of closing. */
export const UNLOAD_WINDOW_MS = 1000

export function isUnloadSecurityError(
  error: unknown,
  unloadStartedAt: number | null,
  now: number,
): boolean {
  if (unloadStartedAt === null) return false
  if (now - unloadStartedAt > UNLOAD_WINDOW_MS || now < unloadStartedAt) return false
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'SecurityError'
}

let unloadStartedAt: number | null = null

/** Starts noting when the page begins to close. Browser only; call once. */
export function trackUnload(target: Pick<Window, 'addEventListener'>) {
  target.addEventListener('beforeunload', () => {
    unloadStartedAt = Date.now()
  }, { capture: true })
}

/** True for the error described above, thrown while the page is closing. */
export function isUnloadNoise(error: unknown): boolean {
  return isUnloadSecurityError(error, unloadStartedAt, Date.now())
}
