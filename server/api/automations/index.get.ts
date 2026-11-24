import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { canReadWhatsApp, statsByRule } from '~/server/utils/automationStats'
import { rulesWhoseDelayNowWaits, DELAYS_HONOURED_SINCE  } from '~/server/utils/automationDelayChange'
import { MESSAGE_STEPS } from '~/utils/automationCatalog'
import { isValidQuietHours, segmentDailyLimit } from '~/utils/automationTiming'
import { findProblems, type DraftRule, type DraftStep, type Problem } from '~/utils/automationTree'
import { STEP_COLUMNS } from '~/server/utils/automationRules'

// The Automations list: every rule on the account, what its steps are, and
// what it has done in the last 30 days.


export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'communication_config')
  const accountId = teamMember.account_id
  const service = serverSupabaseServiceRole<Database>(event)

  // WhatsApp rows are read with the caller's own client, and RLS already
  // gives someone without Inbox access none (0164) -- so the stats need not
  // wait for the permission check; it only says whether a zero means hidden.
  const [readWhatsApp, { data: rules, error }, { data: steps }, { data: subscription }, stats, delayChanged] = await Promise.all([
    canReadWhatsApp(supabase, teamMember),
    supabase
      .from('automation_rules')
      .select('id, name, trigger_event, enabled, filters, is_marketing, dry_run, segment, segment_last_run_at, entry_mode, exit_on, quiet_hours, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false }),
    supabase.from('automation_actions').select('rule_id, action_type, parent_id').eq('account_id', accountId),
    supabase.from('subscriptions').select('plan_id, growth_addon, status, comped').eq('account_id', accountId).maybeSingle(),
    statsByRule(supabase, service, accountId),
    rulesWhoseDelayNowWaits(supabase, accountId),
  ])
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const byRule = new Map<string, { action_type: string; parent_id: string | null }[]>()
  for (const s of steps ?? []) {
    const list = byRule.get(s.rule_id)
    if (list) list.push(s)
    else byRule.set(s.rule_id, [s])
  }
  const createdAt = new Map((rules ?? []).map((r) => [r.id, r.created_at]))

  // One-off sends say where they stand (utils/oneOffSendStatus.ts), from
  // segment_last_run_at and the runs still inside. A capped one has a third
  // input: whether its last day filled the cap, so it carries on tomorrow --
  // the engine's own test (enrolDueSegments): runs started since its last
  // claim, with a minute of slack for the two clocks. Only those few rules
  // are counted.
  const isOneOff = (r: { trigger_event: string; segment: unknown }) =>
    r.trigger_event === 'segment' && (r.segment as { schedule?: { kind?: string } } | null)?.schedule?.kind === 'once'
  const carryingOver = new Set<string>()
  await Promise.all(
    (rules ?? [])
      .filter((r) => isOneOff(r) && r.segment_last_run_at && segmentDailyLimit(r.segment as { daily_limit?: unknown } | null))
      .map(async (r) => {
        const cap = segmentDailyLimit(r.segment as { daily_limit?: unknown })!
        const { count } = await service
          .from('automation_sequence_runs')
          .select('id', { count: 'exact', head: true })
          .eq('rule_id', r.id)
          .gte('started_at', new Date(new Date(r.segment_last_run_at!).getTime() - 60_000).toISOString())
        if ((count ?? 0) >= cap) carryingOver.add(r.id)
      }),
  )

  // Why a paused automation cannot be switched on, so its switch says so
  // rather than refusing after the click: the same checks saving runs
  // (findProblems), minus the two that need another trip -- the WhatsApp
  // templates (Meta) and whether a named list still exists. Those still
  // refuse on the switch itself (enabled.post.ts). Only the paused ones,
  // and their full steps read only for them: an email step carries its HTML.
  const pausedIds = (rules ?? []).filter((r) => !r.enabled).map((r) => r.id)
  const blockers = new Map<string, Problem['message'][]>()
  if (pausedIds.length) {
    const { data: full } = await supabase.from('automation_actions').select(STEP_COLUMNS).eq('account_id', accountId).in('rule_id', pausedIds)
    const fullByRule = new Map<string, DraftStep[]>()
    for (const s of (full ?? []) as unknown as (DraftStep & { rule_id: string })[]) {
      const step = { ...s, config: s.config ?? {}, parent_id: s.parent_id ?? null, branch: s.branch ?? null }
      const list = fullByRule.get(s.rule_id)
      if (list) list.push(step)
      else fullByRule.set(s.rule_id, [step])
    }
    for (const r of rules ?? []) {
      if (r.enabled) continue
      const found = findProblems(r as unknown as DraftRule, fullByRule.get(r.id) ?? [], null)
      if (found.length) blockers.set(r.id, found.map((p) => p.message))
    }
  }

  return {
    rules: (rules ?? []).map((r) => {
      const ruleSteps = byRule.get(r.id) ?? []
      const { entry_mode, exit_on, quiet_hours, ...rest } = r
      return {
        ...rest,
        stepCount: ruleSteps.length,
        blockers: blockers.get(r.id) ?? [],
        stepTypes: [...new Set(ruleSteps.map((s) => s.action_type))],
        hasConditions: ruleSteps.some((s) => s.action_type === 'branch' || s.action_type === 'wait_until'),
        // The same test as the engine's ruleNeedsRun: whether people stay
        // "inside" this automation, or it sends the moment it fires.
        usesRuns:
          ruleSteps.some((s) => s.parent_id || !MESSAGE_STEPS.includes(s.action_type)) ||
          (entry_mode ?? 'every_time') !== 'every_time' ||
          ((exit_on as string[] | null) ?? []).length > 0 ||
          isValidQuietHours(quiet_hours),
        // A capped one-off send with people left for tomorrow (oneOffSendStatus).
        carryingOver: carryingOver.has(r.id),
      }
    }),
    stats,
    canReadWhatsApp: readWhatsApp,
    hasGrowth: hasGrowth(subscription),
    delayChanged: delayChanged.filter((r) => (createdAt.get(r.id) ?? '') < DELAYS_HONOURED_SINCE).map((r) => ({ id: r.id, name: r.name })),
  }
})
