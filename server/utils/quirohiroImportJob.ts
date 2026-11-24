import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '~/types/database.types'
import { quirohiroRequest, quirohiroSavedConnection, QuirohiroError, type QuirohiroConnection } from '~/server/utils/quirohiro'
import { quirohiroImporter, type QuirohiroPlan, type QuirohiroStepKind } from '~/utils/quirohiroImport'
import { quirohiroNoteTargets, type QuirohiroContact, type QuirohiroSnapshot, type QuirohiroWho } from '~/utils/quirohiroRows'
import type { ImportJobProgress, ImportJobStepResult } from '~/utils/importJobReport'
import type { ImportJob, ImportJobOptions } from '~/server/utils/importJobs'

// The QuiroHiro half of server-side imports (server/utils/importJobs.ts runs
// the slices; this says what a QuiroHiro slice does).
//
// READ walks QUIROHIRO_LISTS into import_snapshots under a pass id of its own,
// saving every page as it arrives, and only makes that pass the copy once the
// last list is read -- so a read that stops half way never leaves the steps
// planning from a mix of two days. In order:
//
//   users, calendars, fields, folders   one request each
//   contacts                            100 a page, by GoHighLevel's cursor
//   events                              each calendar, a month at a time, from
//                                       a year before the oldest contact to
//                                       two years ahead (the API wants a range)
//   notes                               one request per contact being imported
//
// The first clinic -- 3,573 contacts, 4,604 appointments, 3,771 notes on
// 1,499 patients -- reads in about six minutes, most of it notes.
//
// The import steps then plan from that copy (utils/quirohiroImport.ts) and
// write in chunks a slice can stop between. With options.dryRun they plan and
// stop: each step's result says what it WOULD have written.

type Admin = SupabaseClient<Database>
type Outcome = { progress: ImportJobProgress; result?: ImportJobStepResult }
const SOURCE = 'quirohiro'

export const QUIROHIRO_LISTS = ['users', 'calendars', 'fields', 'folders', 'contacts', 'events', 'invoices', 'transactions', 'notes'] as const
type ListName = (typeof QUIROHIRO_LISTS)[number]

/** Notes are fetched this many contacts at a time, and saved as one page per batch. */
const NOTE_BATCH = 24
const NOTE_CONCURRENCY = 4
/** How far ahead appointments are read. */
const MONTHS_AHEAD = 24
/** Calendar-months asked for at once. */
const EVENT_CONCURRENCY = 3

const whoOf = (options: ImportJobOptions): QuirohiroWho => (options.who === 'everyone' ? 'everyone' : 'patients')

// --- the copy, in import_snapshots ---------------------------------------------------

interface QuirohiroMeta { readAt: string; locationId: string; pass: string; pages: Partial<Record<ListName, number>> }

const pageKey = (pass: string, list: string, page: number) => `page:${pass}:${list}:${String(page).padStart(5, '0')}`

async function savePage(admin: Admin, accountId: string, pass: string, list: string, page: number, rows: unknown[]) {
  const { error } = await admin
    .from('import_snapshots')
    .upsert({ account_id: accountId, source: SOURCE, key: pageKey(pass, list, page), data: rows as Json, updated_at: new Date().toISOString() }, { onConflict: 'account_id,source,key' })
  if (error) throw new Error(`import_snapshots: ${error.message}`)
}

/** Every record a pass saved for one list, de-duplicated by id (the event windows overlap at their edges). */
async function loadList<T>(admin: Admin, accountId: string, pass: string, list: string): Promise<T[]> {
  const byId = new Map<unknown, T>()
  const prefix = `page:${pass}:${list}:`
  for (let from = 0; ; from += 20) {
    const { data, error } = await admin.from('import_snapshots').select('data').eq('account_id', accountId).eq('source', SOURCE).like('key', `${prefix}%`).order('key').range(from, from + 19)
    if (error) throw new Error(`import_snapshots: ${error.message}`)
    for (const row of data ?? []) for (const r of (row.data as unknown as T[]) ?? []) byId.set((r as { id?: unknown })?.id ?? randomUUID(), r)
    if (!data || data.length < 20) break
  }
  return [...byId.values()]
}

