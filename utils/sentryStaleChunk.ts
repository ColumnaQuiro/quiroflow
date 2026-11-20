// A lazy chunk that failed to load because the tab is running an old build.
//
// Netlify serves only the live deploy's files, so a tab left open across a
// release 404s on the first chunk it still has to fetch. That is handled:
// plugins/stale-build-reload.client.ts reloads onto the new build. But the
// error reaches Sentry first, once per open tab per release, as "Failed to
// fetch dynamically imported module" (Chromium), "Importing a module script
// failed." (Safari) or "error loading dynamically imported module" (Firefox)
// -- JAVASCRIPT-NUXT-6, -8 and -C, each on the release before the one that
// had just gone live.
//
// Dropped only when the build has in fact moved on, by the same check the
// reload plugin makes. A chunk that fails while the tab IS on the live build
// is a deploy missing a file, or the network, and is still reported.

const CHUNK_ERROR_MESSAGES = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'Unable to preload CSS',
]

/** True for a failed dynamic import, however the browser words it (or wraps it). */
export function isChunkLoadError(error: unknown): boolean {
  for (let e = error, depth = 0; e && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    const message = typeof e === 'string' ? e : (e as { message?: unknown }).message
    if (typeof message === 'string' && CHUNK_ERROR_MESSAGES.some((m) => message.includes(m))) return true
  }
  return false
}

/**
 * Whether a newer build than `buildId` is live. False when it cannot tell
 * (offline, latest.json unreadable), so a doubt is reported rather than dropped.
 */
export async function newerBuildIsLive(buildId: string, fetchLatest: () => Promise<{ id?: string } | null | undefined>): Promise<boolean> {
  try {
    const latest = await fetchLatest()
    return !!latest?.id && latest.id !== buildId
  } catch {
    return false
  }
}
