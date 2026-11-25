import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '~/types/database.types'
import { withConcurrency } from '~/utils/practicehubImport/appointments'
import type { PracticeHubListPath, PracticeHubSnapshot } from '~/utils/practicehubImport/types'

// The copy of a clinic read out of PracticeHub's Classic API, kept in
// import_snapshots under source 'practicehub'.
//
// One row per page as it was read (`page:<pass>:<path>:<n>`), so a read that
// runs over many function invocations saves as it goes and a slice that dies
// loses at most the page it was on. Pages are written under the read's own
// pass id and only become the copy when the whole read has finished and
// 'meta' names that pass: a read that stops half way never leaves steps
// planning from a mix of today's patients and last week's payments. The
// previous pass's pages are deleted once the new one is in place.
//
// Rows are de-duplicated by id when the copy is loaded, exactly as
// usePracticeHubApi's fetchAll does it: Classic repeats records across pages
// (10,892 /invoices rows for 6,946 invoices on one clinic), and counting rows
// instead of ids silently dropped real records.

type Admin = SupabaseClient<Database>
const SOURCE = 'practicehub'

export interface PracticeHubMeta {
  readAt: string
  baseUrl: string
  /** The pass whose pages are the copy. */
  pass: string
  /** Pages read per list, in that pass. */
  pages: Partial<Record<PracticeHubListPath, number>>
}

const pageKey = (pass: string, path: string, page: number) => `page:${pass}:${path}:${String(page).padStart(5, '0')}`

export async function loadPracticeHubMeta(admin: Admin, accountId: string): Promise<PracticeHubMeta | null> {
  const { data, error } = await admin.from('import_snapshots').select('data').eq('account_id', accountId).eq('source', SOURCE).eq('key', 'meta').maybeSingle()
  if (error) throw new Error(`import_snapshots: ${error.message}`)
  return (data?.data as unknown as PracticeHubMeta) ?? null
}

export async function savePracticeHubPage(admin: Admin, accountId: string, pass: string, path: string, page: number, rows: unknown[]) {
  const { error } = await admin
    .from('import_snapshots')
    .upsert({ account_id: accountId, source: SOURCE, key: pageKey(pass, path, page), data: rows as Json, updated_at: new Date().toISOString() }, { onConflict: 'account_id,source,key' })
  if (error) throw new Error(`import_snapshots: ${error.message}`)
}

/** Makes `meta.pass` the copy, then removes every page that belongs to no pass but that one. */
export async function finishPracticeHubRead(admin: Admin, accountId: string, meta: PracticeHubMeta) {
  const { error } = await admin
    .from('import_snapshots')
    .upsert({ account_id: accountId, source: SOURCE, key: 'meta', data: meta as unknown as Json, updated_at: new Date().toISOString() }, { onConflict: 'account_id,source,key' })
  if (error) throw new Error(`import_snapshots: ${error.message}`)
  const { error: dropError } = await admin
    .from('import_snapshots')
    .delete()
    .eq('account_id', accountId)
    .eq('source', SOURCE)
    .like('key', 'page:%')
    .not('key', 'like', `page:${meta.pass}:%`)
  if (dropError) throw new Error(`import_snapshots: ${dropError.message}`)
}

// How a list's pages come back. A request carries a run of pages by page
// number -- never by offset, which made the database walk every earlier page
// again for each request -- and a few requests run at once. A page holds up
// to 100 records but not a fixed size: 100 form responses came to a megabyte,
// so ten pages is a request of ten megabytes at the most.
const PAGES_PER_REQUEST = 10
const REQUESTS_AT_ONCE = 6

/** Pages of one list, from page `from` (inclusive) to `to` (exclusive); null is open. */
interface PageRange { path: string; prefix: string; from: string | null; to: string | null }

/**
 * Ranges that together hold every page of `path` in `pass`: runs of
 * PAGES_PER_REQUEST by page number when the count is known, then whatever
 * lies past them -- normally nothing, there so that a page numbered beyond
 * the count is still read, never dropped.
 *
 * Every request keeps to its list with `like 'page:<pass>:<path>:%'`, and
 * compares keys only against keys of the same list. The database collates
 * text as en_US, which all but ignores punctuation: a bound like
 * `< 'page:…:/appointments:~'` matched none of the list's 334 pages. Within
 * one list the keys differ only in their five digits, which every collation
 * orders alike.
 */
function pageRanges(pass: string, path: string, pageCount: number | undefined): PageRange[] {
  const prefix = `page:${pass}:${path}:`
  const ranges: PageRange[] = []
  let from: string | null = null
  for (let page = 0; pageCount !== undefined && page <= pageCount; page += PAGES_PER_REQUEST) {
    const to = pageKey(pass, path, page + PAGES_PER_REQUEST)
    ranges.push({ path, prefix, from, to })
    from = to
  }
  ranges.push({ path, prefix, from, to: null })
  return ranges
}

