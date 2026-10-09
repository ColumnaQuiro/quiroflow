import { App } from '@capacitor/app'

// Face ID on opening the app (composables/useAppLock.ts): locks on a cold
// start, notes when the app goes to the background and locks again on the way
// back after LOCK_AFTER_MS, and keeps the kept sign-in in step with every
// token refresh. Native only; the web portal has none of this.
export default defineNuxtPlugin(async () => {
  const lock = useAppLock()
  if (!lock.native()) return

  // Nuxt waits for this plugin before drawing anything, so the lock is up
  // before any patient or clinic data shows. But never longer than a moment:
  // a native call that does not answer must not leave the app a white screen.
  const timeboxed = (work: Promise<unknown>, ms: number) => Promise.race([work, new Promise((resolve) => setTimeout(resolve, ms))])
  await timeboxed(
    (async () => {
      await lock.init()
      // Opened from closed: always asked, however recently it was used.
      await lock.lockIfSignedIn()
    })(),
    1500,
  )

  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) lock.resumed()
    else lock.backgrounded()
  })

  // The refresh token rotates; the one kept must be the live one, or
  // "Entrar con Face ID" would restore a session the server already retired.
  useSupabaseClient().auth.onAuthStateChange((event, session) => {
    if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED')) {
      lock.keep(session.refresh_token)
    }
  })
})
