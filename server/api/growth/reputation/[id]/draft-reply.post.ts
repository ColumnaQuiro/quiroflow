import Anthropic from '@anthropic-ai/sdk'
import { requireGrowth } from '~/server/utils/requireGrowth'
import { toConfig, toneWording } from '~/server/utils/receptionist'

// Drafts a public reply to a review.
//
// The draft is stored in `draft_body`, never in `reply_body`. A draft is not
// a reply, and keeping them in one column is exactly how an unapproved
// sentence ends up counted as sent.
//
// Nothing is posted anywhere by this endpoint, or by any endpoint in this
// change: posting needs the platform OAuth that does not exist yet. When it
// does, approval stays a separate deliberate step -- see the note in
// approve-reply.
const MODEL = 'claude-opus-5'
const MAX_TOKENS = 512

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing review id' })

  const { supabase, teamMember } = await requireGrowth(event)

  const { data: review } = await supabase
    .from('reviews')
    .select('id, author_name, rating, body, platform, replied_at')
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()

  if (!review) throw createError({ statusCode: 404, statusMessage: 'Review not found' })
  if (review.replied_at) throw createError({ statusCode: 400, statusMessage: 'That review has already been answered' })

  const apiKey = useRuntimeConfig().anthropicApiKey
  if (!apiKey) return { available: false as const, draft: '' }

  // The clinic already told us how it wants to sound, on the receptionist
  // screen. Reading it here rather than reading the row through
  // loadReceptionistConfig, which creates a default row as a side effect --
  // drafting a review reply is no reason to write to a settings table.
  const { data: configRow } = await supabase
    .from('receptionist_config')
    .select('*')
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  const persona = toConfig(configRow)

  const client = new Anthropic({ apiKey })
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: [
        `You write short public replies to patient reviews for a chiropractic clinic, in the clinic's voice.`,
        `Reply in the same language as the review. Two to four sentences.`,
        `Thank them specifically for what they mentioned. If they raised a problem, acknowledge it plainly, say what has changed, and offer to put it right -- never argue and never explain it away.`,
        // The rule that matters most in public.
        `Never discuss anyone's medical details, diagnosis or treatment: this reply is public and the patient's health is not. Never promise an outcome.`,
        `Write only the reply text. No greeting line, no signature, no quotation marks.`,
        `The clinic's tone, as it set it: ${toneWording(persona.tone)}`,
        ...(persona.neverSays.trim() ? [`Things this clinic never says: ${persona.neverSays.trim()}`] : []),
      ].join('\n\n'),
      messages: [
        {
          role: 'user',
          content: `A ${review.rating}-star review on ${review.platform} from ${review.author_name}:\n\n"${review.body ?? '(no text)'}"`,
        },
      ],
    })

    if (message.stop_reason === 'refusal') {
      return { available: true as const, draft: '', refused: true }
    }

    const draft = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    await supabase
      .from('reviews')
      .update({ draft_body: draft, draft_created_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', teamMember.account_id)

    return { available: true as const, draft, refused: false }
  } catch (err) {
    console.error('[growth/reputation/draft-reply] Anthropic request failed:', (err as Error)?.message ?? err)
    throw createError({ statusCode: 502, statusMessage: 'The model did not answer. Try again.' })
  }
})