async function loadMeta(admin: Admin, accountId: string): Promise<QuirohiroMeta | null> {
  const { data, error } = await admin.from('import_snapshots').select('data').eq('account_id', accountId).eq('source', SOURCE).eq('key', 'meta').maybeSingle()
  if (error) throw new Error(`import_snapshots: ${error.message}`)
  return (data?.data as unknown as QuirohiroMeta) ?? null
}

/** Makes `meta.pass` the copy, then removes every page that belongs to any other pass. */
async function finishRead(admin: Admin, accountId: string, meta: QuirohiroMeta) {
  const { error } = await admin
    .from('import_snapshots')
    .upsert({ account_id: accountId, source: SOURCE, key: 'meta', data: meta as unknown as Json, updated_at: new Date().toISOString() }, { onConflict: 'account_id,source,key' })
  if (error) throw new Error(`import_snapshots: ${error.message}`)
  const { error: dropError } = await admin.from('import_snapshots').delete().eq('account_id', accountId).eq('source', SOURCE).like('key', 'page:%').not('key', 'like', `page:${meta.pass}:%`)
  if (dropError) throw new Error(`import_snapshots: ${dropError.message}`)
}

/** The finished copy, or null when QuiroHiro has never been read in full. */
export async function loadQuirohiroSnapshot(admin: Admin, accountId: string): Promise<QuirohiroSnapshot | null> {
  const meta = await loadMeta(admin, accountId)
  if (!meta) return null
  const lists = await Promise.all(QUIROHIRO_LISTS.map((l) => loadList<never>(admin, accountId, meta.pass, l)))
  const of = (l: ListName) => lists[QUIROHIRO_LISTS.indexOf(l)]!
  // A copy read before payments were read has no marker, and no money.
  const [money] = await loadList<{ read: boolean; reason?: string }>(admin, accountId, meta.pass, 'money')
  return {
    readAt: meta.readAt, locationId: meta.locationId, users: of('users'), calendars: of('calendars'), fields: of('fields'), folders: of('folders'),
    contacts: of('contacts'), events: of('events'), notes: of('notes'), invoices: of('invoices'), transactions: of('transactions'),
    money: money ? { read: money.read, reason: money.reason } : { read: false },
  }
}

/** "Forget the copy": everything read from QuiroHiro for this clinic. */
export async function dropQuirohiroSnapshot(admin: Admin, accountId: string) {
  const { error } = await admin.from('import_snapshots').delete().eq('account_id', accountId).eq('source', SOURCE)
  if (error) throw new Error(`import_snapshots: ${error.message}`)
}

// --- reading QuiroHiro ----------------------------------------------------------------

function noConnection(t: (en: string, es: string) => string) {
  return new QuirohiroError(t('No QuiroHiro connection is saved. Set it up in Settings > Import > QuiroHiro > Connection.', 'No hay ninguna conexión con QuiroHiro guardada. Configúrala en Ajustes > Importar > QuiroHiro > Conexión.'), 400)
}

