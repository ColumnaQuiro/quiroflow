import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '~/types/database.types'
import type { QuirocitasLedgerRow, QuirocitasListPatient } from '~/utils/quirocitasPages'
import type { QuirocitasLedgerMonth, QuirocitasRecord, QuirocitasSnapshot } from '~/utils/quirocitasRows'

// The copy of a clinic read out of Quirocitas, kept in import_snapshots.
//
// It used to be one object in the browser's IndexedDB. Here it is a row per
// patient record, written as each one is read, so a read that runs over many
// function invocations never rewrites the whole clinic to save one patient,
// and a slice that dies loses at most the record it was on. Everything that is
// not a record sits in the 'meta' row; the patient list of a read in progress
// and the cash ledger walked so far have rows of their own until the read
// finishes.

type Admin = SupabaseClient<Database>
const SOURCE = 'quirocitas'

export type QuirocitasMeta = Omit<QuirocitasSnapshot, 'patients'>
export interface QuirocitasLedgerPartial { ledger: QuirocitasLedgerRow[]; months: QuirocitasLedgerMonth[]; earliest: string }

const PATIENT = 'patient:'

// The cash ledger is kept beside the row it belongs to, a few thousand of its
// rows to a row of the table, and never inside it. A clinic's whole ledger in
// the 'meta' row was one 12 MB request for a clinic with thirteen years of
// it: the API answered 520, the read was thrown back to start its ledger
// again, and what it then saved was four empty months (see
// QuirocitasClient.ledger for that half). At this size a request stays near
// 1 MB however long the clinic has been open.
const LEDGER = 'ledger:'
const PARTIAL = 'partial:'
const LEDGER_CHUNK = 4000

async function loadChunks(admin: Admin, accountId: string, prefix: string, count: number) {
  const rows: QuirocitasLedgerRow[] = []
  for (let i = 0; i < count; i++) {
    const part = await getRow<QuirocitasLedgerRow[]>(admin, accountId, `${prefix}${i}`)
    // Never a shorter ledger passed off as the whole one.
    if (!part) throw new Error(`import_snapshots: ${prefix}${i} is missing`)
    for (const r of part) rows.push(r)
  }
  return rows
}

/** Writes the rows in pieces and returns how many; `after` writes the row that says so. */
async function saveChunks(admin: Admin, accountId: string, prefix: string, rows: QuirocitasLedgerRow[], after: (count: number) => Promise<void>) {
  let count = 0
  for (let i = 0; i < rows.length; i += LEDGER_CHUNK) await putRows(admin, accountId, [{ key: `${prefix}${count++}`, data: rows.slice(i, i + LEDGER_CHUNK) }])
  // The count is what makes pieces part of the copy, so it is written after
  // them -- and before they are cleared, when there are none any more.
  await after(count)
  if (!count) await deletePrefix(admin, accountId, prefix)
}

export async function loadQuirocitasMeta(admin: Admin, accountId: string): Promise<QuirocitasMeta | null> {
  const row = await getRow<QuirocitasMeta & { ledgerChunks?: number }>(admin, accountId, 'meta')
  if (!row) return null
  const { ledgerChunks, ...meta } = row
  // A copy saved before the ledger was kept apart carries it inline.
  return ledgerChunks ? { ...meta, ledger: await loadChunks(admin, accountId, LEDGER, ledgerChunks) } : meta
}

export async function saveQuirocitasMeta(admin: Admin, accountId: string, meta: QuirocitasMeta) {
  const { ledger, ...rest } = meta
  await saveChunks(admin, accountId, LEDGER, ledger, (ledgerChunks) => putRows(admin, accountId, [{ key: 'meta', data: { ...rest, ledger: [], ledgerChunks } }]))
  forgetCached(accountId)
}

export async function loadQuirocitasList(admin: Admin, accountId: string) {
  return (await getRow<QuirocitasListPatient[]>(admin, accountId, 'list')) ?? []
}

export async function saveQuirocitasList(admin: Admin, accountId: string, list: QuirocitasListPatient[]) {
  await putRows(admin, accountId, [{ key: 'list', data: list }])
}

export async function loadLedgerPartial(admin: Admin, accountId: string): Promise<QuirocitasLedgerPartial | null> {
  const row = await getRow<QuirocitasLedgerPartial & { chunks?: number }>(admin, accountId, 'ledger_partial')
  if (!row) return null
  const { chunks, ...partial } = row
  return chunks ? { ...partial, ledger: await loadChunks(admin, accountId, PARTIAL, chunks) } : partial
}

export async function saveLedgerPartial(admin: Admin, accountId: string, partial: QuirocitasLedgerPartial | null) {
  if (!partial) {
    await deleteKeys(admin, accountId, ['ledger_partial'])
    await deletePrefix(admin, accountId, PARTIAL)
    return
  }
  const { ledger, ...rest } = partial
  await saveChunks(admin, accountId, PARTIAL, ledger, (chunks) => putRows(admin, accountId, [{ key: 'ledger_partial', data: { ...rest, ledger: [], chunks } }]))
}

