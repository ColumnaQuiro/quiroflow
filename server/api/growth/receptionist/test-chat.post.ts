import Anthropic from '@anthropic-ai/sdk'
import { requireGrowth } from '~/server/utils/requireGrowth'
import { buildSystemPrompt, loadOfferedTypes, loadReceptionistConfig, type LeadOrigin } from '~/server/utils/receptionist'
import { modelFailureMessage } from '~/utils/modelFailure'

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
  // The same list the drafts are given, so trying the receptionist shows the
  // types a patient would actually be offered.
  const offeredTypes = await loadOfferedTypes(supabase, teamMember.account_id, config)

  const leadOrigin = TEST_ORIGINS[body.origin === 'ad' ? 'ad' : 'unknown']

  const client = new Anthropic({ apiKey })
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Low effort on purpose: this is a short conversational reply, and the
      // owner is waiting for it. Raising it would buy nothing a receptionist
      // reply needs.
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: buildSystemPrompt(config, { testMode: true, offeredTypes, leadOrigin }),
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
    })

    // Refusals arrive as HTTP 200 with stop_reason 'refusal', so the content
    // has to be checked rather than assumed.
    if (message.stop_reason === 'refusal') {
      return { available: true as const, reply: '', refused: true }
    }

    const reply = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    return { available: true as const, reply, refused: false }
  } catch (err) {
    console.error('[growth/receptionist/test-chat] Anthropic request failed:', (err as Error)?.message ?? err)
    // The reason, not "try again": a rejected key or an empty account fails
    // identically on every retry, and the owner is the one who can tell us.
    throw createError({ statusCode: 502, statusMessage: modelFailureMessage(err) })
  }
})
