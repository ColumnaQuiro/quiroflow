import { logRunEvent, stopRun } from '~/server/utils/leadSequences'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { tryFetchWhatsAppTemplates } from '~/server/utils/whatsappTemplates'
import { EXIT_EVENTS, isLeadTrigger, triggerDef } from '~/utils/automationCatalog'
import {
  chainOf,
  findProblems,
  successorInNewTree,
  normalizePositions,
  structuralErrors,
  type DraftRule,
  type DraftStep,
  type Problem,
} from '~/utils/automationTree'
import { isValidQuietHours } from '~/utils/automationTiming'

// Reading and writing one automation -- the rule row and its tree of steps --
// for the Automations builder.
//
// The one property everything here exists to keep: STEP IDS ARE STABLE. The
// old Campaigns editor deleted every step and re-inserted the lot on each
// save, which was harmless while nothing pointed at a step. Runs do now
// (automation_sequence_runs.current_action_id, a foreign key that nulls on
// delete), so a save that re-created a step a patient was parked on would
// silently drop them back to the root chain -- or out of the automation
// altogether. So a save updates the steps that exist, inserts the new ones
// with the ids the builder gave them, and deletes only what was removed;
// and when people are on a removed step, it asks what to do with them.

export const RULE_COLUMNS =
  'id, account_id, name, trigger_event, enabled, filters, is_marketing, dry_run, entry_mode, exit_on, quiet_hours, segment, segment_last_run_at, created_at, created_by'
export const STEP_COLUMNS = 'id, rule_id, action_type, position, config, parent_id, branch'

export interface StoredRule extends DraftRule {
  id: string
  account_id: string
  enabled: boolean
  created_at: string
  segment_last_run_at: string | null
}

export async function loadRuleTree(supabase: any, accountId: string, ruleId: string) {
  const [{ data: rule, error }, { data: steps }] = await Promise.all([
    supabase.from('automation_rules').select(RULE_COLUMNS).eq('id', ruleId).eq('account_id', accountId).maybeSingle(),
    supabase.from('automation_actions').select(STEP_COLUMNS).eq('rule_id', ruleId).eq('account_id', accountId).order('position'),
  ])
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!rule) return null
  return {
    rule: rule as StoredRule,
    steps: ((steps ?? []) as DraftStep[]).map((s) => ({ ...s, config: s.config ?? {}, parent_id: s.parent_id ?? null, branch: s.branch ?? null })),
  }
}

// ------------------------------------------------------------------ input

const plainObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The rule fields from a request body, each checked and defaulted; a 400 for anything that cannot be meant. */
export function sanitizeRule(body: any): DraftRule {
  if (!plainObject(body)) throw createError({ statusCode: 400, statusMessage: 'rule is required' })
  const trigger = String(body.trigger_event ?? '')
  if (!triggerDef(trigger)) throw createError({ statusCode: 400, statusMessage: `Unknown trigger "${trigger}"` })

  const filters = plainObject(body.filters) ? body.filters : {}
  if (JSON.stringify(filters).length > 20_000) throw createError({ statusCode: 400, statusMessage: 'filters are too large' })

  const exitOn = Array.isArray(body.exit_on)
    ? [...new Set(body.exit_on.filter((e: unknown) => EXIT_EVENTS.some((x) => x.value === e)))]
    : []
  const quiet = body.quiet_hours && isValidQuietHours(body.quiet_hours)
    ? { from: body.quiet_hours.from, to: body.quiet_hours.to, days: Array.isArray(body.quiet_hours.days) ? body.quiet_hours.days.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 7) : [] }
    : null

  let segment: DraftRule['segment'] = null
  if (trigger === 'segment') {
    const raw = plainObject(body.segment) ? body.segment : {}
    const schedule = plainObject(raw.schedule) ? raw.schedule : { kind: 'weekly', weekday: 1, time: '10:00' }
    segment = {
      filters: plainObject(raw.filters) ? raw.filters : {},
      schedule: {
        kind: ['once', 'daily', 'weekly'].includes(schedule.kind) ? schedule.kind : 'weekly',
        ...(Number.isInteger(schedule.weekday) ? { weekday: schedule.weekday } : {}),
        ...(typeof schedule.time === 'string' ? { time: schedule.time } : {}),
        ...(typeof schedule.starts_at === 'string' && !Number.isNaN(new Date(schedule.starts_at).getTime()) ? { starts_at: schedule.starts_at } : {}),
      },
      reentry_days: Number(raw.reentry_days) > 0 ? Math.round(Number(raw.reentry_days)) : null,
    }
  }

  // A lead gets a drip once: the unique (rule_id, lead_id) index says so
  // whatever the column holds, so the column says it too.
  const entryMode = isLeadTrigger(trigger)
    ? 'once_ever'
    : ['every_time', 'one_at_a_time', 'once_ever'].includes(body.entry_mode)
      ? body.entry_mode
      : 'every_time'

  return {
    name: String(body.name ?? '').trim().slice(0, 160),
    trigger_event: trigger,
    filters,
    is_marketing: body.is_marketing === true,
    dry_run: body.dry_run === true,
    entry_mode: entryMode,
    exit_on: exitOn as string[],
    quiet_hours: quiet,
    segment,
  }
}

