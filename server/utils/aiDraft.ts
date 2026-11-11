import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// What every "… with AI" builder shares: one model call that must answer in a
// given JSON shape, and a budget per clinic. Each builder brings its own
// prompt, schema and the cleaner that turns the answer into something its
// editor can open (utils/aiFormDraft.ts, utils/aiEmailDraft.ts,
// utils/aiAutomationDraft.ts). None of them writes anything: the draft goes
// back to the editor unsaved, and the person's own Save is what keeps it.
//
// The SDK is only a type here: the caller hands in its client
// (createAnthropicClient, which also records the tokens in ai_usage).

// Opus: what these drafts become is read by patients, so quality is worth
// more than the cents between models, and nobody is waiting on a chat
// bubble. Effort stays low to stay well inside Netlify's 60-second limit on a
// function; see AI_DRAFT_TIMEOUT_MS.
export const AI_DRAFT_MODEL = 'claude-opus-5-5'
// Netlify stops a function at 60 s and answers 502 with no body, which a
// dialog could only report as "something went wrong". Giving up first, with
// no retries (the SDK would retry a timeout from the start), means the
// person is told it took too long and can ask for something shorter.
export const AI_DRAFT_TIMEOUT_MS = 50_000

export type AiDraftResult =
  | { outcome: 'answered'; value: unknown; message: Anthropic.Beta.BetaMessage }
  | { outcome: 'refused' | 'too_long'; message: Anthropic.Beta.BetaMessage }

export async function runAiDraft(
  client: Anthropic,
  input: { system: string; user: string; schema: object; model?: string; maxTokens?: number },
): Promise<AiDraftResult> {
  const message = await client.beta.messages.create(
    {
      model: input.model ?? AI_DRAFT_MODEL,
      max_tokens: input.maxTokens ?? 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: input.schema as Record<string, unknown> } },
      // Clinic material is close enough to medicine that a safety check can
      // decline it; the fallback model then drafts it instead.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    },
    { timeout: AI_DRAFT_TIMEOUT_MS, maxRetries: 0 },
  )

  if (message.stop_reason === 'refusal') return { outcome: 'refused', message }
  if (message.stop_reason === 'max_tokens') return { outcome: 'too_long', message }

  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
  let value: unknown = null
  try {
    value = JSON.parse(text)
  } catch {
    // Structured output should rule this out; each cleaner treats null as nothing usable.
  }
  return { outcome: 'answered', value, message }
}

/**
 * Whether a clinic has used up a builder's budget, counted from the usage
 * every model call already records (anthropicClient.ts -> ai_usage). Every
 * draft pays for the model, and nothing else stops a script asking for ten
 * thousand. ai_usage is service-role only, so this takes that client.
 */
export async function aiDraftOverLimit(
  service: SupabaseClient<Database>,
  accountId: string,
  feature: string,
  limits: { perHour: number; perDay: number },
): Promise<'hour' | 'day' | null> {
  const since = (ms: number) => new Date(Date.now() - ms).toISOString()
  const count = async (from: string) => {
    const { count, error } = await service
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('feature', feature)
      .gte('created_at', from)
    // Unreadable counts as over: a budget that fails open is no budget.
    if (error) {
      console.error(`[${feature}] could not count drafts:`, error.message)
      return Number.POSITIVE_INFINITY
    }
    return count ?? 0
  }
  const [lastHour, lastDay] = await Promise.all([count(since(3600_000)), count(since(86400_000))])
  if (lastDay >= limits.perDay) return 'day'
  if (lastHour >= limits.perHour) return 'hour'
  return null
}
