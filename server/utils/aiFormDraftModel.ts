import type Anthropic from '@anthropic-ai/sdk'
import { AI_FORM_DRAFT_SCHEMA, aiFormDraftSystemPrompt, aiFormDraftUserMessage, cleanAiFormDraft, type AiFormDraft, type AiFormLanguage } from '~/utils/aiFormDraft'

// The one model call behind "Create with AI" in Settings > Docs, shared by
// the route (server/api/docs/draft-form.post.ts) and the eval
// (tests/evals/forms), so the eval measures exactly the request clinics get.
// The SDK is only a type here: the caller hands in its client.

// Opus: a form is read by every patient the clinic sends it to, so the
// draft's quality is worth more than the cents between models, and there is
// nobody waiting on a chat bubble. Effort stays low to stay well inside
// Netlify's 60-second limit on a function; see AI_FORM_TIMEOUT_MS.
export const AI_FORM_MODEL = 'claude-opus-5-5'
// An 80-block form with long consent paragraphs is ~8k tokens of JSON.
const MAX_TOKENS = 16000
// Netlify stops a function at 60 s and answers 502 with no body, which the
// dialog could only report as "something went wrong". Giving up first, with
// no retries (the SDK would retry a timeout from the start), means the
// person is told it took too long and can try a shorter form.
export const AI_FORM_TIMEOUT_MS = 50_000

export type AiFormDraftResult =
  | { outcome: 'drafted'; draft: AiFormDraft; message: Anthropic.Beta.BetaMessage }
  | { outcome: 'refused' | 'too_long' | 'empty'; message: Anthropic.Beta.BetaMessage }

export async function draftAiForm(
  client: Anthropic,
  input: { description: string; source: string; language: AiFormLanguage; model?: string },
): Promise<AiFormDraftResult> {
  const message = await client.beta.messages.create(
    {
      model: input.model ?? AI_FORM_MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: AI_FORM_DRAFT_SCHEMA as unknown as Record<string, unknown> } },
      // A form about a body is close enough to medicine that a safety check
      // can decline it; the fallback model then drafts it instead.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: aiFormDraftSystemPrompt(input.language),
      messages: [{ role: 'user', content: aiFormDraftUserMessage(input.description, input.source) }],
    },
    { timeout: AI_FORM_TIMEOUT_MS, maxRetries: 0 },
  )

  if (message.stop_reason === 'refusal') return { outcome: 'refused', message }
  if (message.stop_reason === 'max_tokens') return { outcome: 'too_long', message }

  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch {
    // Structured output should rule this out; treated as an empty draft.
  }
  const draft = cleanAiFormDraft(parsed)
  if (draft.fields.length === 0) return { outcome: 'empty', message }
  return { outcome: 'drafted', draft, message }
}
