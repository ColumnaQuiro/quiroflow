import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { createAnthropicClient } from '~/server/utils/anthropicClient'
import { aiDraftOverLimit, runAiDraft } from '~/server/utils/aiDraft'
import { requireSettingsPermission } from '~/server/utils/requirePermission'
import { modelFailureMessage } from '~/utils/modelFailure'
import { AI_FORM_TRANSLATE_SCHEMA, aiFormTranslateSystemPrompt, aiFormTranslateUserMessage, cleanAiFormTranslation, parseTranslateRequest } from '~/utils/aiFormTranslate'

// Settings > Docs > a form's language tab > "Translate with AI": one batch
// of a form's words in, the same words in another language out
// (utils/aiFormTranslate.ts). The page sends a long form as several batches.
//
// Nothing is written here, as with "Create with AI": the translation lands in
// the editor unsaved, and the person's own Save -- under the doc_templates
// update policy -- is what keeps it.

// A budget per clinic (aiDraftOverLimit). A batch is a request, and a long
// consent form is three or four of them, hence more room than the builder.
const FEATURE = 'form_translate'
const LIMITS = { perHour: 60, perDay: 200 }

export default defineEventHandler(async (event) => {
  // The Docs page's own gate, as for the form builder.
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')

  const parsed = parseTranslateRequest(await readBody(event))
  if (typeof parsed === 'string') throw createError({ statusCode: 400, statusMessage: parsed })

  const apiKey = useRuntimeConfig().anthropicApiKey
  // Not configured is a normal state (local, CI): the page says so.
  if (!apiKey) return { available: false as const }

  const service = serverSupabaseServiceRole<Database>(event)
  const limit = await aiDraftOverLimit(service, teamMember.account_id, FEATURE, LIMITS)
  if (limit) return { available: true as const, limit }

  const client = await createAnthropicClient(apiKey, { feature: FEATURE, accountId: teamMember.account_id })
  let result: Awaited<ReturnType<typeof runAiDraft>>
  try {
    result = await runAiDraft(client, {
      // A translation runs to about as long as the original: ~2 tokens per 3
      // characters of Spanish, with room to spare.
      maxTokens: 12000,
      system: aiFormTranslateSystemPrompt(parsed.language),
      user: aiFormTranslateUserMessage(parsed),
      schema: AI_FORM_TRANSLATE_SCHEMA,
    })
  } catch (err) {
    console.error('[docs/translate-form] model request failed:', (err as Error)?.message ?? err)
    throw createError({ statusCode: 502, statusMessage: modelFailureMessage(err) })
  }

  if (result.outcome !== 'answered') {
    if (result.outcome === 'refused') return { available: true as const, refused: true as const }
    throw createError({ statusCode: 422, statusMessage: 'That form is too long to translate in one go.' })
  }
  return { available: true as const, translation: cleanAiFormTranslation(result.value, parsed) }
})
