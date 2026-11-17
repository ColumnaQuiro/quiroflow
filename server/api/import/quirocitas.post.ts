import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret, setAccountSecret } from '~/server/utils/accountSecrets'
import { QuirocitasError, quirocitasClientFor, quirocitasLogin } from '~/server/utils/quirocitas'
import { storeQuirocitasFile } from '~/server/utils/quirocitasFiles'

// Everything the Quirocitas importer reads, one small piece per call: the
// browser runs the loop, as with PracticeHub, so no single request comes near
// a function's time limit. Each operation is one of the reads in
// server/utils/quirocitas.ts, which says which of Quirocitas' pages are safe
// to touch; nothing here takes a page or a form from the caller.
//
//   check       sign in afresh and count the patients
//   patients    the patient list
//   patient     one patient's record, clinical history and invoices
//   techniques  the segments adjusted at a batch of visits
//   ledger      the next months of the cash ledger (restart: from this month)
//   file        one photo or attached file, stored straight into Storage
//
// The read and the import steps themselves now run as server-side jobs
// (server/utils/importJobs.ts), which call the same client directly. What
// still comes through here is 'check' from the Connection screen; the rest
// stays for a slice-by-slice caller and for scripts.
type Body =
  | { op: 'check' | 'patients' }
  | { op: 'patient'; id: string; name: string }
  | { op: 'techniques'; citaIds: string[]; segments: string[] }
  | { op: 'ledger'; restart?: boolean; months?: number }
  | { op: 'file'; patientId: string; src: string; kind: 'photo' | 'test'; testId?: string }

const ID = /^\d{1,9}$/

export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'data_admin')
  const accountId = teamMember.account_id
  const body = await readBody<Body>(event)
  const admin = serverSupabaseServiceRole<Database>(event)
  const login = await quirocitasLogin(admin, accountId)
  if (!login) throw createError({ statusCode: 400, statusMessage: 'Save the Quirocitas connection first.' })
  const client = quirocitasClientFor(admin, accountId, login)

  try {
    switch (body?.op) {
      case 'check': {
        await client.signIn()
        return { patients: (await client.patientList()).length }
      }
      case 'patients':
        return { patients: await client.patientList() }
      case 'patient': {
        if (!ID.test(body.id ?? '')) throw createError({ statusCode: 400, statusMessage: 'id' })
        return await client.patient(body.id, String(body.name ?? ''))
      }
      case 'techniques': {
        const ids = (body.citaIds ?? []).filter((c) => ID.test(c)).slice(0, 60)
        return { techniques: await client.techniques(ids, (body.segments ?? []).map(String).slice(0, 80)) }
      }
      case 'ledger': {
        // Where the walk stands is kept here, not sent by the browser: what
        // gets submitted to Quirocitas' cash page is only ever a form that
        // Quirocitas itself rendered.
        const saved = body.restart ? null : await getAccountSecret(admin, accountId, 'quirocitas_ledger_cursor')
        if (!body.restart && !saved) throw createError({ statusCode: 409, statusMessage: 'The ledger has to start again from this month.' })
        const { months, cursor } = await client.ledger(saved ? JSON.parse(saved) : null, Math.min(Math.max(body.months ?? 3, 1), 6))
        await setAccountSecret(admin, accountId, 'quirocitas_ledger_cursor', JSON.stringify(cursor))
        return { months }
      }
      case 'file':
        return await storeQuirocitasFile(admin, accountId, client, body)
      default:
        throw createError({ statusCode: 400, statusMessage: 'Unknown operation' })
    }
  } catch (e) {
    if (e instanceof QuirocitasError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})
