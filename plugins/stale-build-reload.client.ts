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
export default defineNuxtPlugin((nuxtApp) => {
  const app = useRuntimeConfig().app
  let checking = false
  nuxtApp.hook('app:chunkError', async () => {
    if (checking) return
    checking = true
    try {
      const latest = await $fetch<{ id: string }>(`${app.buildAssetsDir}builds/latest.json`, { query: { t: Date.now() } })
      // reloadNuxtApp skips a second reload of the same path within ten
      // seconds, so a build that is still not there cannot loop.
      if (latest.id !== app.buildId) reloadNuxtApp()
    } catch {
      // Offline: nothing a reload would fix.
    } finally {
      checking = false
    }
  })
})
