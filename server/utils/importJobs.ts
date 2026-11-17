import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, Tables } from '~/types/database.types'
import { getAccountSecret, setAccountSecret } from '~/server/utils/accountSecrets'
import { QuirocitasError, quirocitasClientFor, quirocitasLogin, type QuirocitasClient } from '~/server/utils/quirocitas'
import { storeQuirocitasFile } from '~/server/utils/quirocitasFiles'
import {
  dropQuirocitasRecords,
  loadLedgerPartial,
  loadQuirocitasList,
  loadQuirocitasMeta,
  loadQuirocitasSnapshot,
  quirocitasRecordStamps,
  saveLedgerPartial,
  saveQuirocitasList,
  saveQuirocitasMeta,
  saveQuirocitasRecords,
} from '~/server/utils/quirocitasSnapshotStore'
import { processStoredPatientFile } from '~/server/utils/patientFileProcessing'
import { deliverEmail } from '~/server/utils/resend'
import { quirocitasImporter, type QuirocitasStepKind } from '~/utils/quirocitasImport'
import type { QuirocitasBonoType, QuirocitasHistory, QuirocitasInvoice, QuirocitasListPatient, QuirocitasPatient } from '~/utils/quirocitasPages'
import { quirocitasDate, quirocitasReadQueue, type QuirocitasRecord, type QuirocitasTechniques } from '~/utils/quirocitasRows'
import { importJobEmail, type ImportJobProgress, type ImportJobStepResult } from '~/utils/importJobReport'
import { uiCatalogTranslate } from '~/utils/uiCatalog'

// Runs an import job (import_jobs) one slice at a time.
//
// A Netlify function stops at 60 seconds, and reading a clinic out of
// Quirocitas takes ten minutes or more, so no single request can do a job.
// Each slice claims the job, works for SLICE_MS, saves where it got to, lets
// go, and hands off to the next slice (POST /api/import/jobs/:id/slice). The
// hand-off can be lost -- a frozen function, a deploy in between -- so
// import-jobs-cron looks every minute for a job nobody holds and starts its
// next slice. Either way, a slice that dies mid-way loses only the work since
// its last save, and the next one carries on.
//
// Everything a slice writes can be written twice safely: patient records are
// keyed by Quirocitas id, and every import step finds what an earlier slice
// already wrote by its "QC-" reference and writes only what is missing. That
// is what makes "stop when time is up, plan again next slice" correct rather
// than merely convenient.

type Admin = SupabaseClient<Database>
export type ImportJob = Tables<'import_jobs'>

export interface ImportJobOptions { lang?: string; quietUpcoming?: boolean; fromScratch?: boolean }

/** Time a slice spends working. A function is cut off at 60 s; a file download or a 200-row insert in flight finishes after this. */
const SLICE_MS = 35_000
/** How long a slice holds its job. Longer than any slice can run, so the cron never starts a second one beside it. */
const LEASE_MS = 65_000
/** A slice that throws is tried again this many times in a row before the job is given up as failed. */
const MAX_FAILURES = 4
/** Slices in a row that run out of time having written nothing: something takes longer than a slice, and repeating it will not help. */
const MAX_STALLS = 3

const CONCURRENCY = 3
const TECHNIQUE_BATCH = 20
const LEDGER_MONTHS_PER_CALL = 4

export function importJobT(lang: string | undefined) {
  return (en: string, es: string) => {
    if (!lang || lang === 'es') return es
    if (lang === 'en') return en
    return uiCatalogTranslate(lang as never, en)
  }
}

const errText = (e: unknown) => (e as { statusMessage?: string; message?: string })?.statusMessage ?? (e as { message?: string })?.message ?? String(e)

/** Takes the job for one slice, or null when another slice holds it or it is over. */
async function claim(admin: Admin, jobId: string): Promise<ImportJob | null> {
  const now = new Date()
  const { data, error } = await admin
    .from('import_jobs')
    .update({ locked_until: new Date(now.getTime() + LEASE_MS).toISOString(), status: 'running' })
    .eq('id', jobId)
    .in('status', ['queued', 'running'])
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`import_jobs: ${error.message}`)
  return data
}

