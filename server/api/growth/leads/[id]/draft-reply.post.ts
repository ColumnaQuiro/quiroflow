import Anthropic from '@anthropic-ai/sdk'
import { requireGrowth } from '~/server/utils/requireGrowth'
import { buildSystemPrompt, toConfig } from '~/server/utils/receptionist'

// The receptionist answering a real enquiry -- as a draft somebody reads.
//
// "Try Alba" (receptionist/test-chat) has the owner talking to their own
// configuration, with no patient on the other end. This is the same model and
// the same system prompt, reading a real conversation, and it is the first
// place the receptionist has anything to do with a real person.
//
// It writes to leads.ai_draft_body and sends nothing. Approving is a separate
// request to /api/whatsapp/inbox-send, made by a person who has read the
// words -- which is also why this route needs no kill switch, no rate limit
// and no answer to "what if it is wrong": nothing leaves the building
// unread. Exactly the shape reputation's draft-reply already uses, for
// exactly the same reason.
const MODEL = 'claude-opus-5'
const MAX_TOKENS = 1024

/**
 * How much conversation the model is given.
 *
 * Enough to follow what has been asked and answered, not the whole history:
 * a lead thread is a WhatsApp conversation, and the last dozen turns are what
 * a receptionist picking it up would read before replying.
 */
const HISTORY_TURNS = 24

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing lead id' })

  const { supabase, teamMember } = await requireGrowth(event)

  const { data: lead } = await supabase
    .from('leads')
    .select('id, full_name, ai_state, deleted_at')
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!lead) throw createError({ statusCode: 404, statusMessage: 'Lead not found' })

  // 'blocked' is the one state that means "this person does not get answered
  // by us". Honouring it here rather than only in the UI: a drafted reply is
  // one click from being sent, so the decision has to hold server-side too.
  if (lead.ai_state === 'blocked') {
    throw createError({ statusCode: 400, statusMessage: 'The receptionist is blocked for this lead' })
  }

  const { data: messages } = await supabase
    .from('whatsapp_messages')
    .select('direction, body_preview, created_at')
    .eq('lead_id', id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS)

  const history = [...(messages ?? [])]
    .reverse()
    .filter((m) => (m.body_preview ?? '').trim().length > 0)
    .map((m) => ({
      role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
      content: m.body_preview as string,
    }))

  // Nothing to answer. Better than drafting a greeting nobody asked for and
  // presenting it as a reply to something.
  if (history.length === 0 || history[history.length - 1]!.role !== 'user') {
    throw createError({ statusCode: 400, statusMessage: 'There is nothing new from this lead to reply to' })
  }

  const apiKey = useRuntimeConfig().anthropicApiKey
  // Not configured is a normal state, not a failure -- same handling as the
  // test chat and the review drafter.
  if (!apiKey) return { available: false as const, draft: '' }

  // Read the row directly rather than through loadReceptionistConfig, which
  // creates a default row as a side effect. Drafting a reply is no reason to
  // write to a settings table -- the same note reputation's drafter makes.
  const { data: configRow } = await supabase
    .from('receptionist_config')
    .select('*')
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  const config = toConfig(configRow)

  const client = new Anthropic({ apiKey })
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      // Low effort for the same reason as the test chat: this is a short
      // conversational reply and somebody is waiting for it on screen.
      output_config: { effort: 'low' },
      system: [
        buildSystemPrompt(config, { testMode: false }),
        // The one thing true here and nowhere else in this prompt.
        `# This reply is a draft\nA member of staff will read what you write before it is sent, and may edit it. Write the message itself and nothing else -- no preamble, no options to choose between, no notes to the reader.`,
        lead.full_name ? `The person you are replying to is ${lead.full_name}.` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      messages: history,
    })

    // A refusal is the model declining to write this, which is a real answer
    // and not an error -- surfaced as "no draft" rather than dressed up as a
    // failed request or, worse, saved as a reply.
    if (message.stop_reason === 'refusal') {
      return { available: true as const, draft: '', refused: true as const }
    }

    const draft = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    if (!draft) return { available: true as const, draft: '' }

    await supabase
      .from('leads')
      .update({ ai_draft_body: draft, ai_draft_created_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', teamMember.account_id)

    return { available: true as const, draft }
  } catch (err: any) {
    console.error('[growth/draft-reply] model call failed:', err?.message ?? err)
    throw createError({ statusCode: 502, statusMessage: 'Could not draft a reply just now. Try again.' })
  }
})
