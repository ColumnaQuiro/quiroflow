import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { createAnthropicClient } from '~/server/utils/anthropicClient'
import { aiDraftOverLimit, runAiDraft } from '~/server/utils/aiDraft'
import { requirePermission } from '~/server/utils/requirePermission'
import { modelFailureMessage } from '~/utils/modelFailure'
import { aiFormLanguage } from '~/utils/aiFormDraft'
import { AI_EMAIL_DRAFT_SCHEMA, AI_EMAIL_MAX_DESCRIPTION, aiEmailDraftSystemPrompt, aiEmailDraftUserMessage, cleanAiEmailDraft } from '~/utils/aiEmailDraft'
import { EMAIL_MERGE_FIELDS, triggerDef, triggerTitle } from '~/utils/automationCatalog'

// The email editor's "Write with AI" (automations and one-off sends): what
// the email is for, in; an email as editor blocks, out (utils/aiEmailDraft.ts).
// Nothing is written: the editor puts the draft in the step, and the
// automation's own Save keeps it.

const FEATURE = 'email_builder'
const LIMITS = { perHour: 30, perDay: 100 }

interface Body {
  description?: unknown
  language?: unknown
  /** The automation's trigger_event; 'segment' (or nothing) for a send to a group. */
  trigger?: unknown
  marketing?: unknown
  /** A lead automation's questions, which an email may merge in: { key, label }. */
  leadFields?: unknown
}

const english = (en: string) => en

export default defineEventHandler(async (event) => {
  // The automations' own gate.
  const { teamMember } = await requirePermission(event, 'communication_config')

  const body = (await readBody<Body>(event)) ?? {}
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) throw createError({ statusCode: 400, statusMessage: 'Say what the email is for' })
  if (description.length > AI_EMAIL_MAX_DESCRIPTION) throw createError({ statusCode: 400, statusMessage: 'That description is too long' })

  const triggerEvent = typeof body.trigger === 'string' && triggerDef(body.trigger) && body.trigger !== 'segment' ? body.trigger : null
  // The merge fields every email has, plus a lead automation's own answers.
  // Only word-character keys: anything else could not be a merge token.
  const leadFields = (Array.isArray(body.leadFields) ? body.leadFields : [])
    .flatMap((f) => (f && typeof f === 'object' && typeof (f as any).key === 'string' && /^\w{1,60}$/.test((f as any).key) ? [{ key: (f as any).key as string, label: String((f as any).label ?? '').slice(0, 120) }] : []))
    .slice(0, 40)
  const fields = [...EMAIL_MERGE_FIELDS.map((f) => ({ key: f.value, label: f.label[0] })), ...leadFields]

  const apiKey = useRuntimeConfig().anthropicApiKey
  if (!apiKey) return { available: false as const }

  const service = serverSupabaseServiceRole<Database>(event)
  const limit = await aiDraftOverLimit(service, teamMember.account_id, FEATURE, LIMITS)
  if (limit) return { available: true as const, limit }

  const client = await createAnthropicClient(apiKey, { feature: FEATURE, accountId: teamMember.account_id })
  let result: Awaited<ReturnType<typeof runAiDraft>>
  try {
    result = await runAiDraft(client, {
      maxTokens: 8000,
      system: aiEmailDraftSystemPrompt({
        language: aiFormLanguage(body.language),
        trigger: triggerEvent ? triggerTitle(english, triggerEvent) : null,
        marketing: body.marketing === true,
        fields,
      }),
      user: aiEmailDraftUserMessage(description),
      schema: AI_EMAIL_DRAFT_SCHEMA,
    })
  } catch (err) {
    console.error('[automations/draft-email] model request failed:', (err as Error)?.message ?? err)
    throw createError({ statusCode: 502, statusMessage: modelFailureMessage(err) })
  }

  if (result.outcome !== 'answered') {
    if (result.outcome === 'refused') return { available: true as const, refused: true as const }
    throw createError({ statusCode: 422, statusMessage: 'That email came out too long. Ask for something shorter.' })
  }
  const draft = cleanAiEmailDraft(result.value, fields.map((f) => f.key))
  if (!draft.design.blocks.length) return { available: true as const, empty: true as const }
  return { available: true as const, draft }
})
