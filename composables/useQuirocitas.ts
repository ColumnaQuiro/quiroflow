import type { QuirocitasBonoType, QuirocitasHistory, QuirocitasInvoice, QuirocitasLedgerRow, QuirocitasListPatient, QuirocitasPatient } from '~/utils/quirocitasPages'
import type { QuirocitasLedgerMonth, QuirocitasRecord, QuirocitasSnapshot, QuirocitasTechniques } from '~/utils/quirocitasRows'
import { quirocitasDate } from '~/utils/quirocitasRows'

// The Quirocitas importer's shared state: the saved connection, and the
// clinic's records once read.
//
// Quirocitas has no API, so reading a clinic is thousands of page loads
// through /api/import/quirocitas -- about ten minutes for 1,900 patients. That
// read happens once, in the Read step, and every import step then works from
// the copy it made rather than going back to Quirocitas. The copy is kept in
// this browser (IndexedDB, per account), so a reload or a second sitting does
// not mean reading the whole clinic again, and an interrupted read resumes
// where it stopped. It holds patient data, so it is never sent anywhere and is
// deleted with "Forget" on the Read step.

export interface QuirocitasConnection { baseUrl: string | null; username: string | null; hasPassword: boolean }

const connection = ref<QuirocitasConnection | null>(null)
const snapshot = shallowRef<QuirocitasSnapshot | null>(null)

export function useQuirocitasConnection() {
  return connection
}

export function useQuirocitasSnapshot() {
  return snapshot
}

export async function loadQuirocitasConnection(force = false) {
  if (connection.value && !force) return connection.value
  connection.value = await useStaffFetch<QuirocitasConnection>('/api/import/quirocitas-connection').catch(() => null)
  return connection.value
}

export const quirocitasConnected = (c: QuirocitasConnection | null) => Boolean(c?.baseUrl && c.username && c.hasPassword)

/** One call to the server's Quirocitas reader, retried through a blip. */
export async function quirocitasCall<T>(body: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await useStaffFetch<T>('/api/import/quirocitas', { method: 'POST', body })
    } catch (err: any) {
      const status = err?.response?.status ?? err?.statusCode
      const retryable = status === undefined || status === 502 || status === 503 || status === 504
      if (!retryable || attempt >= 3) throw err
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
}

// --- the copy in this browser ----------------------------------------------------

const DB = 'quiroflow-import'
const STORE = 'quirocitas'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

export async function loadQuirocitasSnapshot(accountId: string) {
  if (snapshot.value) return snapshot.value
  snapshot.value = (await idb<QuirocitasSnapshot | undefined>('readonly', (s) => s.get(accountId)).catch(() => undefined)) ?? null
  return snapshot.value
}

async function saveSnapshot(accountId: string, s: QuirocitasSnapshot) {
  await idb('readwrite', (store) => store.put(s, accountId)).catch(() => {})
}

export async function forgetQuirocitasSnapshot(accountId: string) {
  snapshot.value = null
  await idb('readwrite', (s) => s.delete(accountId)).catch(() => {})
}

// --- reading the clinic --------------------------------------------------------------

export interface QuirocitasReadProgress {
  phase: 'list' | 'patients' | 'ledger' | 'done'
  done: number
  total: number
  failed: number
  month?: string
}

// Three patients in flight: Quirocitas is one PHP server answering a
// session at a time, and more only queue there.
const CONCURRENCY = 3
const TECHNIQUE_BATCH = 20
const LEDGER_MONTHS_PER_CALL = 4

/**
 * Reads the whole clinic: the patient list, every patient's record, history,
 * invoices and adjusted segments, then the cash ledger back to the month of
 * the oldest visit. Patients already read are kept unless `again` is set, so
 * stopping and starting again picks up where it was.
 */
