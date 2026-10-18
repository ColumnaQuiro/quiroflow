import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Ajustes › Privacidad: anonymise records past their retention period
// (20261017182107_record_retention.sql). The database does the deciding and
// the deleting -- anonymize_patient runs as the caller and refuses anyone
// but an owner, a record still inside its period, or one being kept -- and
// hands back the stored files that belonged to it, which only the service
// role can remove from storage. One patient at a time, so one refusal
// stops nothing else; the answer says which went and which did not.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientIds?: string[] }>(event)
  const ids = [...new Set(body?.patientIds ?? [])]
  if (!ids.length || ids.length > 200 || ids.some((id) => typeof id !== 'string')) throw createError({ statusCode: 400, statusMessage: 'patientIds required (1-200)' })
  const { supabase } = await requireTeamMember(event)
  const service = serverSupabaseServiceRole<Database>(event)

  const done: string[] = []
  const refused: { id: string; reason: string }[] = []
  for (const id of ids) {
    const { data, error } = await supabase.rpc('anonymize_patient', { p_patient_id: id })
    if (error) {
      refused.push({ id, reason: error.message })
      continue
    }
    done.push(id)
    const result = (data ?? {}) as { files?: string[]; photo?: string | null }
    try {
      if (result.files?.length) await service.storage.from('patient-files').remove(result.files)
      if (result.photo) await service.storage.from('patient-photos').remove([result.photo])
    } catch (e) {
      // The record is already anonymised; a file left in storage is unreachable
      // from it (its row is gone) and is logged to be removed by hand.
      console.error('[anonymize] storage cleanup failed', id, e)
    }
  }
  if (!done.length && refused.length) throw createError({ statusCode: 403, statusMessage: refused[0]!.reason })
  return { done, refused }
})
