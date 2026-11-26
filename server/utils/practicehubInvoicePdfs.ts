// The job that brings each imported PracticeHub invoice's original across: the
// PDF PracticeHub's Print button gives, the document the patient was handed,
// filed with the patient beside the invoice the Ledger step imported.
//
// Why it exists: the Ledger step copies an invoice's figures, and QuiroFlow
// can print its own receipt from them, but that is not the invoice that was
// issued. A copy of every invoice issued has to be kept for years, and once a
// clinic leaves PracticeHub its originals are gone. Its API has no PDF, so
// this signs in to the website, exactly as the signed-forms job does
// (server/utils/practicehubFormPdfs.ts, whose sign-in, session and code step
// it shares).
//
// What a run does, in windows of the invoice list counted from the oldest
// invoice (server/utils/practicehubWeb.ts says why from that end):
//   1. reads the next window of PracticeHub's invoice list;
//   2. finds each invoice here by its number -- the Ledger step stores
//      PracticeHub's invoice N as PHI-N, and N is the number printed on it;
//   3. checks it is the same invoice before filing anything: the same day,
//      the same amount and the same patient's name. A PDF filed against the
//      wrong patient would hand one person's invoice to another, so anything
//      that disagrees is counted and left alone, never filed;
//   4. downloads the PDF (about half a second) and stores it as a file on the
//      invoice's patient, under PH-invoice-pdf-<number>.
//
// Measured on a clinic with 7,241 invoices: a 41 KB PDF each, about 290 MB in
// all. Resumable and safe to run twice in the same ways as the forms job: an
// original already stored is skipped without a download, the storage key is
// fixed per invoice, and patient_files is unique on (account,
// external_reference).
import type { SupabaseClient } from '@supabase/supabase-js'
import { practiceHubWebJobStalled } from '~/server/utils/practicehubWebChain'
import type { Database } from '~/types/database.types'
import { getAccountSecret, setAccountSecret } from '~/server/utils/accountSecrets'
import { loadFormsJob, saveFormsJob } from '~/server/utils/practicehubFormPdfs'
import { PracticeHubCodeNeeded, practiceHubWebClientFor } from '~/server/utils/practicehubWeb'
import { practiceHubInvoiceNumber } from '~/utils/practicehubImport/ledger'
import { practiceHubInvoiceDay, practiceHubInvoicePdfReference, samePracticeHubInvoice, type PracticeHubImportedInvoice } from '~/utils/practicehubWebPages'

type Admin = SupabaseClient<Database>

export interface PracticeHubInvoicesJob {
  /** As the forms job: needs_code means PracticeHub wants a verification code before it will sign the import in again. */
  status: 'idle' | 'running' | 'needs_code' | 'stopped' | 'failed' | 'done'
  /** Invoices dealt with, counted from the oldest in PracticeHub's list. */
  cursor: number
  /** Invoices in PracticeHub's list, voided ones included. */
  total: number
  /** Originals stored by this job since it was started. */
  stored: number
  /** Invoices PracticeHub lists whose number is not imported here: the Ledger step has not brought them. */
  notHere: number
  /** Imported here under that number, but the day, amount or patient disagree, so nothing was filed. */
  mismatched: number
  /** Up to a few "PHI-N" that disagreed, so someone can look at one. */
  mismatchExamples: string[]
  /** Invoices whose PDF could not be fetched or stored; a later start retries them. */
  failed: number
  error: string | null
  leaseUntil: number
  stalls: number
  startedAt: string | null
  updatedAt: string | null
}

export const EMPTY_INVOICES_JOB: PracticeHubInvoicesJob = {
  status: 'idle', cursor: 0, total: 0, stored: 0, notHere: 0, mismatched: 0, mismatchExamples: [], failed: 0, error: null,
  leaseUntil: 0, stalls: 0, startedAt: null, updatedAt: null,
}

// The forms job's numbers, for the forms job's reasons.
const BUDGET_MS = 4_500
const LEASE_MS = 25_000
const CONCURRENCY = 3
const MAX_STALLS = 5
// Invoices read from the list per request. Enough to keep three downloads
// busy for a run; small enough that a window of invoices already stored
// costs one quick request and one query.
const WINDOW = 100

