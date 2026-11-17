import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import type { QuirocitasClient } from '~/server/utils/quirocitas'
import { quirocitasSafeDecode } from '~/utils/quirocitasPages'
import { sanitizeStorageFilename } from '~/utils/storageFilename'

// Copies one of a patient's Quirocitas files into Storage: their photo, or a
// test attached to their record. Used by /api/import/quirocitas (op 'file')
// and by the server-side import jobs (server/utils/importJobs.ts).
//
// Files are written here rather than handed back, unlike PracticeHub's: a
// function's response tops out around 6 MB and a clinic's attachments do not
// (an 18 MB video in the first clinic's).
export interface QuirocitasFileBody { patientId: string; src: string; kind: 'photo' | 'test'; testId?: string }

const ID = /^\d{1,9}$/

export async function storeQuirocitasFile(
  admin: SupabaseClient<Database>,
  accountId: string,
  client: QuirocitasClient,
  body: QuirocitasFileBody,
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
    const png = contentType.includes('png')
    const path = `${accountId}/${patient.id}/quirocitas.${png ? 'png' : 'jpg'}`
    // patient-photos only takes image/* (20261112070000), and Quirocitas does
    // not always say what it is sending: the type follows the name it is
    // stored under. No long cache: this path is overwritten on a re-run.
    const { error } = await admin.storage.from('patient-photos').upload(path, file.bytes, { contentType: png ? 'image/png' : 'image/jpeg', upsert: true })
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
