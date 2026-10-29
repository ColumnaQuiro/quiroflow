// A tab left open across a release keeps running the build it loaded, and
// that build's lazy chunks are gone from the server once a newer one ships
// (Netlify serves only the live deploy's files). Everything already loaded
// keeps working; the first thing that has to be fetched -- the appointment
// panel, on a click in the calendar -- 404s, and the click does nothing.
// A clinic computer that is never closed sat on v1.89.0 for days this way.
//
// Nuxt reloads by itself only when the missing chunk is a ROUTE's, and only
// on the next navigation. A Lazy* component failing is reported through the
// same app:chunkError hook and then left alone, so this reloads for it --
// when a newer build is published, which is what a 404 there means. A chunk
// that fails while the build is current is the network, and a reload would
// only trade the error for the browser's own offline page.
//
// It also looks for a new build before anything breaks: every ten minutes,
// and whenever the tab comes back to the front (a clinic computer is mostly
// a tab someone returns to). Finding one fires Nuxt's own
// app:manifest:update, whose handler (nuxt:chunk-reload) reloads the app on
// the next navigation -- never in place, since the person on the page may be
// halfway through a clinical note. useNewVersion() tells the layout, which
// offers the reload as a banner to someone who stays on one screen.
//
// Nuxt's own hourly poll for the same thing is turned off in nuxt.config.ts
// (checkOutdatedBuildInterval), so this is the only one.
//
// latest.json is served `immutable` like everything under /_nuxt/, which is
// wrong for a file that changes with every release. The query string is what
// makes it work anyway: Netlify's CDN keys on it, so every check misses the
// cache and reaches the live deploy.
const CHECK_EVERY_MS = 10 * 60 * 1000
const MIN_GAP_MS = 60 * 1000

export default defineNuxtPlugin((nuxtApp) => {
  const app = useRuntimeConfig().app
  const { available } = useNewVersion()

  function latestBuild() {
    return $fetch<{ id: string; timestamp: number }>(`${app.buildAssetsDir}builds/latest.json`, { query: { t: Date.now() } })
  }

  let checking = false
  nuxtApp.hook('app:chunkError', async () => {
    if (checking) return
    checking = true
    try {
      const latest = await latestBuild()
      // reloadNuxtApp skips a second reload of the same path within ten
      // seconds, so a build that is still not there cannot loop.
      if (latest.id !== app.buildId) reloadNuxtApp()
    } catch {
      // Offline: nothing a reload would fix.
    } finally {
      checking = false
    }
  })

  let lastCheck = 0
  let timer: ReturnType<typeof setInterval> | undefined
  async function check() {
    // Switching tabs back and forth should not fetch on every switch.
    if (available.value || Date.now() - lastCheck < MIN_GAP_MS) return
    lastCheck = Date.now()
    try {
      const latest = await latestBuild()
      if (latest.id === app.buildId || available.value) return
      available.value = true
      clearInterval(timer)
      await nuxtApp.callHook('app:manifest:update', latest)
    } catch {
      // Offline, or a deploy still uploading: the next check tries again.
    }
  }

  onNuxtReady(() => {
    timer = setInterval(check, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  })
})