/**
 * One slice of a job. Returns whether there is more to do -- the caller then
 * starts the next slice.
 */
export async function runImportSlice(admin: Admin, jobId: string): Promise<{ claimed: boolean; more: boolean; retryLater?: boolean }> {
  const job = await claim(admin, jobId)
  if (!job) return { claimed: false, more: false }

  const deadline = Date.now() + SLICE_MS
  const options = (job.options ?? {}) as ImportJobOptions
  const t = importJobT(options.lang)
  let progress = { ...((job.progress ?? {}) as ImportJobProgress) }
  const results = [...((job.results ?? []) as unknown as ImportJobStepResult[])]
  let stepIndex = job.step_index
  let status = 'running'
  let error: string | null = null
  let threw = false

  // Live progress while the slice works, a few seconds apart, so the screen
  // moves between slices too. The lock is not touched here.
  // Chained, and waited for before the slice saves: a beat landing after
  // that save would put this step's counts back on the next one.
  let lastBeat = 0
  let beats: Promise<unknown> = Promise.resolve()
  const beat = (live: ImportJobProgress) => {
    if (Date.now() - lastBeat < 4000) return
    lastBeat = Date.now()
    const snapshot = { ...live }
    beats = beats.then(() => admin.from('import_jobs').update({ progress: snapshot as unknown as Json }).eq('id', job.id).then(() => {}, () => {}))
  }

  try {
    if (job.cancel_requested) {
      status = 'cancelled'
    } else {
      const step = job.steps[stepIndex]!
      const login = await quirocitasLogin(admin, job.account_id)
      if (!login) throw new QuirocitasError('The Quirocitas connection is not saved any more.', 400)
      const client = quirocitasClientFor(admin, job.account_id, login)
      const outcome = step === 'read'
        ? await readSlice(admin, job, client, login.baseUrl, options, progress, deadline, beat, t)
        : await applySlice(admin, job, client, step as QuirocitasStepKind, options, progress, deadline, beat, t)
      progress = { ...outcome.progress, failures: 0 }
      if (outcome.result) {
        results.push(outcome.result)
        stepIndex++
        progress = {}
        if (stepIndex >= job.steps.length) status = 'done'
      }
    }
  } catch (e) {
    threw = true
    const failures = (progress.failures ?? 0) + 1
    progress = { ...progress, failures, lastError: errText(e) }
    // Quirocitas refusing the login will not fix itself by trying again.
    const permanent = e instanceof QuirocitasError && e.statusCode >= 400 && e.statusCode < 500
    if (permanent || failures >= MAX_FAILURES) {
      status = 'failed'
      error = errText(e)
    }
    console.error(`[import-jobs] ${job.id} slice failed (${failures}):`, e)
  }

  await beats
  const finished = status !== 'running'
  const { error: saveError } = await admin
    .from('import_jobs')
    .update({
      status,
      step_index: stepIndex,
      progress: progress as unknown as Json,
      results: results as unknown as Json,
      error,
      locked_until: null,
      slices: job.slices + 1,
      started_at: job.started_at ?? new Date().toISOString(),
      ...(finished ? { finished_at: new Date().toISOString() } : {}),
    })
    .eq('id', job.id)
  if (saveError) console.error(`[import-jobs] ${job.id} could not save its slice:`, saveError.message)

  if (finished) await notifyImportJobFinished(admin, job.id).catch((e) => console.error(`[import-jobs] ${job.id} email:`, e))
  // A slice that failed is not handed straight on: Quirocitas being down for a
  // moment would otherwise use up every retry in a few seconds. The cron
  // tries again within a minute, so MAX_FAILURES spans a few minutes.
  return { claimed: true, more: !finished && !threw, retryLater: !finished && threw }
}

// --- reading Quirocitas ---------------------------------------------------------------

type Outcome = { progress: ImportJobProgress; result?: ImportJobStepResult }

/**
 * The read, as the browser used to do it (it is the same walk, see
 * quirocitasReadQueue): the patient list, every patient's record, history,
 * invoices and adjusted segments, then the cash ledger back to the month of
 * the oldest visit. A finished copy is read again in full, for what changed
 * since; a read that stopped part way carries on.
 */
