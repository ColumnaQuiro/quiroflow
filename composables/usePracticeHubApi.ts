export interface PracticeHubConnection {
  baseUrl: string
  apiKey: string
  appDetails: string
}

interface PracticeHubPage<T> {
  data: T[]
  total_entries: number
}

// PracticeHub's own API caps page_size at 100 regardless of what's
// requested, and there's no CORS on their API so every call routes through
// our own server proxy (server/api/import/practicehub-proxy.post.ts).
export function usePracticeHubApi(conn: PracticeHubConnection) {
  async function fetchPage<T>(path: string, page: number): Promise<PracticeHubPage<T>> {
    return $fetch<PracticeHubPage<T>>('/api/import/practicehub-proxy', {
      method: 'POST',
      body: { ...conn, path, page, pageSize: 100 },
    })
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
