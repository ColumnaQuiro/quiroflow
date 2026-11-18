import type { ShallowRef } from 'vue'
import type { Tables } from '~/types/database.types'
import type { ImportSource } from '~/utils/importJobReport'

// The newest server-side import job (import_jobs) for this clinic, per source,
// kept up to date while any screen watches it. Quirocitas and PracticeHub run
// through the same job runner (server/utils/importJobs.ts); this is the
// browser's side of it: start one, watch it, stop it. The tab can be closed at
// any point -- the job carries on.

export type ImportJobRow = Tables<'import_jobs'>

export const importJobActive = (j: ImportJobRow | null) => j?.status === 'queued' || j?.status === 'running'

export interface ImportJobControls {
  job: ShallowRef<ImportJobRow | null>
  refresh(): Promise<void>
  start(steps: string[], options?: { quietUpcoming?: boolean; fromScratch?: boolean; dryRun?: boolean }): Promise<ImportJobRow | null>
  cancel(): Promise<void>
}

interface SourceState {
  // shallowRef: a row with Json columns sends UnwrapRef into its recursive type.
  job: ShallowRef<ImportJobRow | null>
  timer: ReturnType<typeof setInterval> | null
  watchers: number
}

const states = new Map<ImportSource, SourceState>()

function stateOf(source: ImportSource): SourceState {
  let s = states.get(source)
  if (!s) states.set(source, (s = { job: shallowRef<ImportJobRow | null>(null), timer: null, watchers: 0 }))
  return s
}

/** `onFinished` runs once when a job this screen saw running has ended. */
export function useImportJob(source: ImportSource, onFinished?: () => unknown): ImportJobControls {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const { preference } = useLang()
  const state = stateOf(source)
  const job = state.job

  async function refresh() {
    if (!store.accountId) return
    const before = job.value
    const { data } = await supabase
      .from('import_jobs')
      .select('*')
      .eq('account_id', store.accountId)
      .eq('source', source)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const fresh = (data ?? null) as ImportJobRow | null
    job.value = fresh
    if (before && importJobActive(before) && fresh && !importJobActive(fresh)) await onFinished?.()
  }

  function poll() {
    if (state.timer) return
    state.timer = setInterval(() => { if (importJobActive(job.value)) refresh().catch(() => {}) }, 3000)
  }

  onMounted(() => {
    state.watchers++
    refresh().catch(() => {})
    poll()
  })
  onBeforeUnmount(() => {
    if (--state.watchers <= 0 && state.timer) { clearInterval(state.timer); state.timer = null }
  })

  async function start(steps: string[], options: { quietUpcoming?: boolean; fromScratch?: boolean; dryRun?: boolean } = {}) {
    job.value = await useStaffFetch<ImportJobRow>('/api/import/jobs', {
      method: 'POST',
      body: { source, steps, clinicId: store.currentClinicId ?? null, options: { ...options, lang: preference.value } },
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
