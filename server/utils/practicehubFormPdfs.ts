// The job that brings each submitted form's signed original across from
// PracticeHub's website and files it with the patient.
//
// It runs with nobody watching. A clinic saves its PracticeHub sign-in, presses
// start and can close everything: each run does a few seconds of work, records
// where it got to, and calls the next run itself. It does not depend on a
// browser tab the way the other import steps do, because this one is thousands
// of downloads rather than one list.
//
// What a run does:
//   1. reads every patient's website id (one request);
//   2. from where the last run stopped, asks for each patient's submitted
//      forms (about 60 ms each);
//   3. for each form imported here that has no original yet, downloads the
//      PDF (about half a second) and stores it as a file on that patient,
//      under PH-form-pdf-<response id>.
//
// Measured on a clinic with 1,535 patients and 2,703 forms: about half a
// minute of step 2 and seven of step 3, at three requests at a time.
//
// It is resumable by construction and safe to run twice. A form whose
// original is already stored is skipped; the storage key is fixed per
// response, so a retry overwrites its own object; and patient_files has a
// unique (account, external_reference), so two runs racing cannot file the
// same PDF twice.
//
// State lives in account_secrets under 'practicehub_forms_job' -- not because
// it is secret, but because only the server reads it and one row per account
// is all it needs, the same reasoning as quirocitas_ledger_cursor.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { getAccountSecret, setAccountSecret } from '~/server/utils/accountSecrets'
import { PracticeHubCodeNeeded, practiceHubWebClientFor } from '~/server/utils/practicehubWeb'
import { practiceHubFormPdfReference } from '~/utils/practicehubWebPages'
import { sanitizeStorageFilename } from '~/utils/storageFilename'

type Admin = SupabaseClient<Database>

export interface PracticeHubFormsJob {
  /**
   * idle: never started. running: runs are chaining. needs_code: PracticeHub
   * wants a verification code before it will sign the import in again.
   * stopped: a person stopped it. failed: it gave up, `error` says why.
   */
  status: 'idle' | 'running' | 'needs_code' | 'stopped' | 'failed' | 'done'
  /** How many patients have been asked for their forms, of `patients`. */
  cursor: number
  patients: number
  /** Originals stored by this job since it was started. */
  stored: number
  /** Forms PracticeHub lists that are not imported here, so there was nothing to attach to. */
  unmatched: number
  /** Forms whose PDF could not be fetched or stored; a later start retries them. */
  failed: number
  error: string | null
  codeMethod: 'app' | 'email' | null
  codePhone: string | null
  /** A run holds the job until this time, so two never walk the same patients. */
  leaseUntil: number
  /** Consecutive runs that got nowhere. Stops a job that can only fail from chaining forever. */
  stalls: number
  startedAt: string | null
  updatedAt: string | null
}

export const EMPTY_FORMS_JOB: PracticeHubFormsJob = {
  status: 'idle', cursor: 0, patients: 0, stored: 0, unmatched: 0, failed: 0, error: null,
  codeMethod: null, codePhone: null, leaseUntil: 0, stalls: 0, startedAt: null, updatedAt: null,
}

// A run's working time. Netlify gives a function ten seconds by default, and a
// run also spends about a second and a half reading before the work, lets the
// downloads in flight finish after it, saves, and waits a second on the call
// that starts the next run. This is what is left with room to spare.
const BUDGET_MS = 4_500
const LEASE_MS = 25_000
// PracticeHub's API answers 429 at two requests at once. Its website took
// three without complaint when measured; no more than that is asked of it.
const CONCURRENCY = 3
const MAX_STALLS = 5

export async function loadFormsJob(admin: Admin, accountId: string): Promise<PracticeHubFormsJob> {
  const raw = await getAccountSecret(admin, accountId, 'practicehub_forms_job')
  if (!raw) return { ...EMPTY_FORMS_JOB }
  try {
    return { ...EMPTY_FORMS_JOB, ...(JSON.parse(raw) as Partial<PracticeHubFormsJob>) }
  } catch {
    return { ...EMPTY_FORMS_JOB }
  }
}

export async function saveFormsJob(admin: Admin, accountId: string, job: PracticeHubFormsJob): Promise<void> {
  await setAccountSecret(admin, accountId, 'practicehub_forms_job', JSON.stringify({ ...job, updatedAt: new Date().toISOString() }))
}

async function readAll<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

/** How many imported forms there are, and how many have their original. For the Settings step. */
export async function formPdfCounts(admin: Admin, accountId: string): Promise<{ forms: number; originals: number }> {
  const [forms, originals] = await Promise.all([
    admin.from('patient_docs').select('id', { count: 'exact', head: true }).eq('account_id', accountId).like('external_reference', 'PH-form-%'),
    admin.from('patient_files').select('id', { count: 'exact', head: true }).eq('account_id', accountId).like('external_reference', 'PH-form-pdf-%'),
  ])
  return { forms: forms.count ?? 0, originals: originals.count ?? 0 }
}

/**
 * One run. Returns the job as it now stands; the caller chains another run
 * while it says 'running'.
 */