export async function saveQuirocitasRecords(admin: Admin, accountId: string, records: QuirocitasRecord[]) {
  if (!records.length) return
  await putRows(admin, accountId, records.map((r) => ({ key: `${PATIENT}${r.list.id}`, data: r })))
  forgetCached(accountId)
}

/** When each stored record was read, by Quirocitas patient id -- without loading the records. */
export async function quirocitasRecordStamps(admin: Admin, accountId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('import_snapshots')
      .select('key, readAt:data->>readAt')
      .eq('account_id', accountId)
      .eq('source', SOURCE)
      .like('key', `${PATIENT}%`)
      .order('key')
      .range(from, from + 999)
    if (error) throw new Error(`import_snapshots: ${error.message}`)
    for (const r of (data ?? []) as unknown as { key: string; readAt: string | null }[]) out.set(r.key.slice(PATIENT.length), r.readAt ?? '')
    if (!data || data.length < 1000) return out
  }
}

/** Drops the records of patients Quirocitas' list no longer names. */
export async function dropQuirocitasRecords(admin: Admin, accountId: string, ids: string[]) {
  await deleteKeys(admin, accountId, ids.map((id) => `${PATIENT}${id}`))
  forgetCached(accountId)
}

// A warm function instance keeps the last copy it loaded: an import step runs
// over several slices, and each would otherwise load the whole clinic again
// before writing anything. Keyed on what changes whenever a record is saved.
let cached: { accountId: string; version: string; snapshot: QuirocitasSnapshot } | null = null
function forgetCached(accountId: string) {
  if (cached?.accountId === accountId) cached = null
}

/** The whole copy, records and all. Null when nothing has been read. */
export async function loadQuirocitasSnapshot(admin: Admin, accountId: string): Promise<QuirocitasSnapshot | null> {
  const meta = await loadQuirocitasMeta(admin, accountId)
  if (!meta) return null
  const { data: newest } = await admin
    .from('import_snapshots')
    .select('updated_at')
    .eq('account_id', accountId)
    .eq('source', SOURCE)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const version = `${meta.readAt}|${meta.passStartedAt ?? ''}|${newest?.updated_at ?? ''}`
  if (cached?.accountId === accountId && cached.version === version) return cached.snapshot

  const patients: Record<string, QuirocitasRecord> = {}
  // Pages of a few hundred: one patient's record with years of history is
  // tens of kilobytes, and PostgREST holds a whole page in memory.
  const PAGE = 250
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('import_snapshots')
      .select('key, data')
      .eq('account_id', accountId)
      .eq('source', SOURCE)
      .like('key', `${PATIENT}%`)
      .order('key')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`import_snapshots: ${error.message}`)
    for (const r of data ?? []) patients[r.key.slice(PATIENT.length)] = r.data as unknown as QuirocitasRecord
    if (!data || data.length < PAGE) break
  }
  const snapshot: QuirocitasSnapshot = { ...meta, patients }
  cached = { accountId, version, snapshot }
  return snapshot
}

export async function forgetQuirocitasCopy(admin: Admin, accountId: string) {
  const { error } = await admin.from('import_snapshots').delete().eq('account_id', accountId).eq('source', SOURCE)
  if (error) throw new Error(`import_snapshots: ${error.message}`)
  forgetCached(accountId)
}

// --- rows -------------------------------------------------------------------------

async function getRow<T>(admin: Admin, accountId: string, key: string): Promise<T | null> {
  const { data, error } = await admin.from('import_snapshots').select('data').eq('account_id', accountId).eq('source', SOURCE).eq('key', key).maybeSingle()
  if (error) throw new Error(`import_snapshots: ${error.message}`)
  return (data?.data as unknown as T) ?? null
}

async function putRows(admin: Admin, accountId: string, rows: { key: string; data: unknown }[]) {
  const now = new Date().toISOString()
  const { error } = await admin
    .from('import_snapshots')
    .upsert(rows.map((r) => ({ account_id: accountId, source: SOURCE, key: r.key, data: r.data as Json, updated_at: now })), { onConflict: 'account_id,source,key' })
  if (error) throw new Error(`import_snapshots: ${error.message}`)
}

async function deletePrefix(admin: Admin, accountId: string, prefix: string) {
  const { error } = await admin.from('import_snapshots').delete().eq('account_id', accountId).eq('source', SOURCE).like('key', `${prefix}%`)
  if (error) throw new Error(`import_snapshots: ${error.message}`)
}

async function deleteKeys(admin: Admin, accountId: string, keys: string[]) {
  for (let i = 0; i < keys.length; i += 200) {
    const { error } = await admin.from('import_snapshots').delete().eq('account_id', accountId).eq('source', SOURCE).in('key', keys.slice(i, i + 200))
    if (error) throw new Error(`import_snapshots: ${error.message}`)
  }
}
