import type Anthropic from '@anthropic-ai/sdk'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { createAnthropicClient } from '~/server/utils/anthropicClient'
import { requireSettingsPermission } from '~/server/utils/requirePermission'
import { modelFailureMessage } from '~/utils/modelFailure'
import {
  AI_FORM_DRAFT_SCHEMA,
  AI_FORM_MAX_DESCRIPTION,
  AI_FORM_MAX_SOURCE,
  aiFormDraftSystemPrompt,
  aiFormDraftUserMessage,
  aiFormLanguage,
  cleanAiFormDraft,
} from '~/utils/aiFormDraft'

// Settings > Docs > "Create with AI": a description of a form, or the text
// of one pasted from the clinic's old software, in; a draft of it as editor
// blocks, out (utils/aiFormDraft.ts).
//
// Nothing is written here. The draft goes back to the editor unsaved, and
// the person's own Save -- under the same doc_templates policies as a form
// built by hand -- is what creates the template. So a draft nobody wanted
// leaves nothing behind, and the model never touches the clinic's data.

// Opus: a form is read by every patient the clinic sends it to, so the
// draft's quality is worth more than the cents between models, and there is
// nobody waiting on a chat bubble. Effort stays low to stay well inside
// Netlify's 60-second limit on a function; see TIMEOUT_MS.
const MODEL = 'claude-opus-5-5'
// An 80-block form with long consent paragraphs is ~8k tokens of JSON.
const MAX_TOKENS = 16000
// Netlify stops a function at 60 s and answers 502 with no body, which the
// dialog could only report as "something went wrong". Giving up first, with
// no retries (the SDK would retry a timeout from the start), means the
// person is told it took too long and can try a shorter form.
const TIMEOUT_MS = 50_000

// A budget per clinic, counted from the usage every model call already
// records (anthropicClient.ts -> ai_usage). Every draft pays for the model,
// and nothing else stops a script asking for ten thousand.
const FEATURE = 'form_builder'
const PER_HOUR = 20
const PER_DAY = 60

interface Body {
  description?: unknown
  source?: unknown
  language?: unknown
}

export default defineEventHandler(async (event) => {
  // The Docs page's own gate: settings access and communication_config, as
  // the doc_templates insert policy requires to save what comes back.
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')

  const body = (await readBody<Body>(event)) ?? {}
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const source = typeof body.source === 'string' ? body.source.trim() : ''
  if (!description && !source) throw createError({ statusCode: 400, statusMessage: 'Describe the form, or paste the one you have' })
  if (description.length > AI_FORM_MAX_DESCRIPTION) throw createError({ statusCode: 400, statusMessage: 'That description is too long' })
  if (source.length > AI_FORM_MAX_SOURCE) throw createError({ statusCode: 400, statusMessage: 'That form is too long to paste in one go' })
  const language = aiFormLanguage(body.language)

  const apiKey = useRuntimeConfig().anthropicApiKey
  // Not configured is a normal state (local, CI): the dialog says so.
  if (!apiKey) return { available: false as const }

  // ai_usage is service-role only: no clinic reads another's spending.
  const service = serverSupabaseServiceRole<Database>(event)
  const limit = await overLimit(service, teamMember.account_id)
  if (limit) return { available: true as const, limit }

  const client = await createAnthropicClient(apiKey, { feature: FEATURE, accountId: teamMember.account_id })
  let message: Anthropic.Beta.BetaMessage
  try {
    message = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: { type: 'json_schema', schema: AI_FORM_DRAFT_SCHEMA as unknown as Record<string, unknown> } },
        // A form about a body is close enough to medicine that a safety
        // check can decline it; the fallback model then drafts it instead.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: aiFormDraftSystemPrompt(language),
        messages: [{ role: 'user', content: aiFormDraftUserMessage(description, source) }],
      },
      { timeout: TIMEOUT_MS, maxRetries: 0 },
    )
  } catch (err) {
    console.error('[docs/draft-form] model request failed:', (err as Error)?.message ?? err)
    throw createError({ statusCode: 502, statusMessage: modelFailureMessage(err) })
  }

  if (message.stop_reason === 'refusal') return { available: true as const, refused: true as const }
  if (message.stop_reason === 'max_tokens') {
    throw createError({ statusCode: 422, statusMessage: 'That form is too long to draft in one go. Try it in parts.' })
  }

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
  if (draft.fields.length === 0) return { available: true as const, empty: true as const }
  return { available: true as const, draft }
})

async function overLimit(service: ReturnType<typeof serverSupabaseServiceRole<Database>>, accountId: string): Promise<'hour' | 'day' | null> {
  const since = (ms: number) => new Date(Date.now() - ms).toISOString()
  const count = async (from: string) => {
    const { count, error } = await service
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('feature', FEATURE)
      .gte('created_at', from)
    // Unreadable counts as over: a budget that fails open is no budget.
    if (error) {
      console.error('[docs/draft-form] could not count drafts:', error.message)
      return Number.POSITIVE_INFINITY
    }
    return count ?? 0
  }
  const [lastHour, lastDay] = await Promise.all([count(since(3600_000)), count(since(86400_000))])
  if (lastDay >= PER_DAY) return 'day'
  if (lastHour >= PER_HOUR) return 'hour'
  return null
}
