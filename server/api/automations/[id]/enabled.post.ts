import { loadRuleTree, ruleProblems } from '~/server/utils/automationRules'

// Switches an automation on or off -- the list's toggle, and Pause in its
// settings. Switching on checks exactly what saving it on checks: nothing
// missing, and Growth for a lead automation. Switching off is always allowed:
// nobody new enters, and the people inside stay where they are.
export default defineEventHandler(async (event) => {
  const ruleId = getRouterParam(event, 'id')
  if (!ruleId) throw createError({ statusCode: 400, statusMessage: 'Missing automation id' })
  const body = await readBody<{ enabled?: boolean }>(event)
  if (typeof body?.enabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'enabled is required' })
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')

  const loaded = await loadRuleTree(supabase, teamMember.account_id, ruleId)
  if (!loaded) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })

  const update: { enabled: boolean; segment_last_run_at?: string } = { enabled: body.enabled }
  if (body.enabled) {
    const problems = await ruleProblems(supabase, teamMember.account_id, loaded.rule, loaded.steps)
    if (problems.length > 0) {
      throw createError({ statusCode: 422, statusMessage: 'Something is missing before this automation can run', data: { problems } })
    }
    // A recurring segment switched on enrols at its next scheduled time, not
    // for every occurrence it missed while off (see automationRules.ts).
    if (!loaded.rule.enabled && loaded.rule.trigger_event === 'segment' && loaded.rule.segment?.schedule?.kind !== 'once') {
      update.segment_last_run_at = new Date().toISOString()
    }
  }

  const { error } = await supabase.from('automation_rules').update(update).eq('id', ruleId).eq('account_id', teamMember.account_id)
  if (error) throw createError({ statusCode: error.code === '42501' ? 403 : 500, statusMessage: error.message })
  return { enabled: body.enabled }
})
