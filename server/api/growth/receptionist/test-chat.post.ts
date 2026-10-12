import { serverSupabaseServiceRole } from '#supabase/server'
import { createAnthropicClient } from '~/server/utils/anthropicClient'
import { requireGrowth } from '~/server/utils/requireGrowth'
import { buildSystemPrompt, loadOfferedTypes, loadReceptionistCalendar, loadReceptionistConfig, type LeadOrigin } from '~/server/utils/receptionist'
import { freeTimesLookup, runReceptionistModel } from '~/server/utils/receptionistModel'
import { modelFailureMessage } from '~/utils/modelFailure'
import { typesForAudience } from '~/utils/receptionistTypes'
import { isNoReply } from '~/utils/receptionistAutoReply'
import { internalNotes } from '~/utils/receptionistGuard'

// "Try Alba" -- the clinic owner talking to their own configuration.
//
// This is the only place the model runs today, and it is deliberately the
// safe one: there is no patient on the other end, nothing is sent anywhere,
// and nothing is written to the calendar. It exists so an owner can see what
// their booking rules and escalation rules actually produce BEFORE any of it
// is pointed at a real person -- which is the order those two things should
// happen in.
//
// What this endpoint is not: the receptionist answering inbound WhatsApp.
// That needs a webhook path, a kill switch, rate limits and a decision about
// autonomous booking, and it should be reviewed on its own rather than
// arriving as a side effect of a settings screen.

// Sonnet, matching receptionistDraft.ts -- see the note there. The test
// panel has to run the model the drafts actually run on, or it advertises a
// quality the clinic will not get.
const MODEL = 'claude-sonnet-5'
const MAX_TOKENS = 1024
const MAX_TURNS = 20

interface Body {
  messages?: unknown
  /** Who the owner is pretending to be: 'ad' for a lead that came from an ad. */
  origin?: unknown
}

// The two cases worth trying by hand. An ad lead is a Meta lead-ad form,
// which is what real ad leads arrive as, so the prompt is built exactly as a
// real draft for one would be. Anything else is a WhatsApp enquiry nobody
// knows the source of -- the case where the receptionist has to ask.
const TEST_ORIGINS: Record<string, LeadOrigin> = {
  ad: { channel: 'facebook', source: null, externalSource: 'facebook', campaign: null, ad: null },
  unknown: { channel: 'whatsapp', source: null, externalSource: null, campaign: null, ad: null },
}

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

function isTurn(value: unknown): value is Turn {
  const turn = value as Turn
  return Boolean(turn) && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' && turn.content.trim().length > 0
}

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireGrowth(event)
  const body = (await readBody<Body>(event).catch(() => null)) ?? ({} as Body)

  const turns = Array.isArray(body.messages) ? body.messages.filter(isTurn).slice(-MAX_TURNS) : []
  if (turns.length === 0 || turns[turns.length - 1]!.role !== 'user') {
    throw createError({ statusCode: 400, statusMessage: 'Send the conversation so far, ending with the patient message' })
  }

  const apiKey = useRuntimeConfig().anthropicApiKey
  // Not configured is a normal state, not a failure -- same handling as the
  // support widget. The panel says so rather than showing an error.
  if (!apiKey) return { available: false as const, reply: '' }

  const config = await loadReceptionistConfig(supabase, teamMember.account_id)
  const fromAd = body.origin === 'ad'
  const leadOrigin = TEST_ORIGINS[fromAd ? 'ad' : 'unknown']
  // The same narrowing the drafts get: an owner pretending to come from the
  // ad is offered the ad's first visit, anyone else the plain one.
  const audience = fromAd ? ('new_from_ad' as const) : ('new' as const)
  const { types, adOnly } = typesForAudience(await loadOfferedTypes(supabase, teamMember.account_id, config), audience)
  const bookable = [...types, ...adOnly]
  // And the same free times, read with the service role for the reason given
  // in loadReceptionistCalendar.
  const service = serverSupabaseServiceRole(event)
  const calendar = await loadReceptionistCalendar(service, teamMember.account_id, config, bookable)
  const findFreeTimes = calendar.availability ? freeTimesLookup(service, teamMember.account_id, config, bookable, calendar.timeZone) : null

  try {
    const { text: reply, refused } = await runReceptionistModel(createAnthropicClient(apiKey), {
      model: MODEL,
      maxTokens: MAX_TOKENS,
      system: buildSystemPrompt(config, { testMode: true, offeredTypes: types, adOnlyTypes: adOnly, audience, calendar, leadOrigin, searchTool: Boolean(findFreeTimes) }),
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
      findFreeTimes,
      internalNotes: internalNotes(config),
      logLabel: `Try Alba (account ${teamMember.account_id})`,
    })
    if (refused) return { available: true as const, reply: '', refused: true }
    // The owner sees that it would stay quiet, rather than the marker itself.
    if (isNoReply(reply)) return { available: true as const, reply: '(Sin respuesta: este mensaje no necesita contestación. No se enviaría nada.)', refused: false }
    return { available: true as const, reply, refused: false }
  } catch (err) {
    console.error('[growth/receptionist/test-chat] Anthropic request failed:', (err as Error)?.message ?? err)
    // The reason, not "try again": a rejected key or an empty account fails
    // identically on every retry, and the owner is the one who can tell us.
    throw createError({ statusCode: 502, statusMessage: modelFailureMessage(err) })
  }
})
