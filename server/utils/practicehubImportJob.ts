import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'
import { practiceHubClassicGet } from '~/server/utils/practicehubClassic'
import { practicehubV3Get } from '~/server/utils/practicehubV3'
import { dropPracticeHubPass, finishPracticeHubRead, loadPracticeHubPassList, loadPracticeHubSnapshot, savePracticeHubPage } from '~/server/utils/practicehubSnapshotStore'
import { practiceHubFileServices } from '~/server/utils/practicehubFiles'
import { practiceHubLargeCopier } from '~/server/utils/practicehubLargeFile'
import { planPracticeHubStep, PRACTICEHUB_LINK_LISTS, PRACTICEHUB_LISTS, PRACTICEHUB_STEP_LISTS, PRACTICEHUB_V3_API_PATHS, PRACTICEHUB_V3_LISTS, type PracticeHubListPath, type PracticeHubPlan, type PracticeHubStepKind } from '~/utils/practicehubImport'
import { practiceHubLinksAfterLapse, practiceHubLinksAfterSlice, practiceHubLinksFresh, practiceHubLinksNewRead, practiceHubLinksStartNewRead } from '~/utils/practicehubImport/linkRefresh'
import type { ImportJobProgress, ImportJobStepResult } from '~/utils/importJobReport'
import type { ImportJob, ImportJobOptions } from '~/server/utils/importJobs'

// The PracticeHub half of server-side imports (server/utils/importJobs.ts runs
// the slices; this says what a PracticeHub slice does).
//
// READ walks every list in PRACTICEHUB_LISTS a page at a time into
// import_snapshots, the walk usePracticeHubApi's fetchAll does in the browser:
// the page count comes from the first page's total_entries, and an empty page
// ends the list early. Classic allows about one request a second, so pages
// are spaced that far apart instead of being fired and retried -- on a clinic
// of 1,500 patients and 8,700 appointments that is roughly five minutes over
// a dozen slices, every page saved as it arrives.
//
// The import steps plan from that copy (utils/practicehubImport) and write in
// chunks a slice can stop between. With options.dryRun they plan and stop:
// the step's result carries what it WOULD have written and nothing is.

type Admin = SupabaseClient<Database>
type Outcome = { progress: ImportJobProgress; result?: ImportJobStepResult }

/** Classic's rate limit is about a request a second; a little over keeps clear of its 429s. */
const PAGE_GAP_MS = 1100
const PAGE_TIMEOUT_MS = 20_000
const PAGE_ATTEMPTS = 4
/**
 * How far past the slice's deadline a page may still finish. A slice is cut
 * off at 60 s and its deadline is 35 s in (importJobs SLICE_MS); a request is
 * only started when even a full timeout would end before this.
 */
const PAGE_GRACE_MS = 15_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const statusOf = (e: unknown) => (e as { statusCode?: number })?.statusCode

/** The saved connection, as practicehub-proxy uses it when the browser sends no key. */
export async function practiceHubSavedConnection(admin: Admin, accountId: string) {
  const [{ data }, apiKey] = await Promise.all([
    admin.from('accounts').select('practicehub_base_url, practicehub_contact_email').eq('id', accountId).maybeSingle(),
    getAccountSecret(admin, accountId, 'practicehub_api_key'),
  ])
  if (!data?.practicehub_base_url || !apiKey) return null
  return { baseUrl: data.practicehub_base_url, apiKey, appDetails: `QuiroFlow=${data.practicehub_contact_email ?? ''}` }
}

interface ClassicPage { data?: unknown[] | null; total_entries?: number | null }
interface V3Page { data?: unknown[] | null; links?: { next?: string | null } | null; meta?: { total?: number | null } | null }

