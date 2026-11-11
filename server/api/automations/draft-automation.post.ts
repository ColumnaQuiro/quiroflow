import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { createAnthropicClient } from '~/server/utils/anthropicClient'
import { aiDraftOverLimit, runAiDraft } from '~/server/utils/aiDraft'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { requirePermission } from '~/server/utils/requirePermission'
import { tryFetchWhatsAppTemplates } from '~/server/utils/whatsappTemplates'
import { modelFailureMessage } from '~/utils/modelFailure'
import { aiFormLanguage } from '~/utils/aiFormDraft'
import { AI_AUTOMATION_MAX_DESCRIPTION, aiAutomationDraftSchema, aiAutomationDraftSystemPrompt, aiAutomationDraftUserMessage, cleanAiAutomationDraft } from '~/utils/aiAutomationDraft'
import { EMAIL_MERGE_FIELDS } from '~/utils/automationCatalog'

// The Automations page's "Create with AI": what should happen and when, in;
// a rule and its steps, out (utils/aiAutomationDraft.ts). Nothing is
// written: the builder opens the draft unsaved and switched off, its own
// check names whatever is still missing, and its Save goes through the same
// validation as an automation built by hand.

const FEATURE = 'automation_builder'
const LIMITS = { perHour: 20, perDay: 60 }

export default defineEventHandler(async (event) => {
  const { supabase, teamMember, subscription } = await requirePermission(event, 'communication_config')

  const body = (await readBody<{ description?: unknown; language?: unknown }>(event)) ?? {}
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) throw createError({ statusCode: 400, statusMessage: 'Say what the automation should do' })
  if (description.length > AI_AUTOMATION_MAX_DESCRIPTION) throw createError({ statusCode: 400, statusMessage: 'That description is too long' })

  const apiKey = useRuntimeConfig().anthropicApiKey
  if (!apiKey) return { available: false as const }

  const service = serverSupabaseServiceRole<Database>(event)
  const limit = await aiDraftOverLimit(service, teamMember.account_id, FEATURE, LIMITS)
  if (limit) return { available: true as const, limit }

  // The clinic's own WhatsApp templates, approved ones only: a draft can only
  // send what Meta has approved. No WhatsApp connected is not an error -- the
  // draft uses email.
  const templates = ((await tryFetchWhatsAppTemplates(supabase, teamMember.account_id)) ?? [])
    .filter((t) => t.status === 'APPROVED' && !t.mediaHeaderFormat)
    .slice(0, 60)
  const growth = hasGrowth(subscription)
  const emailFields = EMAIL_MERGE_FIELDS.map((f) => ({ key: f.value, label: f.label[0] }))

  const client = await createAnthropicClient(apiKey, { feature: FEATURE, accountId: teamMember.account_id })
  let result: Awaited<ReturnType<typeof runAiDraft>>
  try {
    result = await runAiDraft(client, {
      maxTokens: 16000,
      system: aiAutomationDraftSystemPrompt({ language: aiFormLanguage(body.language), growth, templates, emailFields }),
      user: aiAutomationDraftUserMessage(description),
      schema: aiAutomationDraftSchema(templates),
    })
  } catch (err) {
    console.error('[automations/draft-automation] model request failed:', (err as Error)?.message ?? err)
    throw createError({ statusCode: 502, statusMessage: modelFailureMessage(err) })
  }

  if (result.outcome !== 'answered') {
    if (result.outcome === 'refused') return { available: true as const, refused: true as const }
    throw createError({ statusCode: 422, statusMessage: 'That automation came out too long. Describe a simpler one.' })
  }
  const draft = cleanAiAutomationDraft(result.value, { growth, templates, emailFieldKeys: emailFields.map((f) => f.key) })
  if (!draft.steps.length) return { available: true as const, empty: true as const }
  return { available: true as const, draft }
})
