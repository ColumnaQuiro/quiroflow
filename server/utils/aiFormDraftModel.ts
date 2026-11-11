import type Anthropic from '@anthropic-ai/sdk'
import { AI_FORM_DRAFT_SCHEMA, aiFormDraftSystemPrompt, aiFormDraftUserMessage, cleanAiFormDraft, type AiFormDraft, type AiFormLanguage } from '~/utils/aiFormDraft'
import { AI_DRAFT_MODEL, runAiDraft } from './aiDraft'

// The one model call behind "Create with AI" in Settings > Docs, shared by
// the route (server/api/docs/draft-form.post.ts) and the eval
// (tests/evals/forms), so the eval measures exactly the request clinics get.

export const AI_FORM_MODEL = AI_DRAFT_MODEL

export type AiFormDraftResult =
  | { outcome: 'drafted'; draft: AiFormDraft; message: Anthropic.Beta.BetaMessage }
  | { outcome: 'refused' | 'too_long' | 'empty'; message: Anthropic.Beta.BetaMessage }

export async function draftAiForm(
  client: Anthropic,
  input: { description: string; source: string; language: AiFormLanguage; model?: string },
): Promise<AiFormDraftResult> {
  const result = await runAiDraft(client, {
    model: input.model,
    // An 80-block form with long consent paragraphs is ~8k tokens of JSON.
    maxTokens: 16000,
    system: aiFormDraftSystemPrompt(input.language),
    user: aiFormDraftUserMessage(input.description, input.source),
    schema: AI_FORM_DRAFT_SCHEMA,
  })
  if (result.outcome !== 'answered') return result
  const draft = cleanAiFormDraft(result.value)
  if (draft.fields.length === 0) return { outcome: 'empty', message: result.message }
  return { outcome: 'drafted', draft, message: result.message }
}
