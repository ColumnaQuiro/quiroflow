// The PracticeHub website sign-in and the two server jobs that use it, as
// Settings > Import shows them (server/api/import/practicehub-web.post.ts).
// Signed forms and Invoice originals are separate steps over one sign-in, so
// both read the same status and send ops to the same route.

type JobStatus = 'idle' | 'running' | 'needs_code' | 'stopped' | 'failed' | 'done'

export interface PracticeHubWebStatus {
  hasAddress: boolean
  email: string | null
  connected: boolean
  code: { method: 'app' | 'email'; phone: string | null } | null
  /** The signed-forms job. */
  job: { status: JobStatus; cursor: number; patients: number; stored: number; unmatched: number; failed: number; error: string | null; updatedAt: string | null }
  forms: number
  originals: number
  invoiceOriginals: {
    job: { status: JobStatus; cursor: number; total: number; stored: number; notHere: number; mismatched: number; mismatchExamples: string[]; failed: number; error: string | null; updatedAt: string | null }
    invoices: number
    originals: number
  }
}

/**
 * `live` says when the step's job can change without a click here, so the
 * page asks the server how far it got. A code PracticeHub is waiting for
 * counts too: it can be typed in the other step.
 */
export function usePracticeHubWeb(live: (status: PracticeHubWebStatus) => boolean) {
  const status = ref<PracticeHubWebStatus | null>(null)
  const busy = ref(false)
  const error = ref('')

  async function call(body: Record<string, unknown>): Promise<boolean> {
    error.value = ''
    try {
      status.value = await useStaffFetch<PracticeHubWebStatus>('/api/import/practicehub-web', { method: 'POST', body })
      return true
    } catch (e: any) {
      error.value = e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? String(e)
      return false
    }
  }

  async function act(body: Record<string, unknown>): Promise<boolean> {
    busy.value = true
    const ok = await call(body)
    busy.value = false
    return ok
  }

  let timer: ReturnType<typeof setInterval> | null = null
  watch(
    () => Boolean(status.value && (live(status.value) || status.value.code)),
    (on) => {
      if (timer) clearInterval(timer)
      timer = on ? setInterval(() => call({ op: 'status' }), 4000) : null
    },
  )
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
  })
  onMounted(() => call({ op: 'status' }))

  return { status, busy, error, call, act }
}