export async function loadInvoicesJob(admin: Admin, accountId: string): Promise<PracticeHubInvoicesJob> {
  const raw = await getAccountSecret(admin, accountId, 'practicehub_invoices_job')
  if (!raw) return { ...EMPTY_INVOICES_JOB }
  try {
    return { ...EMPTY_INVOICES_JOB, ...(JSON.parse(raw) as Partial<PracticeHubInvoicesJob>) }
  } catch {
    return { ...EMPTY_INVOICES_JOB }
  }
}

export async function saveInvoicesJob(admin: Admin, accountId: string, job: PracticeHubInvoicesJob): Promise<void> {
  await setAccountSecret(admin, accountId, 'practicehub_invoices_job', JSON.stringify({ ...job, updatedAt: new Date().toISOString() }))
}

/** How many invoices were imported from PracticeHub, and how many have their original. For the Settings step. */
export async function invoicePdfCounts(admin: Admin, accountId: string): Promise<{ invoices: number; originals: number }> {
  const [invoices, originals] = await Promise.all([
    admin.from('invoices').select('id', { count: 'exact', head: true }).eq('account_id', accountId).like('invoice_number', 'PHI-%'),
    admin.from('patient_files').select('id', { count: 'exact', head: true }).eq('account_id', accountId).like('external_reference', 'PH-invoice-pdf-%'),
  ])
  return { invoices: invoices.count ?? 0, originals: originals.count ?? 0 }
}

