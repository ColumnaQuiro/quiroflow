import { forgetPracticeHubReads, practiceHubReadsHeld, recallPracticeHubRead, rememberPracticeHubRead } from '~/utils/practicehubReadCache'

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

// Bumped whenever a list is held or dropped, so the import steps can say
// that the next read will be reused, and offer to read afresh. The lists
// themselves live in utils/practicehubReadCache, which is plain enough to
// unit-test.
const readsVersion = ref(0)

/**
 * Whether the saved connection has lists held from earlier steps, and a way
 * to drop them. For the connect forms: a clinic that corrected a record in
 * PracticeHub a minute ago expects the next read to see it.
 */
export function usePracticeHubReads() {
  const connection = usePracticeHubConnection()
  const held = computed(() => {
    void readsVersion.value
    return connection.value ? practiceHubReadsHeld(connection.value.baseUrl) > 0 : false
  })
  function forget() {
    forgetPracticeHubReads()
    readsVersion.value++
  }
  return { held, forget }
}

// PracticeHub's own API caps page_size at 100 regardless of what's
// requested, and there's no CORS on their API so every call routes through
// our own server proxy (server/api/import/practicehub-proxy.post.ts).
export function usePracticeHubApi(conn: PracticeHubConnection) {
  const MAX_ATTEMPTS = 3

  async function fetchPage<T>(path: string, page: number): Promise<PracticeHubPage<T>> {
    for (let attempt = 1; ; attempt++) {
      try {
        // useStaffFetch so the call reaches the server from the staff app as
        // well, where a relative '/api/...' goes nowhere (see useStaffFetch).
        return await useStaffFetch<PracticeHubPage<T>>('/api/import/practicehub-proxy', {
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

  // Walks every page rather than stopping once total_entries ROWS have been
  // collected. PracticeHub repeats records across pages -- /invoices returns
  // 10,892 rows for 6,946 distinct invoices on the live account -- so a
  // row-counting loop reaches total_entries while pages are still unread and
  // stops there, silently dropping real records with no error to notice. Every
  // importer reads through here, so that under-fetch was invisible in all of
  // them: a missing payment reads as a visit taken out of a bono, a missing
  // patient drops their whole history.
  //
  // Rows are keyed by id where the endpoint returns one (all of them do so
  // far); anything without an id is kept as-is rather than guessed at, which
  // at worst leaves the duplicates that were there before.
  //
  // A list read earlier in this page session comes back from
  // utils/practicehubReadCache instead, within its time limit: the steps
  // write to QuiroFlow, not to PracticeHub, so the list a step read is the
  // one the next step would read again.
  async function fetchAll<T>(path: string, onProgress?: (fetched: number, total: number) => void): Promise<T[]> {
    const heldRead = recallPracticeHubRead<T>(conn.baseUrl, path)
    if (heldRead) {
      onProgress?.(heldRead.rows.length, heldRead.rows.length)
      return heldRead.rows
    }

    const byId = new Map<unknown, T>()
    const withoutId: T[] = []

    const collect = (rows: T[]) => {
      for (const row of rows) {
        const id = (row as { id?: unknown })?.id
        if (id === undefined || id === null) withoutId.push(row)
        else byId.set(id, row)
      }
    }

    const first = await fetchPage<T>(path, 1)
    collect(first.data)
    const total = first.total_entries
    onProgress?.(byId.size + withoutId.length, total)

    if (first.data.length > 0) {
      const pages = Math.max(1, Math.ceil(total / first.data.length))
      for (let page = 2; page <= pages; page++) {
        const res = await fetchPage<T>(path, page)
        if (res.data.length === 0) break
        collect(res.data)
        onProgress?.(byId.size + withoutId.length, total)
      }
    }

    const rows = [...byId.values(), ...withoutId]
    rememberPracticeHubRead(conn.baseUrl, path, rows)
    readsVersion.value++
    return rows
  }

  return { fetchPage, fetchAll }
}