async function readSlice(
  admin: Admin,
  job: ImportJob,
  client: QuirocitasClient,
  baseUrl: string,
  options: ImportJobOptions,
  progress: ImportJobProgress,
  deadline: number,
  beat: (live: ImportJobProgress) => void,
  t: (en: string, es: string) => string,
): Promise<Outcome> {
  const accountId = job.account_id
  const p: ImportJobProgress = { ...progress }

  if (!p.phase || p.phase === 'list') {
    p.phase = 'list'
    beat(p)
    const list = await client.patientList()
    // "Read everything from scratch" forgets the old copy; anything else
    // carries on from it.
    const previous = options.fromScratch ? null : await loadQuirocitasMeta(admin, accountId)
    const stamps = await quirocitasRecordStamps(admin, accountId)
    const now = new Date().toISOString()
    const ids = list.map((x) => x.id)
    const { passStartedAt } = quirocitasReadQueue(
      previous ? { ...previous, patients: Object.fromEntries([...stamps].map(([id, readAt]) => [id, { readAt } as QuirocitasRecord])) } : null,
      ids,
      now,
    )
    // Records already in the copy stay until they are fetched again, so a
    // patient Quirocitas fails to send this time keeps the earlier copy. Only
    // patients the list no longer names go.
    const listed = new Set(ids)
    const gone = options.fromScratch ? [...stamps.keys()] : [...stamps.keys()].filter((id) => !listed.has(id))
    if (gone.length) await dropQuirocitasRecords(admin, accountId, gone)
    await saveQuirocitasList(admin, accountId, list)
    await saveLedgerPartial(admin, accountId, null)
    // The ledger is read last and emptied while a pass runs: a copy without
    // months is an unfinished read, and every import step treats it so.
    await saveQuirocitasMeta(admin, accountId, {
      baseUrl,
      readAt: now,
      bonoTypes: previous?.bonoTypes ?? [],
      failed: {},
      ledger: [],
      ledgerMonths: [],
      passStartedAt,
      listTotal: list.length,
    })
    Object.assign(p, { phase: 'patients', passStartedAt, total: list.length, done: 0, failed: 0 })
    beat(p)
  }

  if (p.phase === 'patients') {
    const list = await loadQuirocitasList(admin, accountId)
    const meta = (await loadQuirocitasMeta(admin, accountId))!
    const stamps = await quirocitasRecordStamps(admin, accountId)
    const pass = p.passStartedAt ?? meta.passStartedAt ?? ''
    const queue: QuirocitasListPatient[] = list.filter((x) => !meta.failed[x.id] && (!stamps.has(x.id) || stamps.get(x.id)! < pass))
    const waiting = queue.length
    p.total = list.length
    p.done = list.length - waiting
    p.failed = Object.keys(meta.failed).length

    let bonoTypes: QuirocitasBonoType[] | null = null
    const unsaved: QuirocitasRecord[] = []
    const flush = async () => { const batch = unsaved.splice(0); await saveQuirocitasRecords(admin, accountId, batch) }

    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (let x; Date.now() < deadline && (x = queue.shift());) {
        try {
          const read = await client.patient(x.id, x.name) as { ficha: QuirocitasPatient; history: QuirocitasHistory; invoices: QuirocitasInvoice[]; bonoTypes: QuirocitasBonoType[] }
          bonoTypes ??= read.bonoTypes
          const techniques: Record<string, QuirocitasTechniques> = {}
          const citaIds = read.history.visits.map((v) => v.citaId).filter(Boolean)
          for (let i = 0; i < citaIds.length; i += TECHNIQUE_BATCH) {
            Object.assign(techniques, await client.techniques(citaIds.slice(i, i + TECHNIQUE_BATCH), read.history.segments))
          }
          unsaved.push({ list: x, ficha: read.ficha, history: read.history, invoices: read.invoices, techniques, readAt: new Date().toISOString() })
          delete meta.failed[x.id]
        } catch (e) {
          meta.failed[x.id] = errText(e)
        }
        p.done = (p.done ?? 0) + 1
        p.failed = Object.keys(meta.failed).length
        if (unsaved.length >= 10) await flush()
        beat(p)
      }
    }))
    await flush()
    if (bonoTypes) meta.bonoTypes = bonoTypes
    await saveQuirocitasMeta(admin, accountId, meta)
    if (queue.length) return { progress: p }

    // Every patient has been read: on to the ledger, back to the oldest visit.
    const copy = await loadQuirocitasSnapshot(admin, accountId)
    let earliest = '9999-99'
    for (const r of Object.values(copy?.patients ?? {})) {
      for (const v of r.ficha.visits) { const d = quirocitasDate(v.date); if (d && d.slice(0, 7) < earliest) earliest = d.slice(0, 7) }
    }
    await saveLedgerPartial(admin, accountId, { ledger: [], months: [], earliest })
    Object.assign(p, { phase: 'ledger', ledgerStarted: false, month: undefined })
    if (Date.now() >= deadline) return { progress: p }
  }

  if (p.phase === 'ledger') {
    const partial = (await loadLedgerPartial(admin, accountId)) ?? { ledger: [], months: [], earliest: '9999-99' }
    let restart = !p.ledgerStarted || !partial.months.length
    if (restart) { partial.ledger = []; partial.months = [] }
    for (;;) {
      if (Date.now() >= deadline) {
        await saveLedgerPartial(admin, accountId, partial)
        return { progress: p }
      }
      // Where the walk stands is kept server-side, as it always was: what is
      // submitted to Quirocitas' cash page is only ever a form it rendered.
      const saved = restart ? null : await getAccountSecret(admin, accountId, 'quirocitas_ledger_cursor')
      if (!restart && !saved) { restart = true; partial.ledger = []; partial.months = []; continue }
      const { months, cursor } = await client.ledger(saved ? JSON.parse(saved) : null, LEDGER_MONTHS_PER_CALL)
      await setAccountSecret(admin, accountId, 'quirocitas_ledger_cursor', JSON.stringify(cursor))
      restart = false
      p.ledgerStarted = true
      for (const m of months) {
        partial.ledger.push(...m.rows)
        const sum = (k: 'cash' | 'card' | 'transfer') => Math.round(m.rows.reduce((a, r) => a + (r[k] ?? 0), 0) * 100) / 100
        // client.ledger throws on a month it could not name, so each has one.
        partial.months.push({ month: m.month!, rows: m.rows.length, printed: m.totals, summed: { cash: sum('cash'), card: sum('card'), transfer: sum('transfer') } })
      }
      const last = months[months.length - 1]!.month!
      p.month = last
      p.done = partial.months.length
      beat(p)
      if (last <= partial.earliest) break
    }
    const meta = (await loadQuirocitasMeta(admin, accountId))!
    await saveQuirocitasMeta(admin, accountId, { ...meta, ledger: partial.ledger, ledgerMonths: partial.months, readAt: new Date().toISOString() })
    await saveLedgerPartial(admin, accountId, null)
    const failed = Object.keys(meta.failed).length
    return {
      progress: p,
      result: {
        step: 'read',
        written: Number(meta.listTotal ?? 0) - failed,
        errors: failed ? [t(`${failed} patients could not be read from Quirocitas. Read again to retry them.`, `${failed} pacientes no se pudieron leer de Quirocitas. Vuelve a leer para reintentarlo.`)] : [],
        warnings: [],
      },
    }
  }
  return { progress: p }
}

