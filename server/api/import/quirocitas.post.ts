import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getAccountSecret, setAccountSecret } from '~/server/utils/accountSecrets'
import { QuirocitasError, quirocitasClientFor, quirocitasLogin } from '~/server/utils/quirocitas'
import { quirocitasSafeDecode } from '~/utils/quirocitasPages'
import { sanitizeStorageFilename } from '~/utils/storageFilename'

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
// Files are written here rather than handed back, unlike PracticeHub's: a
// function's response tops out around 6 MB and a clinic's attachments do not
// (an 18 MB video in the first clinic's).
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
        return await storeFile(admin, accountId, client, body)
      default:
        throw createError({ statusCode: 400, statusMessage: 'Unknown operation' })
    }
  } catch (e) {
    if (e instanceof QuirocitasError) throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})

async function storeFile(
  admin: ReturnType<typeof serverSupabaseServiceRole<Database>>,
  accountId: string,
  client: ReturnType<typeof quirocitasClientFor>,
  body: Extract<Body, { op: 'file' }>,
) {
  // Only a patient's own photo or one of their own tests, and only into the
  // record imported for that same Quirocitas patient.
  const m = String(body.src ?? '').match(/^(\d{1,9})\/(photo\.(?:jpe?g|png)|pruebas\/[^/]+)$/i)
  if (!m || (body.kind === 'photo') !== m[2]!.startsWith('photo')) throw createError({ statusCode: 400, statusMessage: 'Not a Quirocitas photo or test.' })
  const { data: patient } = await admin.from('patients').select('id, external_reference').eq('id', body.patientId).eq('account_id', accountId).maybeSingle()
  if (!patient || patient.external_reference !== `QC-${m[1]}`) throw createError({ statusCode: 404, statusMessage: 'That patient was not imported from this Quirocitas record.' })

  const file = await client.file(body.src)
  if (!file) return { missing: true as const }
  const contentType = file.contentType?.split(';')[0] || 'application/octet-stream'

  if (body.kind === 'photo') {
    // Many patients "have" a photo that is a stored 643-byte near-white JPEG,
    // an empty capture. No real photo is that small.
    if (file.bytes.length <= 1024) return { blank: true as const }
    const path = `${accountId}/${patient.id}/quirocitas.${contentType.includes('png') ? 'png' : 'jpg'}`
    const { error } = await admin.storage.from('patient-photos').upload(path, file.bytes, { contentType, upsert: true })
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    return { storagePath: path, size: file.bytes.length, contentType }
  }

  if (!ID.test(body.testId ?? '')) throw createError({ statusCode: 400, statusMessage: 'testId' })
  const name = quirocitasSafeDecode(m[2]!.slice('pruebas/'.length))
  // Keyed on Quirocitas' test id, so a re-run writes the same object again.
  const path = `${accountId}/${patient.id}/qc-${body.testId}-${sanitizeStorageFilename(name)}`
  const { error } = await admin.storage.from('patient-files').upload(path, file.bytes, { contentType, upsert: true })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { storagePath: path, size: file.bytes.length, contentType }
}