export function sanitizeSteps(body: unknown): DraftStep[] {
  if (!Array.isArray(body)) throw createError({ statusCode: 400, statusMessage: 'steps must be a list' })
  if (body.length > 200) throw createError({ statusCode: 400, statusMessage: 'Too many steps' })
  const steps = body.map((raw: any) => ({
    id: String(raw?.id ?? ''),
    action_type: String(raw?.action_type ?? ''),
    config: plainObject(raw?.config) ? raw.config : {},
    parent_id: raw?.parent_id ? String(raw.parent_id) : null,
    branch: raw?.branch ? String(raw.branch) : null,
    position: Number.isInteger(raw?.position) ? raw.position : 0,
  }))
  if (JSON.stringify(steps).length > 400_000) throw createError({ statusCode: 400, statusMessage: 'The automation is too large' })
  return normalizePositions(steps)
}

// ------------------------------------------------------------------ problems

/** Everything missing before the rule can run, including the plan and the WhatsApp templates. */
export async function ruleProblems(supabase: any, accountId: string, rule: DraftRule, steps: DraftStep[]): Promise<Problem[]> {
  const needsTemplates = steps.some((s) => s.action_type === 'whatsapp_template' && s.config?.template_name)
  const templates = needsTemplates ? await tryFetchWhatsAppTemplates(supabase, accountId) : null
  const problems = findProblems(rule, steps, templates)
  if (isLeadTrigger(rule.trigger_event) || steps.some((s) => s.action_type === 'lead_stage' || s.action_type === 'lead_assign')) {
    const { data: subscription } = await supabase.from('subscriptions').select('plan_id, growth_addon, status, comped').eq('account_id', accountId).maybeSingle()
    if (!hasGrowth(subscription)) {
      problems.unshift({ stepId: null, message: ['Lead automations are part of Growth, which is not on this subscription.', 'Las automatizaciones de leads son de Growth, que no está en esta suscripción.'] })
    }
  }
  return problems
}

// ------------------------------------------------------------------ saving

export type RemovedPolicy = 'move_on' | 'take_out'

interface RunRow {
  id: string
  account_id: string
  rule_id: string
  status: string
  current_action_id: string | null
  next_position: number
  waiting_for: string | null
}

/** Where a run will pick up, in terms of a step: at it, or just after it (parked at a delay). */
function resumePoint(run: RunRow, oldSteps: DraftStep[]): { stepId: string; after: boolean } | null {
  if (run.current_action_id && oldSteps.some((s) => s.id === run.current_action_id)) {
    return { stepId: run.current_action_id, after: run.waiting_for === 'delay' }
  }
  // Runs from before the engine carry only a root-chain cursor.
  const at = chainOf(oldSteps, null, null).find((s) => s.position >= run.next_position)
  return at ? { stepId: at.id, after: false } : null
}

export interface PeopleOnRemoved {
  stepId: string
  actionType: string
  count: number
}

/**
 * Saves a rule and its tree. `ruleId` null creates it.
 *
 * `supabase` is the caller's client -- the rule and its steps are written
 * under RLS, which requires communication_config. `service` moves runs, which
 * staff cannot write directly, deliberately.
 *
 * When people are parked on a step this save removes and `removedPolicy` is
 * not given, nothing is written and the answer lists them, so the builder can
 * ask. `enabled`, when given, is the state the rule is saved in; a rule with
 * problems cannot be saved enabled.
 */
