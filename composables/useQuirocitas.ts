import type { ImportJobControls } from '~/composables/useImportJob'

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

const connection = ref<QuirocitasConnection | null>(null)
const copy = ref<QuirocitasCopy | null>(null)
const copyLoaded = ref(false)

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
// The job itself (ImportJobRow, importJobActive, start/watch/stop) is in
// useImportJob, which PracticeHub shares.

/**
 * The newest Quirocitas import job for this clinic (useImportJob). When one
 * finishes, the copy's counts are read again, so the step list shows what it
 * did.
 */
export type QuirocitasJobControls = ImportJobControls

export function useQuirocitasJob(): QuirocitasJobControls {
  return useImportJob('quirocitas', () => loadQuirocitasCopy({ counts: true }))
}