// --- import steps ---------------------------------------------------------------------

async function applySlice(
  admin: Admin,
  job: ImportJob,
  client: QuirocitasClient,
  kind: QuirocitasStepKind,
  options: ImportJobOptions,
  progress: ImportJobProgress,
  deadline: number,
  beat: (live: ImportJobProgress) => void,
  t: (en: string, es: string) => string,
): Promise<Outcome> {
  const accountId = job.account_id
  const p: ImportJobProgress = { ...progress, phase: 'apply' }
  const snapshot = await loadQuirocitasSnapshot(admin, accountId)
  if (!snapshot) {
    return { progress: p, result: { step: kind, written: 0, errors: [t('Nothing has been read from Quirocitas yet.', 'Aún no se ha leído nada de Quirocitas.')], warnings: [] } }
  }

  const importer = quirocitasImporter({
    supabase: admin,
    accountId,
    clinicId: job.clinic_id,
    t,
    fetchFile: (body) => storeQuirocitasFile(admin, accountId, client, body),
    compressFile: (fileId) => compressStoredFile(admin, accountId, fileId),
  })
  const plan = await importer.plan(kind, snapshot, { quietUpcoming: options.quietUpcoming ?? true })
  // The first slice of a step sets what the bar counts to; later slices plan
  // only what is left, so the total is not taken from them.
  if (p.total === undefined) { p.total = plan.total; p.warnings = plan.warnings }
  // The bar counts work done, the result counts rows written. Both carry on
  // from what earlier slices saved; `done` is saved as it goes, so the bar
  // never goes back even when a slice dies before its end.
  const doneBefore = p.done ?? 0
  const writtenBefore = p.written ?? 0
  let outOfTime = false
  const res = await plan.apply(
    (n) => { p.done = Math.min(p.total ?? Infinity, doneBefore + n); beat(p) },
    () => { if (Date.now() >= deadline) outOfTime = true; return outOfTime },
  )
  p.written = writtenBefore + res.written
  p.errors = [...(p.errors ?? []), ...res.errors].slice(0, 200)

  if (outOfTime) {
    p.stalls = res.written ? 0 : (p.stalls ?? 0) + 1
    if (p.stalls < MAX_STALLS) return { progress: p }
    p.errors.unshift(t('Stopped: this step made no progress in three tries.', 'Parado: este paso no avanzó en tres intentos.'))
  }
  return { progress: p, result: { step: kind, written: p.written, errors: p.errors, warnings: p.warnings ?? [] } }
}