export async function readQuirocitas(
  accountId: string,
  opts: { again?: boolean; onProgress: (p: QuirocitasReadProgress) => void; shouldStop: () => boolean },
) {
  const previous = opts.again ? null : await loadQuirocitasSnapshot(accountId)
  opts.onProgress({ phase: 'list', done: 0, total: 0, failed: 0 })
  const { patients: list } = await quirocitasCall<{ patients: QuirocitasListPatient[] }>({ op: 'patients' })
  const s: QuirocitasSnapshot = {
    baseUrl: connection.value?.baseUrl ?? '',
    readAt: new Date().toISOString(),
    bonoTypes: previous?.bonoTypes ?? [],
    patients: Object.fromEntries(Object.entries(previous?.patients ?? {}).filter(([id]) => list.some((p) => p.id === id))),
    failed: {},
    ledger: [],
    ledgerMonths: [],
  }

  const queue = list.filter((p) => !s.patients[p.id])
  let done = list.length - queue.length
  let sinceSave = 0
  const report = () => opts.onProgress({ phase: 'patients', done, total: list.length, failed: Object.keys(s.failed).length })
  report()

  async function readOne(p: QuirocitasListPatient) {
    const read = await quirocitasCall<{ ficha: QuirocitasPatient; history: QuirocitasHistory; invoices: QuirocitasInvoice[]; bonoTypes: QuirocitasBonoType[] }>({ op: 'patient', id: p.id, name: p.name })
    if (!s.bonoTypes.length) s.bonoTypes = read.bonoTypes
    const techniques: Record<string, QuirocitasTechniques> = {}
    const citaIds = read.history.visits.map((v) => v.citaId).filter(Boolean)
    for (let i = 0; i < citaIds.length; i += TECHNIQUE_BATCH) {
      const { techniques: t } = await quirocitasCall<{ techniques: Record<string, QuirocitasTechniques> }>({ op: 'techniques', citaIds: citaIds.slice(i, i + TECHNIQUE_BATCH), segments: read.history.segments })
      Object.assign(techniques, t)
    }
    const record: QuirocitasRecord = { list: p, ficha: read.ficha, history: read.history, invoices: read.invoices, techniques }
    s.patients[p.id] = record
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let p; (p = queue.shift());) {
      if (opts.shouldStop()) return
      try {
        await readOne(p)
        delete s.failed[p.id]
      } catch (err: any) {
        s.failed[p.id] = err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? 'failed'
      }
      done++
      report()
      if (++sinceSave >= 100) { sinceSave = 0; snapshot.value = { ...s }; await saveSnapshot(accountId, s) }
    }
  }))
  snapshot.value = { ...s }
  await saveSnapshot(accountId, s)
  if (opts.shouldStop()) return s

  // The cash ledger, newest month first, back to the oldest visit anyone has.
  let earliest = '9999-99'
  for (const r of Object.values(s.patients)) {
    for (const v of r.ficha.visits) { const d = quirocitasDate(v.date); if (d && d.slice(0, 7) < earliest) earliest = d.slice(0, 7) }
  }
  const ledger: QuirocitasLedgerRow[] = []
  const months: QuirocitasLedgerMonth[] = []
  for (let restart = true; ;) {
    if (opts.shouldStop()) return s
    const { months: batch } = await quirocitasCall<{ months: { month: string; rows: QuirocitasLedgerRow[]; totals: QuirocitasLedgerMonth['printed'] }[] }>({ op: 'ledger', restart, months: LEDGER_MONTHS_PER_CALL })
    restart = false
    for (const m of batch) {
      ledger.push(...m.rows)
      const sum = (k: 'cash' | 'card' | 'transfer') => Math.round(m.rows.reduce((a, r) => a + (r[k] ?? 0), 0) * 100) / 100
      months.push({ month: m.month, rows: m.rows.length, printed: m.totals, summed: { cash: sum('cash'), card: sum('card'), transfer: sum('transfer') } })
    }
    const last = batch[batch.length - 1]!.month
    opts.onProgress({ phase: 'ledger', done: months.length, total: 0, failed: Object.keys(s.failed).length, month: last })
    if (last <= earliest) break
  }
  s.ledger = ledger
  s.ledgerMonths = months
  s.readAt = new Date().toISOString()
  snapshot.value = { ...s }
  await saveSnapshot(accountId, s)
  opts.onProgress({ phase: 'done', done: list.length, total: list.length, failed: Object.keys(s.failed).length })
  return s
}

/** Months whose rows do not add up to what Quirocitas printed under them. */
export function quirocitasLedgerMismatches(s: QuirocitasSnapshot) {
  return s.ledgerMonths.filter((m) => (['cash', 'card', 'transfer'] as const).some((k) => m.printed[k] !== null && Math.abs(m.printed[k]! - m.summed[k]) > 0.011))
}
