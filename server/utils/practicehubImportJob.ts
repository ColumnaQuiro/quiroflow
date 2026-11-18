import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { getAccountSecret } from '~/server/utils/accountSecrets'
import { practiceHubClassicGet } from '~/server/utils/practicehubClassic'
import { practicehubV3Get } from '~/server/utils/practicehubV3'
import { finishPracticeHubRead, loadPracticeHubSnapshot, savePracticeHubPage } from '~/server/utils/practicehubSnapshotStore'
import { planPracticeHubStep, PRACTICEHUB_LISTS, PRACTICEHUB_V3_LISTS, type PracticeHubStepKind } from '~/utils/practicehubImport'
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
  if (!conn) throw Object.assign(new Error(t('No PracticeHub connection is saved. Set it up in Settings > Import > Connection.', 'No hay ninguna conexión con PracticeHub guardada. Configúrala en Ajustes > Importar > Conexión.')), { statusCode: 400 })

  const p: ImportJobProgress = { ...progress, phase: 'read', listCount: PRACTICEHUB_LISTS.length }
  if (!p.pass) Object.assign(p, { pass: randomUUID(), listIndex: 0, page: 1, pageCount: undefined, pagesRead: {}, records: 0, done: 0 })

  let v3: Awaited<ReturnType<typeof practiceHubV3Saved>> | undefined
  while ((p.listIndex ?? 0) < PRACTICEHUB_LISTS.length) {
    if (Date.now() >= deadline) return { progress: p }
    const path = PRACTICEHUB_LISTS[p.listIndex ?? 0]!
    const page = p.page ?? 1

    if (PRACTICEHUB_V3_LISTS.has(path)) {
      // 2.0 walks by cursor and allows 120 requests a minute, so no spacing.
      if (v3 === undefined) v3 = await practiceHubV3Saved(admin, accountId)
      if (!v3) {
        // No 2.0 key: the list stays out of the copy, and the step that
        // wants it warns rather than planning from an empty one.
        Object.assign(p, { listIndex: (p.listIndex ?? 0) + 1, page: 1, pageCount: undefined, cursor: undefined })
        continue
      }
      const res = await practicehubV3Get<V3Page>(v3, path, { sort: 'created_at:asc', page_size: '100', cursor: p.cursor ?? '' })
      const rows = res.data ?? []
      await savePracticeHubPage(admin, accountId, p.pass!, path, page, rows)
      if (page === 1) {
        const total = Number(res.meta?.total ?? NaN)
        p.pageCount = Number.isFinite(total) && total > 0 ? Math.ceil(total / 100) : undefined
        p.records = (p.records ?? 0) + (Number.isFinite(total) ? total : rows.length)
      }
      p.done = (p.done ?? 0) + 1
      const next = res.links?.next ? new URL(res.links.next).searchParams.get('cursor') : null
      if (!next || !rows.length) {
        p.pagesRead = { ...p.pagesRead, [path]: page }
        Object.assign(p, { listIndex: (p.listIndex ?? 0) + 1, page: 1, pageCount: undefined, cursor: undefined })
      } else {
        Object.assign(p, { page: page + 1, cursor: next })
      }
      beat(p)
      continue
    }

    const res = await readPage(conn, path, page, deadline + PAGE_GRACE_MS)
    if (!res) return { progress: p }
    const rows = res.data ?? []
    await savePracticeHubPage(admin, accountId, p.pass!, path, page, rows)
    if (page === 1) {
      p.pageCount = rows.length ? Math.max(1, Math.ceil(Number(res.total_entries ?? rows.length) / rows.length)) : 1
      p.records = (p.records ?? 0) + Number(res.total_entries ?? rows.length)
    }
    p.done = (p.done ?? 0) + 1
    if (!rows.length || page >= (p.pageCount ?? 1)) {
      p.pagesRead = { ...p.pagesRead, [path]: page }
      Object.assign(p, { listIndex: (p.listIndex ?? 0) + 1, page: 1, pageCount: undefined })
    } else {
      p.page = page + 1
    }
    beat(p)
    await sleep(PAGE_GAP_MS)
  }

  await finishPracticeHubRead(admin, accountId, { readAt: new Date().toISOString(), baseUrl: conn.baseUrl, pass: p.pass!, pages: p.pagesRead ?? {} })
  return { progress: p, result: { step: 'read', written: p.records ?? 0, errors: [], warnings: [] } }
}

export async function practiceHubApplySlice(
  admin: Admin,
  job: ImportJob,
  kind: PracticeHubStepKind,
  options: ImportJobOptions,
  progress: ImportJobProgress,
  beat: (live: ImportJobProgress) => void,
  t: (en: string, es: string) => string,
  run: (plan: Awaited<ReturnType<typeof planPracticeHubStep>>, p: ImportJobProgress) => Promise<Outcome>,
): Promise<Outcome> {
  const accountId = job.account_id
  const p: ImportJobProgress = { ...progress, phase: 'apply' }
  const snapshot = await loadPracticeHubSnapshot(admin, accountId)
  if (!snapshot) {
    return { progress: p, result: { step: kind, written: 0, errors: [t('Nothing has been read from PracticeHub yet.', 'Aún no se ha leído nada de PracticeHub.')], warnings: [] } }
  }
  const { data: account } = await admin.from('accounts').select('default_phone_country').eq('id', accountId).maybeSingle()
  const plan = await planPracticeHubStep(kind, {
    supabase: admin,
    accountId,
    clinicId: job.clinic_id,
    defaultPhoneCountry: account?.default_phone_country || 'ES',
    t,
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
  return run(plan, p)
}
