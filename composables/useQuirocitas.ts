import type { ShallowRef } from 'vue'
import type { Tables } from '~/types/database.types'

// The Quirocitas importer's shared state: the saved connection, what the copy
// read from Quirocitas holds, and the import job running for this clinic.
//
// Quirocitas has no API, so reading a clinic is thousands of page loads --
// about ten minutes for 1,900 patients. That used to be a loop in this tab,
// with the copy kept in IndexedDB, and closing the tab stopped it. Now the
// read and every import step run on the server as an import job
// (server/utils/importJobs.ts): the screens start one, watch import_jobs, and
// can be closed. The copy stays on the server (import_snapshots); the browser
// only ever sees its counts and the previews planned from it.

export interface QuirocitasConnection { baseUrl: string | null; username: string | null; hasPassword: boolean }

export interface QuirocitasCopy {
  readAt: string
  state: { finished: boolean; read: number; total: number | null }
  failed: number
  months: number
  ledgerRows: number
  firstMonth: string | null
  mismatched: string[]
  counts: { patients: number; appointments: number; notes: number; segments: number; bonos: number; invoices: number; files: number } | null
}

export type ImportJobRow = Tables<'import_jobs'>

const connection = ref<QuirocitasConnection | null>(null)
const copy = ref<QuirocitasCopy | null>(null)
const copyLoaded = ref(false)
// shallowRef: a row with Json columns sends UnwrapRef into its recursive type.
const job = shallowRef<ImportJobRow | null>(null)

export function useQuirocitasConnection() {
  return connection
}

/** What the copy read from Quirocitas holds. Null when nothing has been read. */
export function useQuirocitasCopy() {
  return { copy, loaded: copyLoaded }
}

export async function loadQuirocitasConnection(force = false) {
  if (connection.value && !force) return connection.value
  connection.value = await useStaffFetch<QuirocitasConnection>('/api/import/quirocitas-connection').catch(() => null)
  return connection.value
}

export const quirocitasConnected = (c: QuirocitasConnection | null) => Boolean(c?.baseUrl && c.username && c.hasPassword)

export async function loadQuirocitasCopy(opts: { counts?: boolean } = {}) {
  copy.value = await useStaffFetch<QuirocitasCopy | null>('/api/import/quirocitas-copy', { query: opts.counts ? { counts: '1' } : {} }).catch(() => copy.value)
  copyLoaded.value = true
  return copy.value
}

export async function forgetQuirocitasCopy() {
  await useStaffFetch('/api/import/quirocitas-copy', { method: 'DELETE' })
  copy.value = null
}

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

// --- the import job ------------------------------------------------------------------

export const importJobActive = (j: ImportJobRow | null) => j?.status === 'queued' || j?.status === 'running'

let timer: ReturnType<typeof setInterval> | null = null
let watchers = 0

/**
 * The newest Quirocitas import job for this clinic, kept up to date while any
 * screen watches it. When one finishes, the copy's counts are read again, so
 * the step list shows what it did.
 */
export interface QuirocitasJobControls {
  job: ShallowRef<ImportJobRow | null>
  refresh(): Promise<void>
  start(steps: string[], options?: { quietUpcoming?: boolean; fromScratch?: boolean }): Promise<ImportJobRow | null>
  cancel(): Promise<void>
}

export function useQuirocitasJob(): QuirocitasJobControls {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const { preference } = useLang()

  async function refresh() {
    if (!store.accountId) return
    const before = job.value
    const { data } = await supabase
      .from('import_jobs')
      .select('*')
      .eq('account_id', store.accountId)
      .eq('source', 'quirocitas')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const fresh = (data ?? null) as ImportJobRow | null
    job.value = fresh
    if (before && importJobActive(before) && fresh && !importJobActive(fresh)) {
      await loadQuirocitasCopy({ counts: true })
    }
  }

  function poll() {
    if (timer) return
    timer = setInterval(() => { if (importJobActive(job.value)) refresh().catch(() => {}) }, 3000)
  }

  onMounted(() => {
    watchers++
    refresh().catch(() => {})
    poll()
  })
  onBeforeUnmount(() => {
    if (--watchers <= 0 && timer) { clearInterval(timer); timer = null }
  })

  async function start(steps: string[], options: { quietUpcoming?: boolean; fromScratch?: boolean } = {}) {
    job.value = await useStaffFetch<ImportJobRow>('/api/import/jobs', {
      method: 'POST',
      body: { source: 'quirocitas', steps, clinicId: store.currentClinicId ?? null, options: { ...options, lang: preference.value } },
    })
    poll()
    return job.value
  }

  async function cancel() {
    if (!job.value) return
    await useStaffFetch(`/api/import/jobs/${job.value.id}/cancel`, { method: 'POST' })
    await refresh()
  }

  return { job, refresh, start, cancel }
}
