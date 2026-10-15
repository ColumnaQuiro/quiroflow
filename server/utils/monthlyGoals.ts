import type { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, startOfLocalDate } from '~/utils/clinicClock'
import { GOAL_METRICS, monthOf, nextMonthStart, type GoalMetric, type GoalProgress } from '~/utils/monthlyGoals'
import { figuresBetween } from '~/server/utils/weeklyDigest'

type Service = ReturnType<typeof serverSupabaseServiceRole<Database>>

/**
 * A month's goals and the month so far, in the account's first clinic's time
 * zone (as the Monday summary reads its week). The figures are the summary's
 * own (figuresBetween): collected is money received, net of credit and void;
 * a new patient is one whose first attended visit ever fell in the month;
 * visits are attended ones. Care plans started counts care_plans begun in it.
 */
export async function goalsProgress(service: Service, accountId: string, now = new Date(), month?: string) {
  const { data: clinic } = await service.from('clinics').select('timezone').eq('account_id', accountId).is('archived_at', null).order('name').limit(1).maybeSingle()
  const tz = (clinic as { timezone: string | null } | null)?.timezone || DEFAULT_CLINIC_TIMEZONE
  const today = clinicDateOf(now, tz)
  const m = month ?? monthOf(today)
  const start = startOfLocalDate(`${m}-01`, tz)
  const end = startOfLocalDate(nextMonthStart(m), tz)
  const until = now < end ? now : end
  const elapsed = Math.min(1, Math.max(0, (until.getTime() - start.getTime()) / (end.getTime() - start.getTime())))

  const { data: rows } = await service.from('monthly_goals').select('metric, target').eq('account_id', accountId).eq('month', `${m}-01`)
  const targets = new Map(((rows as { metric: GoalMetric; target: number }[] | null) ?? []).map((r) => [r.metric, r.target]))
  if (!targets.size) return { month: m, elapsed, goals: [] as GoalProgress[] }

  const [figures, plans] = await Promise.all([
    figuresBetween(service, accountId, start, until),
    service.from('care_plans').select('id', { count: 'exact', head: true }).eq('account_id', accountId).gte('started_at', start.toISOString()).lt('started_at', until.toISOString()),
  ])
  const actual: Record<GoalMetric, number> = { new_patients: figures.newPatients, visits: figures.completed, collected_cents: figures.collectedCents, plans_started: plans.count ?? 0 }
  const goals = GOAL_METRICS.filter((k) => targets.has(k)).map((k) => ({ metric: k, target: targets.get(k)!, actual: actual[k] }))
  return { month: m, elapsed, goals }
}
