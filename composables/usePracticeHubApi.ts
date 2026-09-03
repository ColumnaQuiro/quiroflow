export interface PracticeHubConnection {
  baseUrl: string
  apiKey: string
  appDetails: string
}

interface PracticeHubPage<T> {
  data: T[]
  total_entries: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// PracticeHub's own API caps page_size at 100 regardless of what's
// requested, and there's no CORS on their API so every call routes through
// our own server proxy (server/api/import/practicehub-proxy.post.ts).
export function usePracticeHubApi(conn: PracticeHubConnection) {
  const MAX_ATTEMPTS = 3

  async function fetchPage<T>(path: string, page: number): Promise<PracticeHubPage<T>> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await $fetch<PracticeHubPage<T>>('/api/import/practicehub-proxy', {
          method: 'POST',
          body: { ...conn, path, page, pageSize: 100 },
        })
      } catch (err: any) {
        const status = err?.response?.status ?? err?.statusCode
        // Retry a transient failure (no response at all, rate-limited, or a
        // 5xx from PracticeHub) -- a full re-sync over years of history
        // shouldn't die on one blip. Anything else (bad auth, 4xx) is a real
        // error and should surface immediately.
        const retryable = status === undefined || status === 429 || status >= 500
        if (!retryable || attempt >= MAX_ATTEMPTS) throw err
        const retryAfterHeader = err?.response?.headers?.get?.('retry-after')
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN
        const delay = Number.isFinite(retryAfterMs) ? retryAfterMs : 250 * 2 ** (attempt - 1)
        await sleep(delay)
      }
    }
  }

  async function fetchAll<T>(path: string, onProgress?: (fetched: number, total: number) => void): Promise<T[]> {
    const all: T[] = []
    let page = 1
    let total = Infinity
    while (all.length < total) {
      const res = await fetchPage<T>(path, page)
      all.push(...res.data)
      total = res.total_entries
      onProgress?.(all.length, total)
      if (res.data.length === 0) break
      page++
    }
    return all
  }

  return { fetchPage, fetchAll }
}