/** Every page in the ranges, each range's pages in key order, ranges in the order given. */
async function loadPageRanges(admin: Admin, accountId: string, ranges: PageRange[]): Promise<unknown[][][]> {
  const out: unknown[][][] = ranges.map(() => [])
  await withConcurrency(ranges.map((_, i) => i), REQUESTS_AT_ONCE, async (i) => {
    const range = ranges[i]!
    let after: string | null = null
    for (;;) {
      let q = admin.from('import_snapshots').select('key, data').eq('account_id', accountId).eq('source', SOURCE).like('key', `${range.prefix}%`)
      if (after !== null) q = q.gt('key', after)
      else if (range.from !== null) q = q.gte('key', range.from)
      if (range.to !== null) q = q.lt('key', range.to)
      const { data, error } = await q.order('key').limit(PAGES_PER_REQUEST)
      if (error) throw new Error(`import_snapshots: ${error.message}`)
      for (const row of data ?? []) out[i]!.push((row.data as unknown[]) ?? [])
      if (!data || data.length < PAGES_PER_REQUEST) break
      after = data[data.length - 1]!.key
    }
  })
  return out
}

/**
 * One list's records out of its pages, de-duplicated by id: a record on a
 * later page replaces the same id on an earlier one, as fetchAll does.
 */
function recordsOf(pages: unknown[][]): unknown[] {
  const byId = new Map<unknown, unknown>()
  const withoutId: unknown[] = []
  for (const page of pages) {
    for (const record of page) {
      const id = (record as { id?: unknown })?.id
      if (id === undefined || id === null) withoutId.push(record)
      else byId.set(id, record)
    }
  }
  return [...byId.values(), ...withoutId]
}

/**
 * The finished copy, or null when PracticeHub has never been read in full.
 *
 * `only` names the lists to load -- a step's PRACTICEHUB_STEP_LISTS. The rest
 * are left out of `lists` altogether, so practiceHubList refuses one instead
 * of handing back an empty list. Without it, the whole copy.
 */
export async function loadPracticeHubSnapshot(admin: Admin, accountId: string, only?: readonly PracticeHubListPath[]): Promise<PracticeHubSnapshot | null> {
  const meta = await loadPracticeHubMeta(admin, accountId)
  if (!meta) return null
  const paths = (Object.keys(meta.pages) as PracticeHubListPath[]).filter((path) => !only || only.includes(path))
  const ranges = paths.flatMap((path) => (meta.pages[path] ?? 0) > 0 ? pageRanges(meta.pass, path, meta.pages[path]) : [])
  const loaded = await loadPageRanges(admin, accountId, ranges)
  const pagesOf = new Map<string, unknown[][]>()
  ranges.forEach((range, i) => {
    const pages = pagesOf.get(range.path) ?? []
    pages.push(...loaded[i]!)
    pagesOf.set(range.path, pages)
  })
  const lists: PracticeHubSnapshot['lists'] = {}
  for (const path of paths) {
    const pages = pagesOf.get(path)
    // A list PracticeHub answered with no records at all has no pages; one
    // that had pages and lost them is a broken copy, not an empty list.
    if (!pages?.length && (meta.pages[path] ?? 0) > 0) throw new Error(`import_snapshots: the pages of ${path} are missing`)
    lists[path] = recordsOf(pages ?? [])
  }
  return { readAt: meta.readAt, baseUrl: meta.baseUrl, lists }
}

/**
 * One list as a pass saved it, de-duplicated by id. A downloading step reads
 * its link list fresh under a pass of its own (PRACTICEHUB_LINK_LISTS) and
 * plans from that instead of the copy.
 */
export async function loadPracticeHubPassList(admin: Admin, accountId: string, pass: string, path: string): Promise<unknown[]> {
  const [pages] = await loadPageRanges(admin, accountId, pageRanges(pass, path, undefined))
  return recordsOf(pages ?? [])
}

/** Removes every page a pass saved (a step's fresh link list, once it is stale). */
export async function dropPracticeHubPass(admin: Admin, accountId: string, pass: string) {
  const { error } = await admin.from('import_snapshots').delete().eq('account_id', accountId).eq('source', SOURCE).like('key', `page:${pass}:%`)
  if (error) throw new Error(`import_snapshots: ${error.message}`)
}

/** "Delete the copy": everything read from PracticeHub for this clinic. */
export async function dropPracticeHubSnapshot(admin: Admin, accountId: string) {
  const { error } = await admin.from('import_snapshots').delete().eq('account_id', accountId).eq('source', SOURCE)
  if (error) throw new Error(`import_snapshots: ${error.message}`)
}
