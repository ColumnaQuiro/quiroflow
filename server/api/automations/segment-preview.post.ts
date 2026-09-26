import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { segmentAudience } from '~/server/utils/segmentAudience'

// "N patients match today" for a segment trigger, while it is being edited
// (the filters come from the builder, saved or not), and the marketing split
// the activation dialog shows.
//
// Counted with the service role, like the enrolment it predicts -- a
// receptionist whose own patient list is scoped still configures outreach to
// the whole clinic. The names in `sample` go back through the caller's own
// client, so "See the list" never shows a patient they could not open.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ filters?: Record<string, unknown>; isMarketing?: boolean; ruleId?: string; entryMode?: string }>(event)
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const accountId = teamMember.account_id
  const service = serverSupabaseServiceRole<Database>(event)

  const audience = await segmentAudience(service, accountId, (body?.filters ?? {}) as never, body?.isMarketing === true)

  // Who will not enter again under "only those who have not been through
  // here yet" (once_ever): everyone with a run of this rule already.
  let alreadyIn = 0
  if (body?.ruleId && body.entryMode !== 'every_time' && audience.ids.length) {
    const { data: rule } = await supabase.from('automation_rules').select('id').eq('id', body.ruleId).eq('account_id', accountId).maybeSingle()
    if (rule) {
      const statuses = body.entryMode === 'one_at_a_time' ? ['running', 'failed'] : ['running', 'failed', 'done', 'cancelled']
      const { data: runs } = await service.from('automation_sequence_runs').select('patient_id').eq('rule_id', rule.id).in('status', statuses).not('patient_id', 'is', null)
      const inside = new Set((runs ?? []).map((r) => r.patient_id))
      alreadyIn = audience.ids.filter((id) => inside.has(id)).length
    }
  }

  const { data: sample } = audience.ids.length
    ? await supabase.from('patients').select('id, first_name, last_name').in('id', audience.ids.slice(0, 50)).order('first_name')
    : { data: [] }

  return {
    count: audience.ids.length,
    alreadyIn,
    whatsapp: audience.whatsapp,
    email: audience.email,
    sample: (sample ?? []).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name ?? ''}`.trim() })),
  }
})
