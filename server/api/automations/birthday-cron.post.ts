import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { runRuleActions } from '~/server/utils/runAutomationActions'

// See server/utils/concurrency.ts -- bounds how many patients' birthday
// actions run at once so a day with birthdays across many accounts still
// finishes promptly without approaching the shared send-provider rate limit.
const SEND_CONCURRENCY = 5

// Fires the 'patient.birthday' trigger -- the one automation trigger that
// isn't a client action, so unlike every other trigger in fire.post.ts it
// has to be invoked on a schedule. There's no scheduled-function wiring
// between this Nitro build and Netlify, so a Postgres pg_cron job calls
// this endpoint once a day via pg_net instead (see the migration this
// shipped with) -- no session exists on that call, so a shared secret
// header stands in for auth, same idea as the WhatsApp webhook's verify
// token.
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  const { data: candidates } = await supabase
    .from('patients')
    .select('id, account_id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels, date_of_birth')
    .not('date_of_birth', 'is', null)
  if (!candidates || candidates.length === 0) return { fired: 0 }

  const today = new Date()
  const month = today.getUTCMonth() + 1
  const day = today.getUTCDate()
  const birthdayPatients = candidates.filter((p) => {
    const dob = new Date(p.date_of_birth as string)
    return dob.getUTCMonth() + 1 === month && dob.getUTCDate() === day
  })
  if (birthdayPatients.length === 0) return { fired: 0 }

  const accountIds = [...new Set(birthdayPatients.map((p) => p.account_id))]
  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, account_id, filters')
    .in('account_id', accountIds)
    .eq('trigger_event', 'patient.birthday')
    .eq('enabled', true)
  if (!rules || rules.length === 0) return { fired: 0 }

  const origin = getRequestURL(event).origin
  const firedCounts = await mapWithConcurrency(birthdayPatients, SEND_CONCURRENCY, async (patient) => {
    const accountRules = rules.filter((r) => r.account_id === patient.account_id)
    let count = 0
    for (const rule of accountRules) {
      if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters))) continue
      await runRuleActions(supabase, patient.account_id, rule.id, patient, origin)
      count += 1
    }
    return count
  })

  return { fired: firedCounts.reduce((a, b) => a + b, 0) }
})
