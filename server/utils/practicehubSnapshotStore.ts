import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '~/types/database.types'
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

/** The finished copy, or null when PracticeHub has never been read in full. */
export async function loadPracticeHubSnapshot(admin: Admin, accountId: string): Promise<PracticeHubSnapshot | null> {
  const meta = await loadPracticeHubMeta(admin, accountId)
  if (!meta) return null
  const byPath = new Map<string, { byId: Map<unknown, unknown>; withoutId: unknown[] }>()
  const prefix = `page:${meta.pass}:`
  // Pages are small (100 records), so a few at a time keeps each response
  // well under a megabyte however large the clinic.
  for (let from = 0; ; from += 20) {
    const { data, error } = await admin
      .from('import_snapshots')
      .select('key, data')
      .eq('account_id', accountId)
      .eq('source', SOURCE)
      .like('key', `${prefix}%`)
      .order('key')
      .range(from, from + 19)
    if (error) throw new Error(`import_snapshots: ${error.message}`)
    for (const row of data ?? []) {
      const path = row.key.slice(prefix.length, row.key.lastIndexOf(':'))
      let held = byPath.get(path)
      if (!held) byPath.set(path, (held = { byId: new Map(), withoutId: [] }))
      for (const record of (row.data as unknown[]) ?? []) {
        const id = (record as { id?: unknown })?.id
        if (id === undefined || id === null) held.withoutId.push(record)
        else held.byId.set(id, record)
      }
    }
    if (!data || data.length < 20) break
  }
  const lists: PracticeHubSnapshot['lists'] = {}
  for (const path of Object.keys(meta.pages) as PracticeHubListPath[]) {
    const held = byPath.get(path)
    // A list PracticeHub answered with no records at all has no pages; one
    // that had pages and lost them is a broken copy, not an empty list.
    if (!held && (meta.pages[path] ?? 0) > 0) throw new Error(`import_snapshots: the pages of ${path} are missing`)
    lists[path] = held ? [...held.byId.values(), ...held.withoutId] : []
  }
  return { readAt: meta.readAt, baseUrl: meta.baseUrl, lists }
}

/**
 * One list as a pass saved it, de-duplicated by id. A downloading step reads
 * its link list fresh under a pass of its own (PRACTICEHUB_LINK_LISTS) and
 * plans from that instead of the copy.
 */
export async function loadPracticeHubPassList(admin: Admin, accountId: string, pass: string, path: string): Promise<unknown[]> {
  const byId = new Map<unknown, unknown>()
  const withoutId: unknown[] = []
  const prefix = `page:${pass}:${path}:`
  for (let from = 0; ; from += 20) {
    const { data, error } = await admin
      .from('import_snapshots')
      .select('data')
      .eq('account_id', accountId)
      .eq('source', SOURCE)
      .like('key', `${prefix}%`)
      .order('key')
      .range(from, from + 19)
    if (error) throw new Error(`import_snapshots: ${error.message}`)
    for (const row of data ?? []) {
      for (const record of (row.data as unknown[]) ?? []) {
        const id = (record as { id?: unknown })?.id
        if (id === undefined || id === null) withoutId.push(record)
        else byId.set(id, record)
      }
    }
    if (!data || data.length < 20) break
  }
  return [...byId.values(), ...withoutId]
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
