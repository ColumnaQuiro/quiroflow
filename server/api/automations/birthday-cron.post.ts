import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { ruleFiltersMatch, type AutomationFilters } from '~/server/utils/evaluateAutomationFilters'
import { dispatchPatientRule } from '~/server/utils/automationEngine'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { isBirthdayOn, localDateString } from '~/utils/birthday'

// See server/utils/concurrency.ts -- bounds how many patients' birthday
// actions run at once so a day with birthdays across many accounts still
// finishes promptly without approaching the shared send-provider rate limit.
const SEND_CONCURRENCY = 5

type PatientRow = {
  id: string
  account_id: string
  clinic_id: string | null
  first_name: string
  last_name: string | null
  email: string | null
  date_of_birth: string | null
} & Record<string, any>

// Fires the 'patient.birthday' trigger -- the one automation trigger that
// isn't a client action, so unlike every other trigger in fire.post.ts it
// has to be invoked on a schedule. There's no scheduled-function wiring
// between this Nitro build and Netlify, so a Postgres pg_cron job calls
// this endpoint once a day via pg_net instead (see the migration this
// shipped with) -- no session exists on that call, so a shared secret
// header stands in for auth, same idea as the WhatsApp webhook's verify
// token.
//
// "Today" is each clinic's own date, and each (rule, patient, date) fires at
// most once: calling this twice on the same day sends nothing the second
// time (automation_birthday_sends).
export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  // Every patient with a date of birth, a page at a time: PostgREST caps a
  // response at 1000 rows (supabase/config.toml max_rows), and a clinic past
  // that used to have everyone after the thousandth quietly skipped.
  const PAGE = 1000
  const all: PatientRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('patients')
      .select('id, account_id, clinic_id, first_name, last_name, email, is_minor, do_not_contact, marketing_channels, date_of_birth, address, city, postal_code, country, national_id, occupation, gender, emergency_contact')
      .not('date_of_birth', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  // Whatever zone a clinic is in, its "today" is UTC's yesterday, today or
  // tomorrow -- so only those birthdays need a clinic looked up at all.
  const now = new Date()
  const nearby = [-1, 0, 1].map((d) => localDateString(new Date(now.getTime() + d * 24 * 3600 * 1000), 'UTC'))
  const candidates = all.filter((p) => nearby.some((date) => isBirthdayOn(p.date_of_birth, date)))
  if (candidates.length === 0) return { fired: 0 }

  // The server's clock is UTC, and at 23:30 UTC it is already tomorrow in
  // Madrid. A patient's own clinic decides their "today"; one with no clinic
  // uses the account's first active clinic -- the same fallback the sender
  // uses for the clinic's name and time zone.
  const { data: clinics } = await supabase
    .from('clinics')
    .select('id, account_id, timezone, archived_at')
    .in('account_id', [...new Set(candidates.map((p) => p.account_id))])
    .order('created_at')
  const zoneByClinic = new Map((clinics ?? []).map((c) => [c.id, c.timezone || DEFAULT_CLINIC_TIMEZONE]))
  const zoneByAccount = new Map<string, string>()
  for (const c of clinics ?? []) {
    if (!c.archived_at && !zoneByAccount.has(c.account_id)) zoneByAccount.set(c.account_id, c.timezone || DEFAULT_CLINIC_TIMEZONE)
  }
  const zoneOf = (p: { account_id: string; clinic_id: string | null }) =>
    (p.clinic_id ? zoneByClinic.get(p.clinic_id) : undefined) || zoneByAccount.get(p.account_id) || DEFAULT_CLINIC_TIMEZONE

  const birthdayPatients = candidates
    .map((patient) => ({ patient, localDate: localDateString(now, zoneOf(patient)) }))
    .filter(({ patient, localDate }) => isBirthdayOn(patient.date_of_birth, localDate))
  if (birthdayPatients.length === 0) return { fired: 0 }

  const accountIds = [...new Set(birthdayPatients.map(({ patient }) => patient.account_id))]
  const { data: rules } = await supabase
    .from('automation_rules')
    .select('id, account_id, filters')
    .in('account_id', accountIds)
    .eq('trigger_event', 'patient.birthday')
    .eq('enabled', true)
  if (!rules || rules.length === 0) return { fired: 0 }

  const origin = getRequestURL(event).origin
  const firedCounts = await mapWithConcurrency(birthdayPatients, SEND_CONCURRENCY, async ({ patient, localDate }) => {
    const accountRules = rules.filter((r) => r.account_id === patient.account_id)
    let count = 0
    for (const rule of accountRules) {
      if (!(await ruleFiltersMatch(supabase, patient.id, rule.filters as AutomationFilters))) continue
      // The day is claimed before anything is sent, so a second call on the
      // same local date -- a retried request, a manual run -- finds it taken.
      // Claimed rather than checked-then-written: two overlapping calls cannot
      // both win.
      const { data: claimed, error } = await supabase
        .from('automation_birthday_sends')
        .upsert(
          { rule_id: rule.id, patient_id: patient.id, local_date: localDate, account_id: patient.account_id },
          { onConflict: 'rule_id,patient_id,local_date', ignoreDuplicates: true },
        )
        .select('rule_id')
      if (error) {
        console.error(`[birthday-cron] could not claim rule ${rule.id} for patient ${patient.id}: ${error.message}`)
        continue
      }
      if (!claimed || claimed.length === 0) continue
      await dispatchPatientRule(supabase, supabase, patient.account_id, rule.id, patient, origin)
      count += 1
    }
    return count
  })

  return { fired: firedCounts.reduce((a, b) => a + b, 0) }
})
