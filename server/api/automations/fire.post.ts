import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { automationEvent, dispatchPatientRule } from '~/server/utils/automationEngine'

// Fires every enabled automation_rule matching a trigger event -- called
// from the client right after the underlying action already happened (a
// patient checked in, an appointment saved as completed, an invoice paid),
// same pattern as the best-effort invoice-email send elsewhere in the app:
// a failed automation shouldn't undo or block the action that triggered it,
// so every action here is best-effort and never throws back to the caller.
// Action-sending logic itself lives in server/utils/runAutomationActions.ts,
// shared with the one-off send-now.post.ts endpoint. A rule that waits or
// branches starts a run instead (server/utils/automationEngine.ts), and the
// event itself is also offered to runs already in flight: one waiting for it,
// or one whose rule exits on it.
interface FireBody {
  triggerEvent: string
  patientId: string
  appointmentId?: string
  invoiceId?: string
  membershipId?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<FireBody>(event)
  if (!body?.triggerEvent || !body?.patientId) {
    throw createError({ statusCode: 400, statusMessage: 'triggerEvent and patientId are required' })
  }

  const { supabase, teamMember } = await requireTeamMember(event)
  const accountId = teamMember.account_id
  const service = serverSupabaseServiceRole<Database>(event)
  const origin = getRequestURL(event).origin

  // Runs already in flight hear about the event whether or not any rule
  // fires on it -- so this happens before the early returns below. Only for
  // a patient of the caller's own account.
  const { data: inAccount } = await supabase.from('patients').select('id').eq('id', body.patientId).eq('account_id', accountId).maybeSingle()
  if (inAccount) await automationEvent(service, accountId, { patientId: body.patientId }, body.triggerEvent, origin)

  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, name, filters')
    .eq('account_id', accountId)
    .eq('trigger_event', body.triggerEvent)
    .eq('enabled', true)

  if (!rules || rules.length === 0) return { fired: 0 }

  const { data: patient } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels, date_of_birth, address, city, postal_code, country, national_id, occupation, gender, emergency_contact')
    .eq('id', body.patientId)
    .maybeSingle()
  if (!patient) return { fired: 0 }

  let fired = 0
  for (const rule of rules) {
    if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters, body.appointmentId))) continue
    await dispatchPatientRule(supabase, service, accountId, rule.id, patient, origin, body.appointmentId, body)
    fired += 1
  }

  return { fired }
})