/** One run. Returns the job as it now stands; the caller chains another run while it says 'running'. */
export async function runInvoicesJobSlice(admin: Admin, accountId: string, now = Date.now()): Promise<PracticeHubInvoicesJob> {
  const job = await loadInvoicesJob(admin, accountId)
  if (job.status !== 'running' || job.leaseUntil > now) return job
  job.leaseUntil = now + LEASE_MS
  await saveInvoicesJob(admin, accountId, job)

  const deadline = now + BUDGET_MS
  const before = { cursor: job.cursor, stored: job.stored }
  try {
    const client = await practiceHubWebClientFor(admin, accountId)
    if (!client) throw new Error('No PracticeHub sign-in is saved.')
    // The day an invoice belongs to is the clinic's, which is the day PracticeHub's list prints.
    const { data: clinic } = await admin.from('clinics').select('timezone').eq('account_id', accountId).order('created_at').limit(1).maybeSingle()
    const timeZone = clinic?.timezone || 'Europe/Madrid'

    while (Date.now() < deadline) {
      const window = await client.invoiceWindow(job.cursor, WINDOW)
      job.total = window.total
      if (window.rows.length === 0) {
        job.status = 'done'
        break
      }

      // A voided invoice prints no number. Nothing here carries it, so there is nothing to file it with.
      const numbered = window.rows.flatMap((r) => (r.number === null ? [] : [r.number]))
      const [ours, stored] = await Promise.all([
        numbered.length
          ? admin.from('invoices').select('patient_id, invoice_number, total_cents, created_at, patients(first_name, last_name)').eq('account_id', accountId).in('invoice_number', numbered.map((n) => practiceHubInvoiceNumber(`phinv-${n}`)))
          : null,
        numbered.length
          ? admin.from('patient_files').select('external_reference').eq('account_id', accountId).in('external_reference', numbered.map((n) => practiceHubInvoicePdfReference(n)))
          : null,
      ])
      if (ours?.error) throw new Error(ours.error.message)
      if (stored?.error) throw new Error(stored.error.message)
      const ourByNumber = new Map(((ours?.data ?? []) as unknown as PracticeHubImportedInvoice[]).map((i) => [i.invoice_number, i]))
      const have = new Set((stored?.data ?? []).map((f) => String(f.external_reference)))

      // Workers take rows in order and check the clock before each one, so
      // the rows taken are always a prefix of the window and the cursor moves
      // past exactly those, however the downloads interleave.
      let next = 0
      let codeNeeded: PracticeHubCodeNeeded | null = null
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          while (next < window.rows.length && Date.now() < deadline && !codeNeeded) {
            const index = next++
            const row = window.rows[index]!
            if (row.number === null) continue
            const reference = practiceHubInvoicePdfReference(row.number)
            if (have.has(reference)) continue
            const invoiceNumber = practiceHubInvoiceNumber(`phinv-${row.number}`)
            const ours = ourByNumber.get(invoiceNumber)
            if (!ours) {
              job.notHere++
              continue
            }
            if (!samePracticeHubInvoice(row, ours, timeZone)) {
              job.mismatched++
              if (job.mismatchExamples.length < 5) job.mismatchExamples.push(invoiceNumber)
              continue
            }
            try {
              const pdf = await client.invoicePdf(row.webId)
              const fileName = `Factura INV-${row.number} ${practiceHubInvoiceDay(ours.created_at, timeZone)} (original PracticeHub).pdf`
              const path = `${accountId}/${ours.patient_id}/ph-invoice-${row.number}.pdf`
              const upload = await admin.storage.from('patient-files').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
              if (upload.error) throw new Error(upload.error.message)
              const { error } = await admin.from('patient_files').insert({
                account_id: accountId,
                patient_id: ours.patient_id,
                external_reference: reference,
                file_name: fileName,
                file_type: 'application/pdf',
                size_bytes: pdf.length,
                storage_path: path,
                created_at: ours.created_at,
              })
              // 23505: another run filed it first. That is the same outcome.
              if (error && error.code !== '23505') throw new Error(error.message)
              have.add(reference)
              if (!error) job.stored++
            } catch (e) {
              if (!(e instanceof PracticeHubCodeNeeded)) {
                job.failed++
                job.error = (e as Error).message
                continue
              }
              // Not dealt with, so the cursor has to stop before it. A row
              // after it that another worker finished is met again next time,
              // already stored, and skipped.
              codeNeeded = e
              next = Math.min(next, index)
            }
          }
        }),
      )
      job.cursor += next
      if (codeNeeded) throw codeNeeded
      if (next < window.rows.length) break
    }
  } catch (e) {
    if (e instanceof PracticeHubCodeNeeded) {
      job.status = 'needs_code'
      // The code belongs to the sign-in the two jobs share, and the forms
      // job's row is where Settings reads it (practicehub-web.post.ts).
      const forms = await loadFormsJob(admin, accountId)
      await saveFormsJob(admin, accountId, { ...forms, codeMethod: e.outcome.method, codePhone: e.outcome.phone })
    } else {
      job.error = (e as Error).message
    }
  }

  if (job.status === 'running') {
    job.stalls = job.cursor === before.cursor && job.stored === before.stored ? job.stalls + 1 : 0
    if (job.stalls >= MAX_STALLS) job.status = 'failed'
  }
  if (job.status === 'done') job.error = job.failed > 0 ? job.error : null
  job.leaseUntil = 0
  await saveInvoicesJob(admin, accountId, job)
  return job
}

/** Starts the next run without waiting for it, as kickFormsJob does. */
export async function kickInvoicesJob(origin: string, accountId: string, cronSecret: string): Promise<void> {
  await fetch(`${origin}/api/import/practicehub-invoices-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': cronSecret },
    body: JSON.stringify({ accountId }),
    signal: AbortSignal.timeout(1_000),
  }).catch(() => {})
}

/** Accounts whose job says running but has stopped being called: a chain Netlify cut (server/utils/practicehubWebChain.ts). */
export async function stalledInvoicesJobs(admin: Admin, now = Date.now()): Promise<string[]> {
  const { data } = await admin.from('account_secrets').select('account_id, value').eq('name', 'practicehub_invoices_job').like('value', '%"status":"running"%')
  const stalled: string[] = []
  for (const row of data ?? []) {
    try {
      if (practiceHubWebJobStalled(JSON.parse(row.value) as PracticeHubInvoicesJob, now)) stalled.push(row.account_id)
    } catch {
      // Unreadable state is not a running job.
    }
  }
  return stalled
}
