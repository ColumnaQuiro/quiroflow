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

// PracticeHub allows roughly one API request a second, so requests are spaced
// rather than fired as fast as they can be answered.
//
// Without this a single fetchAll runs straight into the limiter: /files alone
// is 27 pages and /patients 16, and back-to-back they answer 429. The retry
// below does recover, but recovering from a self-inflicted 429 on most of 43
// pages is slower than simply waiting, and it means opening a migration by
// hammering someone else's service.
//
// Module-level, not per-composable: every importer builds its own
// usePracticeHubApi, and the limit belongs to PracticeHub, not to any one of
// them. The chain also serialises calls -- an importer that fired two at once
// would otherwise still send them together, which is exactly the 429 seen
// while looking into this.
const MIN_REQUEST_GAP_MS = 1100
let requestChain: Promise<unknown> = Promise.resolve()
function paced<T>(run: () => Promise<T>): Promise<T> {
  const result = requestChain.then(() => run())
  // The gap is waited out whether the request succeeded or failed, and the
  // chain never rejects. Both matter, and the failure case matters most: the
  // request most likely to throw is the one PracticeHub just rate-limited, and
  // an earlier version skipped the wait on throw -- so a 429 was followed
  // immediately by another request, which is the one moment not to send one.
  requestChain = result.then(
    () => sleep(MIN_REQUEST_GAP_MS),
    () => sleep(MIN_REQUEST_GAP_MS),
  )
  return result
}

// PracticeHub's own API caps page_size at 100 regardless of what's
// requested, and there's no CORS on their API so every call routes through
// our own server proxy (server/api/import/practicehub-proxy.post.ts).
export function usePracticeHubApi(conn: PracticeHubConnection) {
  const MAX_ATTEMPTS = 3

  async function fetchPage<T>(path: string, page: number): Promise<PracticeHubPage<T>> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await paced(() =>
          $fetch<PracticeHubPage<T>>('/api/import/practicehub-proxy', {
            method: 'POST',
            body: { ...conn, path, page, pageSize: 100 },
          }),
        )
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
  async function fetchAll<T>(path: string, onProgress?: (fetched: number, total: number) => void): Promise<T[]> {
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

    return [...byId.values(), ...withoutId]
  }

  return { fetchPage, fetchAll }
}