/** The saved 2.0 address and phk_ key, or null when the clinic has none. */
async function practiceHubV3Saved(admin: Admin, accountId: string) {
  const [{ data }, apiKey] = await Promise.all([
    admin.from('accounts').select('practicehub_base_url').eq('id', accountId).maybeSingle(),
    getAccountSecret(admin, accountId, 'practicehub_v3_api_key'),
  ])
  const baseUrl = (data?.practicehub_base_url ?? '').replace(/\/$/, '')
  return baseUrl && apiKey ? { baseUrl, apiKey } : null
}

/** One page, tried again on a rate limit or a timeout -- or null when there is no time left in this slice to ask, so the next slice asks instead. */
async function readPage(conn: { baseUrl: string; apiKey: string; appDetails: string }, path: string, page: number, until: number): Promise<ClassicPage | null> {
  for (let attempt = 1; ; attempt++) {
    if (Date.now() + PAGE_TIMEOUT_MS > until) return null
    try {
      return await practiceHubClassicGet<ClassicPage>(conn, path, { page: String(page), page_size: '100' }, { timeoutMs: PAGE_TIMEOUT_MS })
    } catch (e) {
      const status = statusOf(e)
      // A refused key or a wrong address will not come right by asking again
      // (practiceHubClassicGet has put them into words); a rate limit, a
      // timeout or PracticeHub having a moment will.
      const retryable = status === undefined || status === 429 || status >= 500
      if (!retryable || attempt >= PAGE_ATTEMPTS) throw e
      await sleep(Math.min(2000 * 2 ** (attempt - 1), Math.max(0, until - Date.now())))
    }
  }
}

/** Where a walk over some lists stands: the whole read's, or a step's fresh link list. */
type ReadState = Pick<ImportJobProgress, 'pass' | 'listIndex' | 'page' | 'pageCount' | 'cursor' | 'pagesRead' | 'records' | 'done'>

/**
 * Walks `paths` a page at a time into the copy under `state.pass`, saving each
 * page as it arrives. Returns true once every list is read, false when the
 * slice's time is up (the next slice carries on from `state`).
 */
async function readLists(
  admin: Admin,
  accountId: string,
  conn: { baseUrl: string; apiKey: string; appDetails: string },
  paths: readonly PracticeHubListPath[],
  state: ReadState,
  deadline: number,
  onPage: () => void,
): Promise<boolean> {
  let v3: Awaited<ReturnType<typeof practiceHubV3Saved>> | undefined
  while ((state.listIndex ?? 0) < paths.length) {
    if (Date.now() >= deadline) return false
    const path = paths[state.listIndex ?? 0]!
    const page = state.page ?? 1

    if (PRACTICEHUB_V3_LISTS.has(path)) {
      // 2.0 walks by cursor and allows 120 requests a minute, so no spacing.
      if (v3 === undefined) v3 = await practiceHubV3Saved(admin, accountId)
      if (!v3) {
        // No 2.0 key: the list stays out of the copy, and the step that
        // wants it warns rather than planning from an empty one.
        Object.assign(state, { listIndex: (state.listIndex ?? 0) + 1, page: 1, pageCount: undefined, cursor: undefined })
        continue
      }
      const res = await practicehubV3Get<V3Page>(v3, PRACTICEHUB_V3_API_PATHS[path] ?? path, { sort: 'created_at:asc', page_size: '100', cursor: state.cursor ?? '' })
      const rows = res.data ?? []
      await savePracticeHubPage(admin, accountId, state.pass!, path, page, rows)
      if (page === 1) {
        const total = Number(res.meta?.total ?? NaN)
        state.pageCount = Number.isFinite(total) && total > 0 ? Math.ceil(total / 100) : undefined
        state.records = (state.records ?? 0) + (Number.isFinite(total) ? total : rows.length)
      }
      state.done = (state.done ?? 0) + 1
      const next = res.links?.next ? new URL(res.links.next).searchParams.get('cursor') : null
      if (!next || !rows.length) {
        state.pagesRead = { ...state.pagesRead, [path]: page }
        Object.assign(state, { listIndex: (state.listIndex ?? 0) + 1, page: 1, pageCount: undefined, cursor: undefined })
      } else {
        Object.assign(state, { page: page + 1, cursor: next })
      }
      onPage()
      continue
    }

    const res = await readPage(conn, path, page, deadline + PAGE_GRACE_MS)
    if (!res) return false
    const rows = res.data ?? []
    await savePracticeHubPage(admin, accountId, state.pass!, path, page, rows)
    if (page === 1) {
      state.pageCount = rows.length ? Math.max(1, Math.ceil(Number(res.total_entries ?? rows.length) / rows.length)) : 1
      state.records = (state.records ?? 0) + Number(res.total_entries ?? rows.length)
    }
    state.done = (state.done ?? 0) + 1
    if (!rows.length || page >= (state.pageCount ?? 1)) {
      state.pagesRead = { ...state.pagesRead, [path]: page }
      Object.assign(state, { listIndex: (state.listIndex ?? 0) + 1, page: 1, pageCount: undefined })
    } else {
      state.page = page + 1
    }
    onPage()
    await sleep(PAGE_GAP_MS)
  }
  return true
}

