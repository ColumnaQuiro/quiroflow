import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// A patient opening an article in their app or the portal: marks the send
// read, so the record says "Vista". Only the patient it was sent to counts --
// staff can read the same row, and their opening it must not tick it.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ sendId?: string }>(event)
  if (!body?.sendId) throw createError({ statusCode: 400, statusMessage: 'sendId is required' })
  const { supabase, user } = await requireAuthedUser(event)
  const { data: send } = await supabase.from('learn_sends').select('id, opened_at, patients(user_id)').eq('id', body.sendId).maybeSingle()
  const owner = (send as unknown as { patients: { user_id: string | null } | null } | null)?.patients?.user_id
  if (!send || owner !== user.id) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (!send.opened_at) {
    await serverSupabaseServiceRole<Database>(event).from('learn_sends').update({ opened_at: new Date().toISOString() }).eq('id', send.id).is('opened_at', null)
  }
  return { ok: true }
})
