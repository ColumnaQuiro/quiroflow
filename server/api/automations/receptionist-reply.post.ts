import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { draftLeadReply } from '~/server/utils/receptionistDraft'
import { draftPatientReply } from '~/server/utils/patientReplyDraft'

// One conversation, answered by the AI receptionist: called by the database
// (pg_net, dispatch_receptionist_reply) for each conversation the tick found
// due -- receptionist-draft-cron decides who, this does one of them with the
// whole of a function's 60 seconds, in parallel with the others.
//
// The lease (claim_receptionist_lease) is what makes a second call for the
// same conversation -- the next tick, while this one is still writing -- stop
// at once instead of answering it again. Released at the end; a call killed
// half way leaves it to expire after LEASE_SECONDS, past the function's own
// limit, and the next tick retries.
const LEASE_SECONDS = 90

interface Body {
  kind?: unknown
  id?: unknown
  accountId?: unknown
  /** Answer on its own (the clinic's hours switches, read by the tick), or draft. */
  send?: unknown
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = (await readBody<Body>(event).catch(() => null)) ?? {}
  const kind = body.kind === 'lead' || body.kind === 'patient' ? body.kind : null
  const id = typeof body.id === 'string' ? body.id : null
  const accountId = typeof body.accountId === 'string' ? body.accountId : null
  if (!kind || !id || !accountId) throw createError({ statusCode: 400, statusMessage: 'kind, id and accountId are required' })

  const supabase = serverSupabaseServiceRole<Database>(event)
  const key = kind === 'lead' ? `lead:${id}` : id

  const { data: claimed, error: claimError } = await (supabase as any).rpc('claim_receptionist_lease', {
    p_account_id: accountId,
    p_conversation_key: key,
    p_seconds: LEASE_SECONDS,
  })
  if (claimError) throw createError({ statusCode: 500, statusMessage: claimError.message })
  if (!claimed) return { status: 'busy' as const }

  const sendOpts = body.send === true ? { send: { event } } : {}
  try {
    if (kind === 'lead') {
      const outcome = await draftLeadReply(supabase, accountId, id, supabase, sendOpts)
      // The AI cannot answer this one: the model declined, or this deployment
      // has no model to ask. Left on 'handling' the lead would sit there as
      // the AI's, waiting on a draft that is never coming, so it goes to a
      // person -- the one other way it gets an answer. Only from 'handling',
      // so a person who took it over meanwhile keeps it.
      if (outcome.status === 'refused' || outcome.status === 'unavailable') {
        await supabase.from('leads').update({ ai_state: 'needs_human' }).eq('id', id).eq('ai_state', 'handling')
      }
      return { status: outcome.status }
    }
    const outcome = await draftPatientReply(supabase, supabase, accountId, id, { store: true, ...sendOpts })
    return { status: outcome.status }
  } catch (err) {
    // Whatever went wrong is still true next tick, and the conversation is
    // still due then: the lease is released below, so it is retried.
    console.error(`[receptionist-reply] ${kind} ${id} failed:`, (err as Error)?.message ?? err)
    throw createError({ statusCode: 500, statusMessage: 'The receptionist could not answer this conversation' })
  } finally {
    await (supabase as any).rpc('release_receptionist_lease', { p_account_id: accountId, p_conversation_key: key })
  }
})