function noConnection(t: (en: string, es: string) => string) {
  return Object.assign(new Error(t('No PracticeHub connection is saved. Set it up in Settings > Import > Connection.', 'No hay ninguna conexión con PracticeHub guardada. Configúrala en Ajustes > Importar > Conexión.')), { statusCode: 400 })
}

export async function practiceHubReadSlice(
  admin: Admin,
  job: ImportJob,
  progress: ImportJobProgress,
  deadline: number,
  beat: (live: ImportJobProgress) => void,
  t: (en: string, es: string) => string,
): Promise<Outcome> {
  const accountId = job.account_id
  const conn = await practiceHubSavedConnection(admin, accountId)
  if (!conn) throw noConnection(t)

  const p: ImportJobProgress = { ...progress, phase: 'read', listCount: PRACTICEHUB_LISTS.length }
  if (!p.pass) Object.assign(p, { pass: randomUUID(), listIndex: 0, page: 1, pageCount: undefined, pagesRead: {}, records: 0, done: 0 })
  if (!(await readLists(admin, accountId, conn, PRACTICEHUB_LISTS, p, deadline, () => beat(p)))) return { progress: p }

  await finishPracticeHubRead(admin, accountId, { readAt: new Date().toISOString(), baseUrl: conn.baseUrl, pass: p.pass!, pages: p.pagesRead ?? {} })
  return { progress: p, result: { step: 'read', written: p.records ?? 0, errors: [], warnings: [] } }
}

