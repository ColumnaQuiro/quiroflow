// Growth > Automations > Executions: what each lead automation actually did.
//
// The n8n Executions tab, rebuilt for the drip that moved in-app. A list of
// runs (filterable by status and workflow), one run's step-by-step history,
// and Retry for a run that failed.

export type RunStatus = 'running' | 'done' | 'cancelled' | 'failed'

export interface ExecutionRow {
  id: string
  ruleId: string
  ruleName: string
  leadId: string
  leadName: string
  leadContact: string | null
  status: RunStatus
  stoppedReason: string | null
  currentStep: string | null
  attempts: number
  lastError: string | null
  resumeAt: string | null
  startedAt: string
  updatedAt: string
}

export interface ExecutionEvent {
  id: string
  position: number | null
  actionType: string | null
  stepLabel: string | null
  outcome: 'started' | 'sent' | 'dry_run' | 'skipped' | 'failed' | 'waiting' | 'deferred' | 'stopped' | 'finished' | 'retried'
  detail: string | null
  actor: string | null
  at: string
}

export interface ExecutionDetail {
  run: Omit<ExecutionRow, 'currentStep' | 'leadContact'> & { dryRun: boolean; leadPhone: string | null; leadEmail: string | null }
  events: ExecutionEvent[]
}

export type ExecutionCounts = Record<RunStatus, number>

export function useGrowthExecutions() {
  const runs = ref<ExecutionRow[]>([])
  const counts = ref<ExecutionCounts>({ running: 0, done: 0, cancelled: 0, failed: 0 })
  const nextBefore = ref<string | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref('')

  const statusFilter = ref<RunStatus | null>(null)
  const ruleFilter = ref<string | null>(null)

  const selectedId = ref<string | null>(null)
  const detail = ref<ExecutionDetail | null>(null)
  const detailLoading = ref(false)
  const retrying = ref(false)
  const retryError = ref('')

  function params(before?: string | null) {
    const p: Record<string, string> = {}
    if (statusFilter.value) p.status = statusFilter.value
    if (ruleFilter.value) p.ruleId = ruleFilter.value
    if (before) p.before = before
    return p
  }

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const result = await useStaffFetch<{ runs: ExecutionRow[]; nextBefore: string | null; counts: ExecutionCounts }>('/api/growth/automation-runs', { params: params() })
      runs.value = result.runs
      nextBefore.value = result.nextBefore
      counts.value = result.counts
    } catch (e: any) {
      error.value = e?.data?.statusMessage ?? e?.message ?? 'Could not load executions.'
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (!nextBefore.value) return
    loadingMore.value = true
    try {
      const result = await useStaffFetch<{ runs: ExecutionRow[]; nextBefore: string | null; counts: ExecutionCounts }>('/api/growth/automation-runs', { params: params(nextBefore.value) })
      runs.value = [...runs.value, ...result.runs]
      nextBefore.value = result.nextBefore
    } finally {
      loadingMore.value = false
    }
  }

  async function open(id: string) {
    selectedId.value = id
    retryError.value = ''
    detailLoading.value = true
    try {
      detail.value = await useStaffFetch<ExecutionDetail>(`/api/growth/automation-runs/${id}`)
    } catch {
      detail.value = null
    } finally {
      detailLoading.value = false
    }
  }

  function close() {
    selectedId.value = null
    detail.value = null
  }

  async function retry(id: string) {
    retrying.value = true
    retryError.value = ''
    try {
      await useStaffFetch(`/api/growth/automation-runs/${id}/retry`, { method: 'POST' })
    } catch (e: any) {
      retryError.value = e?.data?.statusMessage ?? e?.message ?? 'Retry failed.'
    } finally {
      retrying.value = false
    }
    // Whatever happened, both views show it: the retry either got through,
    // failed again (with a new line in the history), or was refused.
    await Promise.all([open(id), load()])
  }

  watch([statusFilter, ruleFilter], load)

  return {
    runs,
    counts,
    nextBefore,
    loading,
    loadingMore,
    error,
    statusFilter,
    ruleFilter,
    selectedId,
    detail,
    detailLoading,
    retrying,
    retryError,
    load,
    loadMore,
    open,
    close,
    retry,
  }
}