export async function saveRuleTree(opts: {
  supabase: any
  service: any
  accountId: string
  teamMemberId: string
  ruleId: string | null
  rule: DraftRule
  steps: DraftStep[]
  enabled?: boolean
  removedPolicy?: RemovedPolicy
}): Promise<
  | { ok: true; ruleId: string; problems: Problem[]; moved: number; takenOut: number }
  | { ok: false; reason: 'people_on_removed'; people: PeopleOnRemoved[] }
  | { ok: false; reason: 'problems'; problems: Problem[] }
> {
  const { supabase, service, accountId } = opts
  const steps = normalizePositions(opts.steps)

  const structural = structuralErrors(steps, opts.rule.trigger_event)
  if (structural.length > 0) throw createError({ statusCode: 400, statusMessage: structural.join(' ') })

  // Nothing in the schema stops a step's parent being in another rule, or an
  // id being reused from another rule's step -- which an upsert would then
  // quietly move across. Both are refused here.
  const ids = steps.map((s) => s.id)
  if (ids.length > 0) {
    let foreign = service.from('automation_actions').select('id').in('id', ids)
    foreign = opts.ruleId ? foreign.neq('rule_id', opts.ruleId) : foreign
    const { data: taken } = await foreign
    if ((taken ?? []).length > 0) throw createError({ statusCode: 400, statusMessage: 'A step id belongs to another automation.' })
  }

  let existingRule: StoredRule | null = null
  let oldSteps: DraftStep[] = []
  if (opts.ruleId) {
    const loaded = await loadRuleTree(supabase, accountId, opts.ruleId)
    if (!loaded) throw createError({ statusCode: 404, statusMessage: 'Automation not found' })
    existingRule = loaded.rule
    oldSteps = loaded.steps
  }

  const enabled = opts.enabled ?? existingRule?.enabled ?? false
  const problems = await ruleProblems(supabase, accountId, opts.rule, steps)
  if (enabled && problems.length > 0) return { ok: false, reason: 'problems', problems }

  // ---- people on removed steps
  const keep = new Set(ids)
  const removed = oldSteps.filter((s) => !keep.has(s.id))
  const removedIds = new Set(removed.map((s) => s.id))
  let runs: RunRow[] = []
  if (opts.ruleId) {
    const { data } = await service
      .from('automation_sequence_runs')
      .select('id, account_id, rule_id, status, current_action_id, next_position, waiting_for')
      .eq('rule_id', opts.ruleId)
      .in('status', ['running', 'failed'])
    runs = (data ?? []) as RunRow[]
  }
  const points = new Map(runs.map((r) => [r.id, resumePoint(r, oldSteps)]))
  const onRemoved = runs.filter((r) => {
    const p = points.get(r.id)
    return p && removedIds.has(p.stepId)
  })
  if (onRemoved.length > 0 && !opts.removedPolicy) {
    const counts = new Map<string, number>()
    for (const r of onRemoved) counts.set(points.get(r.id)!.stepId, (counts.get(points.get(r.id)!.stepId) ?? 0) + 1)
    return {
      ok: false,
      reason: 'people_on_removed',
      people: [...counts.entries()].map(([stepId, count]) => ({ stepId, actionType: oldSteps.find((s) => s.id === stepId)?.action_type ?? '', count })),
    }
  }

  // ---- the rule row
  const payload = {
    name: opts.rule.name || 'Automation',
    trigger_event: opts.rule.trigger_event,
    filters: opts.rule.filters,
    is_marketing: opts.rule.is_marketing,
    dry_run: opts.rule.dry_run,
    entry_mode: opts.rule.entry_mode,
    exit_on: opts.rule.exit_on,
    quiet_hours: opts.rule.quiet_hours,
    segment: opts.rule.segment,
    enabled,
  }
  // A recurring segment switched on catches up on no occurrence from before
  // it was on: it enrols at its next scheduled time, which is what the
  // activation dialog promises. A one-off segment runs at the next tick.
  const turningOnRecurringSegment =
    enabled && !existingRule?.enabled && opts.rule.trigger_event === 'segment' && opts.rule.segment?.schedule?.kind !== 'once'
  const ruleWrite = opts.ruleId
    ? await supabase
        .from('automation_rules')
        .update({ ...payload, ...(turningOnRecurringSegment ? { segment_last_run_at: new Date().toISOString() } : {}) })
        .eq('id', opts.ruleId)
        .eq('account_id', accountId)
        .select('id')
        .maybeSingle()
    : await supabase
        .from('automation_rules')
        .insert({ ...payload, account_id: accountId, created_by: opts.teamMemberId })
        .select('id')
        .single()
  if (ruleWrite.error || !ruleWrite.data) {
    throw createError({ statusCode: ruleWrite.error?.code === '42501' ? 403 : 500, statusMessage: ruleWrite.error?.message ?? 'Could not save the automation' })
  }
  const ruleId = ruleWrite.data.id as string

  // ---- the steps, parents before children, each in place by id
  const byParent = (parentId: string | null) => steps.filter((s) => s.parent_id === parentId)
  const levels: DraftStep[][] = []
  let frontier = byParent(null)
  const seen = new Set<string>()
  while (frontier.length > 0) {
    levels.push(frontier)
    frontier.forEach((s) => seen.add(s.id))
    frontier = steps.filter((s) => s.parent_id && seen.has(s.parent_id) && !seen.has(s.id))
  }
  for (const level of levels) {
    const { error } = await supabase.from('automation_actions').upsert(
      level.map((s) => ({
        id: s.id,
        account_id: accountId,
        rule_id: ruleId,
        action_type: s.action_type,
        position: s.position,
        config: s.config,
        parent_id: s.parent_id,
        branch: s.branch,
      })),
      { onConflict: 'id' },
    )
    if (error) throw createError({ statusCode: error.code === '42501' ? 403 : 500, statusMessage: `Could not save the steps: ${error.message}` })
  }

  // ---- people on removed steps: moved on, or taken out, BEFORE the steps go
  // (the foreign key would otherwise null their place and drop them back to
  // the start of the root chain).
  let moved = 0
  let takenOut = 0
  for (const run of onRemoved) {
    const point = points.get(run.id)!
    if (opts.removedPolicy === 'take_out') {
      await stopRun(service, run, 'step_removed')
      takenOut += 1
      continue
    }
    const target = successorInNewTree(point.stepId, oldSteps, steps)
    if (target) {
      await service
        .from('automation_sequence_runs')
        .update({
          status: 'running',
          current_action_id: target.id,
          waiting_for: null,
          wait_deadline: null,
          attempts: 0,
          last_error: null,
          resume_at: new Date().toISOString(),
          ...(target.parent_id === null ? { next_position: target.position } : {}),
        })
        .eq('id', run.id)
      await logRunEvent(service, run, {
        outcome: 'skipped',
        action: oldSteps.find((s) => s.id === point.stepId) ?? null,
        detail: 'The step they were on was removed; moved on to the next one.',
        actorTeamMemberId: opts.teamMemberId,
      })
    } else {
      const root = chainOf(steps, null, null)
      await service
        .from('automation_sequence_runs')
        .update({ status: 'done', current_action_id: null, waiting_for: null, wait_deadline: null, attempts: 0, last_error: null, next_position: (root[root.length - 1]?.position ?? -1) + 1 })
        .eq('id', run.id)
      await logRunEvent(service, run, { outcome: 'finished', detail: 'The step they were on was removed and nothing came after it.', actorTeamMemberId: opts.teamMemberId })
    }
    moved += 1
  }

  if (removed.length > 0) {
    // The subtree roots are enough: children cascade.
    const roots = removed.filter((s) => !s.parent_id || !removedIds.has(s.parent_id)).map((s) => s.id)
    const { error } = await supabase.from('automation_actions').delete().in('id', roots).eq('rule_id', ruleId)
    if (error) throw createError({ statusCode: 500, statusMessage: `Could not remove the steps: ${error.message}` })
  }

  // ---- everyone else keeps their place. Root-chain runs read their cursor
  // from next_position, which is a POSITION, so a step inserted above them
  // would otherwise make them run a step again (or skip one).
  const newById = new Map(steps.map((s) => [s.id, s]))
  for (const run of runs) {
    if (onRemoved.includes(run)) continue
    const point = points.get(run.id)
    if (!point) continue
    const step = newById.get(point.stepId)
    if (!step || step.parent_id !== null) continue
    const next = step.position + (point.after ? 1 : 0)
    if (next === run.next_position && run.current_action_id === point.stepId) continue
    await service.from('automation_sequence_runs').update({ next_position: next, current_action_id: point.stepId }).eq('id', run.id).in('status', ['running', 'failed'])
  }

  return { ok: true, ruleId, problems, moved, takenOut }
}
