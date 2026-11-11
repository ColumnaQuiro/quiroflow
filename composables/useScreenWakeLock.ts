// Keeps the screen on while `active()` is true, where the browser allows it.
//
// For work that only happens while the page is running: the PracticeHub files
// import runs in the clinic's own tab, and Safari stops that tab as soon as the
// display sleeps. A clinic that started it and walked away came back three
// hours later to 35 minutes of progress. A screen that stays on also keeps an
// idle Mac out of sleep.
//
// The browser drops the lock whenever the page is hidden, so it is taken again
// each time the page comes back. Unsupported or refused is not an error: the
// on-screen advice to keep the tab in front still applies.
type WakeLockSentinelLike = { release: () => Promise<void> }
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }

export function useScreenWakeLock(active: () => boolean) {
  let sentinel: WakeLockSentinelLike | null = null

  async function acquire() {
    if (sentinel || !active() || document.visibilityState !== 'visible') return
    try {
      sentinel = (await (navigator as WakeLockNavigator).wakeLock?.request('screen')) ?? null
    } catch {
      sentinel = null
    }
  }

  function release() {
    const held = sentinel
    sentinel = null
    held?.release().catch(() => {})
  }

  function onVisibility() {
    // A hidden page has already lost the lock; forget it so it is taken again.
    if (document.visibilityState !== 'visible') sentinel = null
    else void acquire()
  }

  if (import.meta.client) {
    watch(active, (now) => (now ? void acquire() : release()), { immediate: true })
    document.addEventListener('visibilitychange', onVisibility)
    onBeforeUnmount(() => {
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    })
  }
}
