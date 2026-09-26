// Deletes an automation. Its runs go with it (automation_sequence_runs.rule_id
// cascades), so the people inside leave and receive nothing more; what was
// already sent stays in the Inbox and on their record, because messages keep
// their own rows (their rule_id is set to null).
//
// `expectedInside`: how many people the person was told are inside. If more
// have entered since the dialog opened, the delete is refused rather than
// taking out people nobody was warned about.
export default defineEventHandler(async (event) => {
  const ruleId = getRouterParam(event, 'id')
  if (!ruleId) throw createError({ statusCode: 400, statusMessage: 'Missing automation id' })
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const query = getQuery(event)

  const { data: rule } = await supabase.from('automation_rules').select('id').eq('id', ruleId).eq('account_id', teamMember.account_id).maybeSingle()
  if (!rule) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })

  const { count } = await supabase
    .from('automation_sequence_runs')
    .select('id', { count: 'exact', head: true })
    .eq('rule_id', ruleId)
    .in('status', ['running', 'failed'])
  const expected = Number(query.expectedInside)
  if (Number.isFinite(expected) && (count ?? 0) > expected) {
    throw createError({ statusCode: 409, statusMessage: 'More people have entered this automation since you opened the dialog.', data: { inside: count ?? 0 } })
  }

  const { error } = await supabase.from('automation_rules').delete().eq('id', ruleId).eq('account_id', teamMember.account_id)
  if (error) throw createError({ statusCode: error.code === '42501' ? 403 : 500, statusMessage: error.message })
  return { deleted: true, peopleRemoved: count ?? 0 }
})
