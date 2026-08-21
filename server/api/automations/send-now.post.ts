// One-off send: run a single campaign's actions for a specific patient right
// now, bypassing the trigger-event matching in fire.post.ts entirely. Same
// underlying action-sending logic (server/utils/runAutomationActions.ts).
interface SendNowBody {
  ruleId: string
  patientId: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SendNowBody>(event)
  if (!body?.ruleId || !body?.patientId) {
    throw createError({ statusCode: 400, statusMessage: 'ruleId and patientId are required' })
  }

  const { supabase } = await requirePermission(event, 'communication_config')
  const { teamMember } = await requireTeamMember(event)
  const accountId = teamMember.account_id

  const { data: rule } = await supabase.from('automation_rules').select('id').eq('id', body.ruleId).eq('account_id', accountId).maybeSingle()
  if (!rule) throw createError({ statusCode: 404, statusMessage: 'Campaign not found' })

  const { data: patient } = await supabase.from('patients').select('id, first_name, last_name, email').eq('id', body.patientId).maybeSingle()
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  const origin = getRequestURL(event).origin
  await runRuleActions(supabase, accountId, rule.id, patient, origin)

  return { sent: true }
})
