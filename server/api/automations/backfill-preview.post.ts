import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { backfillCandidates } from '~/server/utils/automationBackfill'
import { backfillDays, canBackfill } from '~/utils/automationBackfill'
import { withAtom } from '~/utils/automationTree'

// "This will include N patients": the activation dialog's count for "also
// everyone who already meets it", for the trigger and filters on screen --
// saved or not -- over the window chosen. With the automation's id, the
// people it has already reached are left out, as the pass leaves them out.
//
// Counted with the service role, like the pass it predicts (and like
// segment-preview): a receptionist whose own patient list is scoped still
// configures automations for the whole clinic. Only a number goes back.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ trigger?: unknown; trigger_event?: unknown; filters?: unknown; isMarketing?: boolean; ruleId?: unknown; days?: unknown }>(event)
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const accountId = teamMember.account_id
  const filters = body?.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? (body.filters as Record<string, unknown>) : {}
  const { trigger: atom, filters: merged } = withAtom({ trigger: body?.trigger, trigger_event: typeof body?.trigger_event === 'string' ? body.trigger_event : '', filters })
  if (!canBackfill(atom)) return { supported: false, count: 0, more: false }

  // Only an automation of this account names whom to leave out.
  let ruleId: string | null = null
  if (typeof body?.ruleId === 'string' && body.ruleId) {
    const { data } = await supabase.from('automation_rules').select('id').eq('id', body.ruleId).eq('account_id', accountId).maybeSingle()
    ruleId = data?.id ?? null
  }

  const service = serverSupabaseServiceRole<Database>(event)
  const { candidates, more } = await backfillCandidates(service, { id: ruleId, account_id: accountId, atom, filters: merged, is_marketing: body?.isMarketing === true }, backfillDays(body?.days))
  return { supported: true, count: candidates.length, more }
})
