import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt, toConfig } from '~/server/utils/receptionist'

// Writing a receptionist reply for one lead.
//
// Extracted so the two callers cannot drift: the button in the Inbox
// (/api/growth/leads/:id/draft-reply) and the tick that drafts without being
// asked (/api/automations/receptionist-draft-cron). They must produce the
// same sentence for the same conversation -- an owner who presses the button
// and gets something different from what the tick would have written has no
// reason to trust either.
//
// Nothing here sends anything. It writes leads.ai_draft_body and returns.

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

export type DraftOutcome =
  /** Written to ai_draft_body. */
  | { status: 'drafted'; draft: string }
  /** No model key on this deployment -- a normal state, not a failure. */
  | { status: 'unavailable' }
  /** The model declined. An answer, not an error. */
  | { status: 'refused' }
  /** The receptionist is switched off for this account. */
  | { status: 'disabled' }
  /** This lead is not one the receptionist answers. */
  | { status: 'blocked' }
  /** The lead has said nothing new to reply to. */
  | { status: 'nothing_to_answer' }
  /** The lead is gone or not this account's. */
  | { status: 'not_found' }

/**
 * Drafts a reply and stores it, or says why it did not.
 *
 * Returns rather than throws: the cron needs to skip a lead and carry on,
 * and the HTTP route needs to turn the same outcomes into status codes. A
 * shared function that threw would force the cron to catch strings.
 */
export async function draftLeadReply(supabase: any, accountId: string, leadId: string): Promise<DraftOutcome> {
  const { data: lead } = await supabase
    .from('leads')
    .select('id, full_name, ai_state')
    .eq('id', leadId)
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!lead) return { status: 'not_found' }

  // 'blocked' is the one state that means "this person does not get answered
  // by us". Honoured here rather than only in the UI: a drafted reply is one
  // click from being sent, so the decision has to hold server-side too.
  if (lead.ai_state === 'blocked') return { status: 'blocked' }

  const { data: configRow } = await supabase
    .from('receptionist_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  const config = toConfig(configRow)

  // Checked before the model key: "you turned this off" is something the
  // clinic chose and can undo; "this deployment has no key" is neither.
  if (!config.enabled) return { status: 'disabled' }

  const { data: messages } = await supabase
    .from('whatsapp_messages')
    .select('direction, body_preview, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_TURNS)

  const ordered = [...(messages ?? [])].reverse()
  const history = ordered
    .filter((m: { body_preview: string | null }) => (m.body_preview ?? '').trim().length > 0)
    .map((m: { direction: string; body_preview: string }) => ({
      role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
      content: m.body_preview,
    }))

  // Nothing to answer. Better than drafting a greeting nobody asked for and
  // presenting it as a reply to something.
  if (history.length === 0 || history[history.length - 1]!.role !== 'user') {
    return { status: 'nothing_to_answer' }
  }

  const apiKey = useRuntimeConfig().anthropicApiKey
  if (!apiKey) return { status: 'unavailable' }

  // The newest inbound message this draft answers. Recorded with the draft so
  // the tick knows it has already read this far, and does not write another
  // one the moment somebody discards this.
  const newestInboundAt = [...ordered].reverse().find((m: { direction: string }) => m.direction === 'inbound')?.created_at ?? null

  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    // Low effort for the same reason as the test chat: this is a short
    // conversational reply, and on the button path somebody is waiting.
    output_config: { effort: 'low' },
    system: [
      buildSystemPrompt(config, { testMode: false }),
      `# This reply is a draft\nA member of staff will read what you write before it is sent, and may edit it. Write the message itself and nothing else -- no preamble, no options to choose between, no notes to the reader.`,
      lead.full_name ? `The person you are replying to is ${lead.full_name}.` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    messages: history,
  })

  // A refusal is the model declining to write this, which is a real answer
  // and not an error -- reported as such rather than dressed up as a failed
  // request or, worse, saved as a reply.
  if (message.stop_reason === 'refusal') return { status: 'refused' }

  const draft = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()

  if (!draft) return { status: 'refused' }

  await supabase
    .from('leads')
    .update({
      ai_draft_body: draft,
      ai_draft_created_at: new Date().toISOString(),
      // Marked even when a person asked for this draft: they have an answer
      // to this message now, and the tick should not write a second one.
      ...(newestInboundAt ? { ai_drafted_through_at: newestInboundAt } : {}),
    })
    .eq('id', leadId)
    .eq('account_id', accountId)

  return { status: 'drafted', draft }
}
