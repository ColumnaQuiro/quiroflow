import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { deleteAccountSecret, getAccountSecret, setAccountSecret } from '~/server/utils/accountSecrets'
import { PracticeHubWebClient, PracticeHubWebError, practiceHubWebClientFor } from '~/server/utils/practicehubWeb'
import { EMPTY_FORMS_JOB, formPdfCounts, kickFormsJob, loadFormsJob, saveFormsJob } from '~/server/utils/practicehubFormPdfs'
import type { PracticeHubLoginOutcome } from '~/utils/practicehubWebPages'

// Settings > Import > PracticeHub > Signed forms.
//
// The clinic's sign-in to PracticeHub's WEBSITE (not its API key), and the
// job that uses it to bring each form's signed original across. One route,
// one `op`, like quirocitas.post.ts:
//
//   status   what is saved, and where the job is
//   connect  save an email and password and sign in; may answer "a code is wanted"
//   code     the verification code PracticeHub asked for
//   resend   ask PracticeHub to send that code again
//   start    start (or carry on) bringing the originals
//   stop     stop after the run in flight
//   forget   remove the saved sign-in and session
//
// The password is never returned. PracticeHub's address is the one saved
// under Connection, never one from the body, so the saved password cannot be
// sent to a host of the caller's choosing.
type Body =
  | { op: 'status' }
  | { op: 'connect'; email: string; password: string }
  | { op: 'code'; code: string }
  | { op: 'resend'; via?: 'email' | 'sms' }
  | { op: 'start' }
  | { op: 'stop' }
  | { op: 'forget' }

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const accountId = teamMember.account_id
  const admin = serverSupabaseServiceRole<Database>(event)
  const body = await readBody<Body>(event)

  async function status() {
    const [email, session, job, counts, { data: account }] = await Promise.all([
      getAccountSecret(admin, accountId, 'practicehub_web_email'),
      getAccountSecret(admin, accountId, 'practicehub_web_session'),
      loadFormsJob(admin, accountId),
      formPdfCounts(admin, accountId),
      admin.from('accounts').select('practicehub_base_url').eq('id', accountId).maybeSingle(),
    ])
    return {
      hasAddress: Boolean(account?.practicehub_base_url),
      email: email ?? null,
      // Signed in at least once, and not waiting on a code. A code asked for
      // at connect time is recorded on the job row too, so one place says it.
      connected: Boolean(email && session) && !job.codeMethod,
      code: job.codeMethod ? { method: job.codeMethod, phone: job.codePhone } : null,
      job: { status: job.status, cursor: job.cursor, patients: job.patients, stored: job.stored, unmatched: job.unmatched, failed: job.failed, error: job.error, updatedAt: job.updatedAt },
      ...counts,
    }
  }
  async function record(outcome: PracticeHubLoginOutcome) {
    const job = await loadFormsJob(admin, accountId)
    if (outcome.state === 'code') {
      job.codeMethod = outcome.method
      job.codePhone = outcome.phone
    } else if (outcome.state === 'in') {
      job.codeMethod = null
      job.codePhone = null
      // A job that stopped to ask for this code carries on by itself.
      if (job.status === 'needs_code') job.status = 'running'
    }
    await saveFormsJob(admin, accountId, job)
    return job
  }

  function refuse(outcome: PracticeHubLoginOutcome): never {
    if (outcome.state === 'wait') throw createError({ statusCode: 429, statusMessage: 'PracticeHub is limiting sign-ins for the moment. Try again in a few minutes.' })
    throw createError({ statusCode: 400, statusMessage: outcome.state === 'refused' ? outcome.message : 'PracticeHub did not sign the import in.' })
  }

  const kick = () => kickFormsJob(getRequestURL(event).origin, accountId, useRuntimeConfig().cronSecret)

  try {
    switch (body?.op) {
      case 'status':
        return await status()

      case 'connect': {
        const email = String(body.email ?? '').trim()
        const password = String(body.password ?? '')
        if (!email || !password) throw createError({ statusCode: 400, statusMessage: 'Email and password are required.' })
        const { data: account } = await admin.from('accounts').select('practicehub_base_url').eq('id', accountId).maybeSingle()
        if (!account?.practicehub_base_url) throw createError({ statusCode: 400, statusMessage: 'Save the PracticeHub address under Connection first.' })
        // Checked before anything is saved: a mistyped password is not kept.
        const client = new PracticeHubWebClient(
          { baseUrl: account.practicehub_base_url, email, password },
          { load: async () => null, save: (cookie) => setAccountSecret(admin, accountId, 'practicehub_web_session', cookie) },
        )
        const outcome = await client.signIn()
        if (outcome.state !== 'in' && outcome.state !== 'code') refuse(outcome)
        await setAccountSecret(admin, accountId, 'practicehub_web_email', email)
        await setAccountSecret(admin, accountId, 'practicehub_web_password', password)
        await record(outcome)
        return await status()
      }

      case 'code': {
        const code = String(body.code ?? '').replace(/\s+/g, '')
        if (!/^\d{4,8}$/.test(code)) throw createError({ statusCode: 400, statusMessage: 'That is not a verification code.' })
        const client = await practiceHubWebClientFor(admin, accountId)
        const job = await loadFormsJob(admin, accountId)
        if (!client || !job.codeMethod) throw createError({ statusCode: 409, statusMessage: 'PracticeHub is not waiting for a code.' })
        const outcome = await client.submitCode(code, job.codeMethod)
        if (outcome.state !== 'in') refuse(outcome)
        const after = await record(outcome)
        if (after.status === 'running') await kick()
        return await status()
      }

      case 'resend': {
        const client = await practiceHubWebClientFor(admin, accountId)
        if (!client) throw createError({ statusCode: 409, statusMessage: 'No PracticeHub sign-in is saved.' })
        await client.resendCode(body.via === 'sms' ? 'sms' : 'email')
        return await status()
      }

      case 'start': {
        if (!(await practiceHubWebClientFor(admin, accountId))) throw createError({ statusCode: 409, statusMessage: 'Save the PracticeHub sign-in first.' })
        const job = await loadFormsJob(admin, accountId)
        if (job.codeMethod) throw createError({ statusCode: 409, statusMessage: 'PracticeHub is waiting for a verification code.' })
        // Always from the first patient: what is already stored is skipped
        // without a download, so a fresh walk costs seconds and picks up
        // forms submitted, or failed, since the last one.
        await saveFormsJob(admin, accountId, { ...EMPTY_FORMS_JOB, status: 'running', startedAt: new Date().toISOString() })
        await kick()
        return await status()
      }

      case 'stop': {
        const job = await loadFormsJob(admin, accountId)
        if (job.status === 'running') await saveFormsJob(admin, accountId, { ...job, status: 'stopped' })
        return await status()
      }

      case 'forget': {
        for (const name of ['practicehub_web_email', 'practicehub_web_password', 'practicehub_web_session', 'practicehub_forms_job'] as const) {
          await deleteAccountSecret(admin, accountId, name)
        }
        return await status()
      }

      default:
        throw createError({ statusCode: 400, statusMessage: 'Unknown operation' })
    }
  } catch (e) {
    if (e instanceof PracticeHubWebError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})