const monthAdd = (ym: string, n: number) => { const d = new Date(`${ym}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7) }

/** One list's first page, for the lists that are a single request. */
async function readSingle(conn: QuirohiroConnection, list: ListName): Promise<unknown[]> {
  const L = conn.locationId
  switch (list) {
    case 'users': return (await quirohiroRequest<{ users?: unknown[] }>(conn, '/users/', { locationId: L })).users ?? []
    case 'calendars': return (await quirohiroRequest<{ calendars?: unknown[] }>(conn, '/calendars/', { locationId: L })).calendars ?? []
    // The location's list carries each TEXTBOX_LIST's sub-fields; the
    // object-key list carries the folders, and which of them are GoHighLevel's own.
    case 'fields': return (await quirohiroRequest<{ customFields?: unknown[] }>(conn, `/locations/${L}/customFields`, { model: 'contact' })).customFields ?? []
    case 'folders': return (await quirohiroRequest<{ folders?: unknown[] }>(conn, '/custom-fields/object-key/contact', { locationId: L })).folders ?? []
    default: throw new Error(`not a single-request list: ${list}`)
  }
}

export async function quirohiroReadSlice(
  admin: Admin,
  job: ImportJob,
  options: ImportJobOptions,
  progress: ImportJobProgress,
  deadline: number,
  beat: (live: ImportJobProgress) => void,
  t: (en: string, es: string) => string,
): Promise<Outcome> {
  const accountId = job.account_id
  const conn = await quirohiroSavedConnection(admin, accountId)
  if (!conn) throw noConnection(t)

  const p: ImportJobProgress = { ...progress, phase: 'read', listCount: QUIROHIRO_LISTS.length }
  if (!p.pass) Object.assign(p, { pass: randomUUID(), listIndex: 0, page: 1, cursor: undefined, pagesRead: {}, records: 0, done: 0 })
  const pass = p.pass!
  const next = (list: ListName, pages: number) => {
    p.pagesRead = { ...p.pagesRead, [list]: pages }
    Object.assign(p, { listIndex: (p.listIndex ?? 0) + 1, page: 1, pageCount: undefined, cursor: undefined })
  }

  while ((p.listIndex ?? 0) < QUIROHIRO_LISTS.length) {
    if (Date.now() >= deadline) return { progress: p }
    const list = QUIROHIRO_LISTS[p.listIndex ?? 0]!
    const page = p.page ?? 1

    if (list === 'users' || list === 'calendars' || list === 'fields' || list === 'folders') {
      const rows = await readSingle(conn, list)
      await savePage(admin, accountId, pass, list, 1, rows)
      p.records = (p.records ?? 0) + rows.length
      next(list, 1)
      beat(p)
      continue
    }

    if (list === 'contacts') {
      // GoHighLevel's cursor: the last contact's sort value and id.
      const after = p.cursor ? (JSON.parse(p.cursor) as { startAfter: number; startAfterId: string }) : null
      const res = await quirohiroRequest<{ contacts?: QuirohiroContact[]; meta?: { total?: number; startAfter?: number; startAfterId?: string } }>(conn, '/contacts/', {
        locationId: conn.locationId, limit: 100, startAfter: after?.startAfter, startAfterId: after?.startAfterId,
      })
      const rows = res.contacts ?? []
      if (rows.length) await savePage(admin, accountId, pass, list, page, rows)
      for (const c of rows) if (c.dateAdded && (!p.earliest || c.dateAdded.slice(0, 7) < p.earliest)) p.earliest = c.dateAdded.slice(0, 7)
      if (page === 1) p.pageCount = Math.max(1, Math.ceil(Number(res.meta?.total ?? rows.length) / 100))
      p.records = (p.records ?? 0) + rows.length
      p.done = (p.done ?? 0) + 1
      if (!rows.length || !res.meta?.startAfterId || page >= (p.pageCount ?? 1)) next(list, rows.length ? page : page - 1)
      else Object.assign(p, { page: page + 1, cursor: JSON.stringify({ startAfter: res.meta.startAfter, startAfterId: res.meta.startAfterId }) })
      beat(p)
      continue
    }

    if (list === 'events') {
      const calendars = await loadList<{ id: string }>(admin, accountId, pass, 'calendars')
      const now = new Date().toISOString().slice(0, 7)
      const from = monthAdd(p.earliest && p.earliest < now ? p.earliest : now, -12)
      const until = monthAdd(now, MONTHS_AHEAD)
      // Where the walk is: which calendar, which month, and the next page to
      // save (only months with appointments are saved). `page` counts months
      // asked for, for the progress bar.
      const at = p.cursor ? (JSON.parse(p.cursor) as { c: number; m: string; s: number }) : { c: 0, m: from, s: 1 }
      let months = 0
      for (let m = from; m <= until; m = monthAdd(m, 1)) months++
      p.pageCount = Math.max(1, calendars.length * months)
      while (at.c < calendars.length) {
        if (Date.now() >= deadline) return { progress: p }
        // A few months at once: one at a time, the round trip and not the
        // rate limit was what set the pace (about one a second).
        const windows: { c: number; m: string }[] = []
        for (const w = { c: at.c, m: at.m }; w.c < calendars.length && windows.length < EVENT_CONCURRENCY;) {
          windows.push({ ...w })
          if (w.m >= until) { w.c++; w.m = from } else w.m = monthAdd(w.m, 1)
        }
        const answers = await Promise.all(windows.map((w) => quirohiroRequest<{ events?: unknown[] }>(conn, '/calendars/events', {
          locationId: conn.locationId,
          calendarId: calendars[w.c]!.id,
          startTime: Date.parse(`${w.m}-01T00:00:00Z`),
          endTime: Date.parse(`${monthAdd(w.m, 1)}-01T00:00:00Z`) - 1,
        })))
        for (const res of answers) {
          const rows = res.events ?? []
          if (rows.length) { await savePage(admin, accountId, pass, list, at.s, rows); at.s++; p.records = (p.records ?? 0) + rows.length }
          p.done = (p.done ?? 0) + 1
          if (at.m >= until) { at.c++; at.m = from } else at.m = monthAdd(at.m, 1)
        }
        Object.assign(p, { page: (p.page ?? 1) + windows.length, cursor: JSON.stringify(at) })
        beat(p)
      }
      next(list, at.s - 1)
      continue
    }

    if (list === 'invoices' || list === 'transactions') {
      // Payments need two scopes the first tokens were made without. A token
      // that lacks them reads everything else, and the payments step says
      // what to tick; any other refusal still stops the read.
      try {
        const res = list === 'invoices'
          ? await quirohiroRequest<{ invoices?: { _id: string }[]; total?: number }>(conn, '/invoices/', { altId: conn.locationId, altType: 'location', limit: 100, offset: (page - 1) * 100 })
          : await quirohiroRequest<{ data?: { _id: string }[]; totalCount?: number }>(conn, '/payments/transactions', { altId: conn.locationId, altType: 'location', limit: 100, offset: (page - 1) * 100 })
        const rows = ((res as { invoices?: { _id: string }[] }).invoices ?? (res as { data?: { _id: string }[] }).data ?? []).map((r) => ({ ...r, id: r._id }))
        const total = Number((res as { total?: number }).total ?? (res as { totalCount?: number }).totalCount ?? rows.length)
        if (rows.length) await savePage(admin, accountId, pass, list, page, rows)
        if (page === 1) p.pageCount = Math.max(1, Math.ceil(total / 100))
        p.records = (p.records ?? 0) + rows.length
        p.done = (p.done ?? 0) + 1
        if (rows.length < 100 || page >= (p.pageCount ?? 1)) {
          if (list === 'transactions') await savePage(admin, accountId, pass, 'money', 1, [{ id: 'money', read: true }])
          next(list, rows.length ? page : page - 1)
        } else p.page = page + 1
      } catch (e) {
        if (!(e instanceof QuirohiroError) || e.statusCode !== 400 || !/permission|scope/i.test(e.message)) throw e
        await savePage(admin, accountId, pass, 'money', 1, [{ id: 'money', read: false, reason: t('the key cannot see payments', 'la clave no puede ver los pagos') }])
        // Neither list can be read: past both.
        next(list, 0)
        if (list === 'invoices') next('transactions', 0)
      }
      beat(p)
      continue
    }

    // Notes: one request per contact being imported. Who that is was settled
    // by the lists already read, and is kept beside them so every slice walks
    // the same list.
    let targets: string[]
    if (!p.cursor) {
      const [contacts, events, fields, folders] = await Promise.all((['contacts', 'events', 'fields', 'folders'] as const).map((l) => loadList<never>(admin, accountId, pass, l)))
      targets = quirohiroNoteTargets({ contacts: contacts!, events: events!, fields: fields!, folders: folders! }, whoOf(options))
      await savePage(admin, accountId, pass, 'targets', 1, targets.map((id) => ({ id })))
      Object.assign(p, { cursor: JSON.stringify({ i: 0, s: 1 }), pageCount: Math.max(1, Math.ceil(targets.length / NOTE_BATCH)) })
    } else {
      targets = (await loadList<{ id: string }>(admin, accountId, pass, 'targets')).map((x) => x.id)
    }
    // How far through the contacts, and the next page to save (only batches with notes are saved).
    const at = JSON.parse(p.cursor!) as { i: number; s: number }
    while (at.i < targets.length) {
      if (Date.now() >= deadline) return { progress: p }
      const batch = targets.slice(at.i, at.i + NOTE_BATCH)
      const notes: unknown[] = []
      const queue = [...batch]
      await Promise.all(Array.from({ length: NOTE_CONCURRENCY }, async () => {
        for (let id; (id = queue.shift());) {
          const res = await quirohiroRequest<{ notes?: { contactId?: string }[] }>(conn, `/contacts/${id}/notes`)
          for (const n of res.notes ?? []) notes.push({ ...n, contactId: n.contactId ?? id })
        }
      }))
      if (notes.length) { await savePage(admin, accountId, pass, list, at.s, notes); at.s++; p.records = (p.records ?? 0) + notes.length }
      at.i += batch.length
      p.done = (p.done ?? 0) + 1
      Object.assign(p, { page: (p.page ?? 1) + 1, cursor: JSON.stringify(at) })
      beat(p)
    }
    next(list, at.s - 1)
  }

  const pages = Object.fromEntries(Object.entries(p.pagesRead ?? {})) as QuirohiroMeta['pages']
  await finishRead(admin, accountId, { readAt: new Date().toISOString(), locationId: conn.locationId, pass, pages })
  return { progress: p, result: { step: 'read', written: p.records ?? 0, errors: [], warnings: [] } }
}

// --- import steps ---------------------------------------------------------------------

export async function quirohiroApplySlice(
  admin: Admin,
  job: ImportJob,
  kind: QuirohiroStepKind,
  options: ImportJobOptions,
  progress: ImportJobProgress,
  beat: (live: ImportJobProgress) => void,
  t: (en: string, es: string) => string,
  run: (plan: QuirohiroPlan, p: ImportJobProgress) => Promise<Outcome>,
): Promise<Outcome> {
  const p: ImportJobProgress = { ...progress, phase: 'apply' }
  const snapshot = await loadQuirohiroSnapshot(admin, job.account_id)
  if (!snapshot) {
    return { progress: p, result: { step: kind, written: 0, errors: [t('Nothing has been read from QuiroHiro yet.', 'Aún no se ha leído nada de QuiroHiro.')], warnings: [] } }
  }
  const plan = await quirohiroImporter({ supabase: admin, accountId: job.account_id, clinicId: job.clinic_id, t })
    .plan(kind, snapshot, { who: whoOf(options), quietUpcoming: options.quietUpcoming ?? true })

  if (options.dryRun) {
    beat(p)
    return {
      progress: p,
      result: { step: kind, written: 0, errors: [], warnings: plan.warnings.slice(0, 50), dryRun: true, stats: plan.stats.map(({ label, value }) => ({ label, value })), wouldWrite: plan.total },
    }
  }
  return run(plan, p)
}