export async function runFormsJobSlice(admin: Admin, accountId: string, now = Date.now()): Promise<PracticeHubFormsJob> {
  const job = await loadFormsJob(admin, accountId)
  if (job.status !== 'running' || job.leaseUntil > now) return job
  job.leaseUntil = now + LEASE_MS
  await saveFormsJob(admin, accountId, job)

  const deadline = now + BUDGET_MS
  const before = { cursor: job.cursor, stored: job.stored }
  try {
    const client = await practiceHubWebClientFor(admin, accountId)
    if (!client) throw new Error('No PracticeHub sign-in is saved.')

    const ids = await client.patientIds()
    job.patients = ids.length

    // What is imported here, and what already has its original.
    const docs = await readAll<{ patient_id: string; external_reference: string | null; title: string; completed_at: string | null }>((from, to) =>
      admin.from('patient_docs').select('patient_id, external_reference, title, completed_at').eq('account_id', accountId).like('external_reference', 'PH-form-%').order('id').range(from, to),
    )
    const docByResponse = new Map(docs.map((d) => [String(d.external_reference).slice('PH-form-'.length), d]))
    const have = new Set(
      (await readAll<{ external_reference: string | null }>((from, to) =>
        admin.from('patient_files').select('external_reference').eq('account_id', accountId).like('external_reference', 'PH-form-pdf-%').order('id').range(from, to),
      )).map((f) => String(f.external_reference)),
    )

    // Patients are taken in order by three workers; `finished` marks each one
    // done so the cursor only ever moves past a patient whose forms are all
    // dealt with, however the workers interleave.
    let next = job.cursor
    const finished = new Set<number>()
    let codeNeeded: PracticeHubCodeNeeded | null = null
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < ids.length && Date.now() < deadline && !codeNeeded) {
          const index = next++
          try {
            let complete = true
            for (const submission of await client.patientForms(ids[index]!)) {
              const reference = practiceHubFormPdfReference(submission.responseId)
              if (have.has(reference)) continue
              const doc = docByResponse.get(submission.responseId)
              if (!doc) {
                job.unmatched++
                continue
              }
              if (Date.now() >= deadline) {
                complete = false
                break
              }
              try {
                const pdf = await client.formPdf(submission)
                const day = (doc.completed_at ?? '').slice(0, 10)
                const fileName = `${doc.title.trim() || 'Formulario'}${day ? ` ${day}` : ''} (original PracticeHub).pdf`
                const path = `${accountId}/${doc.patient_id}/ph-form-${submission.responseId}-${sanitizeStorageFilename(fileName)}`
                const upload = await admin.storage.from('patient-files').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
                if (upload.error) throw new Error(upload.error.message)
                const { error } = await admin.from('patient_files').insert({
                  account_id: accountId,
                  patient_id: doc.patient_id,
                  external_reference: reference,
                  file_name: fileName,
                  file_type: 'application/pdf',
                  size_bytes: pdf.length,
                  storage_path: path,
                  created_at: doc.completed_at ?? undefined,
                })
                // 23505: another run filed it first. That is the same outcome.
                if (error && error.code !== '23505') throw new Error(error.message)
                have.add(reference)
                if (!error) job.stored++
              } catch (e) {
                if (e instanceof PracticeHubCodeNeeded) throw e
                job.failed++
                job.error = (e as Error).message
              }
            }
            if (complete) finished.add(index)
          } catch (e) {
            if (e instanceof PracticeHubCodeNeeded) codeNeeded = e
            else job.error = (e as Error).message
          }
        }
      }),
    )
    while (finished.has(job.cursor)) job.cursor++

    if (codeNeeded) {
      const { outcome } = codeNeeded as PracticeHubCodeNeeded
      job.status = 'needs_code'
      job.codeMethod = outcome.method
      job.codePhone = outcome.phone
    } else if (job.cursor >= ids.length) {
      job.status = 'done'
    }
  } catch (e) {
    if (e instanceof PracticeHubCodeNeeded) {
      job.status = 'needs_code'
      job.codeMethod = e.outcome.method
      job.codePhone = e.outcome.phone
    } else {
      job.error = (e as Error).message
    }
  }

  // A run that moved nothing, repeatedly, is a job that cannot proceed:
  // PracticeHub down, the password changed, a patient it cannot read.
  if (job.status === 'running') {
    job.stalls = job.cursor === before.cursor && job.stored === before.stored ? job.stalls + 1 : 0
    if (job.stalls >= MAX_STALLS) job.status = 'failed'
  }
  if (job.status === 'done') job.error = job.failed > 0 ? job.error : null
  job.leaseUntil = 0
  await saveFormsJob(admin, accountId, job)
  return job
}

/**
 * Starts the next run without waiting for it. The request only has to reach
 * the function; what it answers does not matter here, so it is given a moment
 * to be sent and then let go.
 */
export async function kickFormsJob(origin: string, accountId: string, cronSecret: string): Promise<void> {
  await fetch(`${origin}/api/import/practicehub-forms-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': cronSecret },
    body: JSON.stringify({ accountId }),
    signal: AbortSignal.timeout(1_000),
  }).catch(() => {})
}

/** Accounts whose job says running but has had no run for a while: a chain that broke. */
export async function stalledFormsJobs(admin: Admin, now = Date.now()): Promise<string[]> {
  const { data } = await admin.from('account_secrets').select('account_id, value').eq('name', 'practicehub_forms_job').like('value', '%"status":"running"%')
  const stalled: string[] = []
  for (const row of data ?? []) {
    try {
      const job = JSON.parse(row.value) as PracticeHubFormsJob
      if (job.leaseUntil < now && now - Date.parse(job.updatedAt ?? '') > 90_000) stalled.push(row.account_id)
    } catch {
      // Unreadable state is not a running job.
    }
  }
  return stalled
}
