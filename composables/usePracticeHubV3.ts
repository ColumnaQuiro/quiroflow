// PracticeHub 2.0's API from the importers, through our proxy
// (server/api/import/practicehub-v3.post.ts), which holds the key.
//
// Lists are walked by cursor, which PracticeHub recommends for exports: it
// never repeats or skips a row the way Classic's page numbers did. The token
// in links.next is bound to the query it was issued for, so every page sends
// the same filters, sort and page size, plus the cursor.

interface V3List<T> {
  data: T[]
  links?: { next?: string | null }
  meta?: { total?: number; has_more?: boolean }
}

export function usePracticeHubV3() {
  async function get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    return useStaffFetch<T>('/api/import/practicehub-v3', { method: 'POST', body: { path, query } })
  }

  async function fetchAll<T>(path: string, filters: Record<string, string> = {}, onProgress?: (fetched: number) => void): Promise<T[]> {
    const query = { sort: 'created_at:asc', page_size: '100', ...filters }
    const rows: T[] = []
    let cursor = ''
    for (;;) {
      const page = await get<V3List<T>>(path, { ...query, cursor })
      rows.push(...(page.data ?? []))
      onProgress?.(rows.length)
      const next = page.links?.next
      if (!next) return rows
      const token = new URL(next).searchParams.get('cursor')
      if (!token || token === cursor) return rows
      cursor = token
    }
  }

  return { get, fetchAll }
}
