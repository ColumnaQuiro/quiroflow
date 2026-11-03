// Fetches the code of Lazy* panels and tabs while the browser is idle, once a
// page is up, so the first click on one does not wait for its download.
//
// A warm-up is only a head start, so a failure here is caught and dropped.
// Left uncaught, every failed warm-up reached Sentry as an unhandled
// rejection -- two per calendar visit, six per patient record -- on a tab
// left open across a release, where the old build's chunks are gone. Those
// were about half of JAVASCRIPT-NUXT-6 and most of JAVASCRIPT-NUXT-C, and none
// of them was something a person had clicked.
//
// Catching here does not hide the stale build. Vite's preload helper fires
// `vite:preloadError` before the promise rejects, whoever handles it, and
// Nuxt turns that into app:chunkError, which
// plugins/stale-build-reload.client.ts acts on. A real click on a panel
// whose chunk is missing still fails, and is still reported, where it fails.
export function warmChunks(load: () => Promise<unknown>[]) {
  const warm = () => {
    for (const chunk of load()) chunk.catch(() => {})
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 3000 })
  else setTimeout(warm, 1500)
}
