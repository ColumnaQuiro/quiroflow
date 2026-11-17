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

export async function loadQuirocitasMeta(admin: Admin, accountId: string): Promise<QuirocitasMeta | null> {
  return (await getRow<QuirocitasMeta>(admin, accountId, 'meta'))
}

export async function saveQuirocitasMeta(admin: Admin, accountId: string, meta: QuirocitasMeta) {
  await putRows(admin, accountId, [{ key: 'meta', data: meta }])
  forgetCached(accountId)
}

export async function loadQuirocitasList(admin: Admin, accountId: string) {
  return (await getRow<QuirocitasListPatient[]>(admin, accountId, 'list')) ?? []
}

export async function saveQuirocitasList(admin: Admin, accountId: string, list: QuirocitasListPatient[]) {
  await putRows(admin, accountId, [{ key: 'list', data: list }])
}

export async function loadLedgerPartial(admin: Admin, accountId: string) {
  return getRow<QuirocitasLedgerPartial>(admin, accountId, 'ledger_partial')
}

export async function saveLedgerPartial(admin: Admin, accountId: string, partial: QuirocitasLedgerPartial | null) {
  if (partial) await putRows(admin, accountId, [{ key: 'ledger_partial', data: partial }])
  else await deleteKeys(admin, accountId, ['ledger_partial'])
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

async function deleteKeys(admin: Admin, accountId: string, keys: string[]) {
  for (let i = 0; i < keys.length; i += 200) {
    const { error } = await admin.from('import_snapshots').delete().eq('account_id', accountId).eq('source', SOURCE).in('key', keys.slice(i, i + 200))
    if (error) throw new Error(`import_snapshots: ${error.message}`)
  }
}