export async function practiceHubApplySlice(
  admin: Admin,
  job: ImportJob,
  kind: PracticeHubStepKind,
  options: ImportJobOptions,
  progress: ImportJobProgress,
  deadline: number,
  beat: (live: ImportJobProgress) => void,
  t: (en: string, es: string) => string,
  run: (plan: PracticeHubPlan, p: ImportJobProgress) => Promise<Outcome>,
): Promise<Outcome> {
  const accountId = job.account_id
  const p: ImportJobProgress = { ...progress, phase: 'apply' }
  // Only the lists this step plans from: the whole copy of a large clinic is
  // more than a slice can load and still plan (PRACTICEHUB_STEP_LISTS).
  const snapshot = await loadPracticeHubSnapshot(admin, accountId, PRACTICEHUB_STEP_LISTS[kind])
  if (!snapshot) {
    return { progress: p, result: { step: kind, written: 0, errors: [t('Nothing has been read from PracticeHub yet.', 'Aún no se ha leído nada de PracticeHub.')], warnings: [] } }
  }

  // A step that downloads works from a list read fresh just now, not from the
  // copy: see PRACTICEHUB_LINK_LISTS. A dry run downloads nothing, so it plans
  // from the copy when the copy has the list at all.
  const linkPath = PRACTICEHUB_LINK_LISTS[kind]
  if (linkPath && !(options.dryRun && snapshot.lists[linkPath])) {
    const links = p.links
    if (!practiceHubLinksFresh(links, Date.now())) {
      if (practiceHubLinksStartNewRead(links)) {
        // Starting a read of the list: the first, or after the links grew
        // old or lapsed (linkRefresh.ts).
        if (links?.pass) await dropPracticeHubPass(admin, accountId, links.pass)
        p.links = practiceHubLinksNewRead(links, `links-${randomUUID()}`)
      }
      const conn = await practiceHubSavedConnection(admin, accountId)
      if (!conn) throw noConnection(t)
      const state = p.links!
      const done = await readLists(admin, accountId, conn, [linkPath], state, deadline, () => beat({ ...p, phase: 'links' }))
      if (!done) return { progress: { ...p, phase: 'links' } }
      state.readAt = new Date().toISOString()
    }
    snapshot.lists[linkPath] = await loadPracticeHubPassList(admin, accountId, p.links!.pass!, linkPath)
  }

  const { data: account } = await admin.from('accounts').select('default_phone_country').eq('id', accountId).maybeSingle()
  const plan = await planPracticeHubStep(kind, {
    supabase: admin,
    accountId,
    clinicId: job.clinic_id,
    defaultPhoneCountry: account?.default_phone_country || 'ES',
    t,
    files: options.dryRun ? null : jobFileServices(admin, accountId),
  }, snapshot)

  if (options.dryRun) {
    beat(p)
    return {
      progress: p,
      result: {
        step: kind,
        written: 0,
        errors: [],
        warnings: plan.warnings.slice(0, 50),
        dryRun: true,
        stats: plan.stats.map(({ label, value }) => ({ label, value })),
        wouldWrite: plan.total,
      },
    }
  }

  // A download that met an expired link stops the step without finishing it:
  // the next slice reads the list again and plans what is still missing.
  let linksExpired = false
  const outcome = await run({
    ...plan,
    apply: async (progressCb, shouldStop) => {
      const res = await plan.apply(progressCb, () => linksExpired || shouldStop())
      if (res.linksExpired) linksExpired = true
      return res
    },
  }, p)
  const wroteSomething = (outcome.progress.written ?? 0) > (progress.written ?? 0)
  if (!linksExpired) {
    if (!outcome.result) outcome.progress.links = practiceHubLinksAfterSlice(outcome.progress.links, wroteSomething)
    return outcome
  }
  // Fresh links that lapse again before a single file is stored are not
  // going to come right by reading the list once more (S3 answers 403 for
  // more than expiry, and a slow clinic could lap its own links): after a few
  // refreshes in a row with nothing written, the step stops and says so, and
  // the next sync carries on from what is stored.
  const lapse = practiceHubLinksAfterLapse(outcome.progress.links, wroteSomething)
  if (lapse.giveUp) {
    const p2 = outcome.progress
    const errors = [t(
      'Stopped: PracticeHub\'s download links kept expiring before anything could be stored. Run the sync again later; what is stored stays.',
      'Parado: los enlaces de descarga de PracticeHub caducaban antes de poder guardar nada. Vuelve a sincronizar más tarde; lo guardado se queda.',
    ), ...(p2.errors ?? [])]
    return { progress: p2, result: { step: kind, written: p2.written ?? 0, errors, warnings: p2.warnings ?? [] } }
  }
  return { progress: { ...outcome.progress, stalls: 0, links: lapse.links } }
}

/**
 * The file services, with the piece-by-piece copy for large files when the
 * Storage URL and service key are to hand (they always are on the server; a
 * missing one leaves large files to the ordinary copy, as before).
 */
function jobFileServices(admin: SupabaseClient<Database>, accountId: string) {
  const services = practiceHubFileServices(admin, accountId)
  const config = useRuntimeConfig()
  const url = String(config.public?.supabase?.url ?? '')
  const key = String(config.supabase?.secretKey || config.supabase?.serviceKey || '')
  return url && key ? { ...services, copyLarge: practiceHubLargeCopier(admin, accountId, { url, key }) } : services
}