/** What /api/patients/files/compress does for a file uploaded from a browser. */
async function compressStoredFile(admin: Admin, accountId: string, fileId: string) {
  const { data: file } = await admin
    .from('patient_files')
    .select('id, storage_path, file_type, size_bytes, compressed_at, thumb_path')
    .eq('id', fileId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!file?.storage_path || file.compressed_at) return
  await processStoredPatientFile(admin, { ...file, storage_path: file.storage_path }, { write: true })
}

// --- starting the next slice ----------------------------------------------------------

/**
 * Starts the next slice in a request of its own and does not wait for it: the
 * slice runs in its own function invocation whether or not anyone is still
 * listening. If this is lost, import-jobs-cron starts it within a minute.
 */
export async function startImportSlice(origin: string, jobId: string) {
  const secret = String(useRuntimeConfig().cronSecret ?? '')
  if (!secret) return
  await fetch(`${origin}/api/import/jobs/${jobId}/slice`, {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
    signal: AbortSignal.timeout(1500),
  }).catch(() => {})
}

// --- telling whoever started it -------------------------------------------------------

/** Emails the person who started the job, once. */
export async function notifyImportJobFinished(admin: Admin, jobId: string) {
  // Claimed before sending, so a slice and a retry never both send it.
  const { data: job } = await admin
    .from('import_jobs')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', jobId)
    .is('notified_at', null)
    .in('status', ['done', 'failed'])
    .select('*')
    .maybeSingle()
  if (!job?.started_by) return
  const { data: member } = await admin.from('team_members').select('user_id, full_name').eq('id', job.started_by).maybeSingle()
  if (!member?.user_id) return
  const { data: user } = await admin.auth.admin.getUserById(member.user_id)
  const to = user?.user?.email
  if (!to) return
  const { data: account } = await admin.from('accounts').select('name').eq('id', job.account_id).maybeSingle()
  const options = (job.options ?? {}) as ImportJobOptions
  const mail = importJobEmail({
    t: importJobT(options.lang),
    lang: options.lang ?? 'es',
    clinicName: account?.name ?? '',
    status: job.status as 'done' | 'failed',
    steps: job.steps,
    results: (job.results ?? []) as unknown as ImportJobStepResult[],
    error: job.error,
    url: 'https://app.quiroflow.com/settings/import?source=quirocitas&type=full',
  })
  await deliverEmail({ to, ...mail })
}
