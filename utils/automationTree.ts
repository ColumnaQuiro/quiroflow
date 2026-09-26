// A rule and its steps as the builder edits them and the save API receives
// them: steps are automation_actions rows, a tree through parent_id + branch
// (utils: automationEngine walks the same shape). Pure -- the builder uses it
// to show what is missing before anyone presses Save, and the server runs the
// same checks before it writes anything, so the two cannot disagree about
// what a valid automation is.

import { MESSAGE_STEPS, OUTLETS, VALUELESS_OPS, conditionFieldDef, isLeadTrigger, stepDef, triggerDef, waitEventDef, type Pair } from './automationCatalog'

export interface DraftStep {
  id: string
  action_type: string
  config: Record<string, any>
  parent_id: string | null
  branch: string | null
  position: number
}

export interface DraftRule {
  name: string
  trigger_event: string
  filters: Record<string, any>
  is_marketing: boolean
  dry_run: boolean
  entry_mode: 'every_time' | 'one_at_a_time' | 'once_ever'
  exit_on: string[]
  quiet_hours: { from: string; to: string; days?: number[] } | null
  segment: {
    filters?: Record<string, any>
    schedule?: { kind: 'once' | 'daily' | 'weekly'; weekday?: number; time?: string; starts_at?: string }
    reentry_days?: number | null
  } | null
}

/** A thing missing before a rule can run: shown in the "missing something" dialog, and tied to a step when it is about one. */
export interface Problem {
  stepId: string | null
  message: Pair
}

export interface TemplateInfo {
  name: string
  language: string
  status: string
  variableCount: number
  urlButtonCount: number
  mediaHeaderFormat: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

// ------------------------------------------------------------------ shape

/** The steps of one chain, in order. */
export function chainOf(steps: DraftStep[], parentId: string | null, branch: string | null): DraftStep[] {
  return steps.filter((s) => (s.parent_id ?? null) === parentId && (s.branch ?? null) === branch).sort((a, b) => a.position - b.position)
}

/** A step and everything hanging below it. */
export function subtreeIds(steps: DraftStep[], id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const s of steps) {
      if (s.parent_id && out.has(s.parent_id) && !out.has(s.id)) {
        out.add(s.id)
        grew = true
      }
    }
  }
  return out
}

/** Positions 0..n-1 in every chain, in their current order. */
export function normalizePositions(steps: DraftStep[]): DraftStep[] {
  const byChain = new Map<string, DraftStep[]>()
  for (const s of steps) {
    const key = `${s.parent_id ?? ''}|${s.branch ?? ''}`
    byChain.set(key, [...(byChain.get(key) ?? []), s])
  }
  const out: DraftStep[] = []
  for (const chain of byChain.values()) {
    chain.sort((a, b) => a.position - b.position).forEach((s, i) => out.push({ ...s, position: i }))
  }
  return out
}

/** The step after this one in its own chain, or null at the end. */
export function nextInChain(steps: DraftStep[], step: DraftStep): DraftStep | null {
  return chainOf(steps, step.parent_id, step.branch).find((s) => s.position > step.position) ?? null
}

/**
 * Faults that make the tree unsaveable, whatever state the rule is in:
 * references outside the rule, a chain hanging from a step that has no such
 * outlet, a cycle. The server refuses these outright (400); the builder can
 * never produce them, so they mean a bug or a hand-made request.
 */
export function structuralErrors(steps: DraftStep[], triggerEvent: string): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const s of steps) {
    if (!isUuid(s.id)) errors.push(`Step id ${String(s.id)} is not a uuid.`)
    if (ids.has(s.id)) errors.push(`Step ${s.id} appears twice.`)
    ids.add(s.id)
    const def = stepDef(s.action_type)
    if (!def) errors.push(`Unknown step type "${s.action_type}".`)
    if (def?.leadOnly && !isLeadTrigger(triggerEvent)) errors.push(`"${s.action_type}" only belongs in a lead automation.`)
    if (!Number.isInteger(s.position) || s.position < 0) errors.push(`Step ${s.id} has an invalid position.`)
    if (!s.config || typeof s.config !== 'object' || Array.isArray(s.config)) errors.push(`Step ${s.id} has no config object.`)
  }
  const byId = new Map(steps.map((s) => [s.id, s]))
  for (const s of steps) {
    if ((s.parent_id === null) !== (s.branch === null)) {
      errors.push(`Step ${s.id} must have both a parent and a branch, or neither.`)
      continue
    }
    if (s.parent_id === null) continue
    const parent = byId.get(s.parent_id)
    if (!parent) {
      errors.push(`Step ${s.id} hangs from a step that is not in this automation.`)
      continue
    }
    const outlets = OUTLETS[parent.action_type]
    if (!outlets || !outlets.includes(s.branch!)) errors.push(`Step ${s.id} hangs from "${s.branch}", which a ${parent.action_type} step does not have.`)
  }
  // A branch or a wait hands every run to one of its outlets and the run ends
  // where that chain ends (automationEngine: advanceRun), so a step after one
  // in the same chain could never be reached. The builder only offers "+"
  // inside the outlets; this keeps anything else from saving a dead step.
  for (const s of steps) {
    if (!OUTLETS[s.action_type]) continue
    const later = steps.some((o) => o.id !== s.id && (o.parent_id ?? null) === (s.parent_id ?? null) && (o.branch ?? null) === (s.branch ?? null) && o.position > s.position)
    if (later) errors.push(`Nothing can follow a ${s.action_type} step in the same chain; put it inside one of its paths.`)
  }
  // A cycle: walking up from any step must reach the root.
  for (const s of steps) {
    let cursor: DraftStep | undefined = s
    let hops = 0
    while (cursor?.parent_id) {
      cursor = byId.get(cursor.parent_id)
      if (++hops > steps.length) {
        errors.push(`Step ${s.id} is inside a loop.`)
        break
      }
    }
  }
  return [...new Set(errors)]
}

// ------------------------------------------------------------------ completeness

function stepName(step: DraftStep): string {
  if (step.action_type === 'whatsapp_template') return step.config?.template_name ? `WhatsApp «${step.config.template_name}»` : 'WhatsApp'
  if (step.action_type === 'email') return step.config?.subject ? `Email «${step.config.subject}»` : 'Email'
  const def = stepDef(step.action_type)
  return def ? def.label[1] : step.action_type
}
function stepNameEn(step: DraftStep): string {
  if (step.action_type === 'whatsapp_template') return step.config?.template_name ? `WhatsApp "${step.config.template_name}"` : 'WhatsApp'
  if (step.action_type === 'email') return step.config?.subject ? `Email "${step.config.subject}"` : 'Email'
  const def = stepDef(step.action_type)
  return def ? def.label[0] : step.action_type
}

/**
 * What is missing before this automation can run. A rule with problems can
 * still be saved -- paused, as a draft -- but not switched on.
 *
 * `templates`: the account's WhatsApp templates (every status), when they
 * could be read. Null when WhatsApp is not connected or Meta could not be
 * reached: the checks that need it are skipped rather than failing every
 * rule with a WhatsApp step, and the sender still refuses at send time.
 */
export function findProblems(rule: DraftRule, steps: DraftStep[], templates: TemplateInfo[] | null): Problem[] {
  const problems: Problem[] = []
  const add = (stepId: string | null, en: string, es: string) => problems.push({ stepId, message: [en, es] })

  if (!rule.name.trim()) add(null, 'The automation has no name.', 'La automatización no tiene nombre.')
  if (!triggerDef(rule.trigger_event)) add(null, 'Choose what starts this automation.', 'Elige qué inicia esta automatización.')
  if (steps.length === 0) add(null, 'Add at least one step.', 'Añade al menos un paso.')

  if (rule.trigger_event === 'appointment.hours_before' && !(Number(rule.filters?.hours_before) > 0)) {
    add(null, 'Say how many hours before the appointment.', 'Indica cuántas horas antes de la cita.')
  }
  if (rule.trigger_event === 'appointment.review_request' && !(Number(rule.filters?.days_after) > 0)) {
    add(null, 'Say how many days after the visit.', 'Indica cuántos días después de la cita.')
  }
  if (rule.trigger_event === 'segment') {
    const schedule = rule.segment?.schedule
    if (!schedule || !['once', 'daily', 'weekly'].includes(schedule.kind)) add(null, 'Choose when the group is checked.', 'Elige cuándo se revisa el grupo.')
    else if (schedule.kind !== 'once' && !/^\d{1,2}:\d{2}$/.test(schedule.time ?? '')) add(null, 'Choose the time the group is checked.', 'Elige a qué hora se revisa el grupo.')
    const f = rule.segment?.filters ?? {}
    if (Object.keys(f).filter((k) => f[k] !== undefined && f[k] !== null && !(Array.isArray(f[k]) && f[k].length === 0)).length === 0) {
      add(null, 'A group needs at least one filter, or it is every patient.', 'Un grupo necesita al menos un filtro, o serían todos los pacientes.')
    }
  }
  if (typeof rule.filters?.tag_contains === 'string' && 'tag_contains' in rule.filters && !rule.filters.tag_contains.trim()) {
    add(null, 'The tag filter is empty.', 'El filtro de etiqueta está vacío.')
  }

  const templateOf = (step: DraftStep) =>
    templates?.find((tpl) => tpl.name === step.config?.template_name && tpl.language === (step.config?.template_language || 'es')) ?? null

  for (const step of steps) {
    const c = step.config ?? {}
    const es = stepName(step)
    const en = stepNameEn(step)
    switch (step.action_type) {
      case 'whatsapp_template': {
        if (!c.template_name) {
          add(step.id, 'A WhatsApp step has no template chosen.', 'Un paso de WhatsApp no tiene plantilla.')
          break
        }
        const tpl = templateOf(step)
        if (templates && !tpl) {
          add(step.id, `The template "${c.template_name}" is not in your WhatsApp account.`, `La plantilla «${c.template_name}» no está en tu cuenta de WhatsApp.`)
          break
        }
        if (tpl && tpl.status !== 'APPROVED') {
          add(step.id, `The template "${c.template_name}" is ${tpl.status.toLowerCase()} at Meta, not approved.`, `La plantilla «${c.template_name}» está pendiente de aprobación en Meta (${tpl.status.toLowerCase()}).`)
        }
        const vars: { source?: string; text?: string }[] = Array.isArray(c.variables) ? c.variables : []
        const needed = tpl?.variableCount ?? vars.length
        for (let i = 0; i < needed; i++) {
          const v = vars[i]
          if (!v?.source || (v.source === 'text' && !String(v.text ?? '').trim())) {
            add(step.id, `${en} uses {{${i + 1}}} and nothing is assigned to it.`, `${es} usa {{${i + 1}}} y no está asignado.`)
          }
        }
        if (tpl?.mediaHeaderFormat) {
          const h = c.header ?? {}
          const ok = tpl.mediaHeaderFormat === 'LOCATION' ? Number.isFinite(Number(h.latitude)) && Number.isFinite(Number(h.longitude)) && h.latitude !== undefined : Boolean(h.storage_path)
          if (!ok) add(step.id, `${en} needs its ${tpl.mediaHeaderFormat.toLowerCase()} header.`, `${es} necesita su cabecera (${tpl.mediaHeaderFormat.toLowerCase()}).`)
        }
        break
      }
      case 'email':
        if (!String(c.subject ?? '').trim()) add(step.id, 'An email step has no subject.', 'Un email no tiene asunto.')
        if (!String(c.body ?? '').replace(/<[^>]*>/g, '').trim() && !/<img/i.test(String(c.body ?? ''))) add(step.id, `${en} has no body.`, `${es} no tiene texto.`)
        break
      case 'webhook':
        if (!/^https?:\/\/\S+$/i.test(String(c.url ?? '').trim())) add(step.id, 'A webhook step has no valid URL.', 'Un webhook no tiene una URL válida.')
        break
      case 'delay':
        if (!(Number(c.delay_minutes) > 0)) add(step.id, 'A wait step has no duration.', 'Un paso de «Esperar» no tiene duración.')
        break
      case 'wait_until': {
        const ev = waitEventDef(String(c.event ?? ''))
        if (!ev) add(step.id, 'A "wait until" step has nothing to wait for.', 'Un paso de «Esperar hasta que…» no dice a qué espera.')
        if (!(Number(c.timeout_minutes) > 0)) {
          const name = ev ? ev.until : (['"Wait until…"', '«Esperar hasta que…»'] as const)
          add(step.id, `${name[0]} has no time limit.`, `«${name[1]}» no tiene límite de días.`)
        }
        break
      }
      case 'branch': {
        const conditions: { field?: string; op?: string; value?: unknown }[] = Array.isArray(c.conditions) ? c.conditions : []
        if (conditions.length === 0) add(step.id, 'An if/else step asks nothing, so everyone would take "Yes".', 'Un paso «Si / si no» no pregunta nada: todos irían por «Sí».')
        for (const cond of conditions) {
          const def = conditionFieldDef(String(cond.field ?? ''))
          if (!def) {
            add(step.id, 'An if/else step has a condition with no question.', 'Un paso «Si / si no» tiene una condición sin pregunta.')
            continue
          }
          if (def.subject === 'lead' && !isLeadTrigger(rule.trigger_event)) add(step.id, `"${def.label[0]}" only applies to leads.`, `«${def.label[1]}» solo aplica a leads.`)
          if (!cond.op) add(step.id, `The condition "${def.label[0]}" has no comparison.`, `La condición «${def.label[1]}» no tiene comparación.`)
          const valueless = VALUELESS_OPS.includes(String(cond.op))
          const empty = cond.value === undefined || cond.value === null || cond.value === '' || (Array.isArray(cond.value) && cond.value.length === 0)
          if (!valueless && empty) add(step.id, `The condition "${def.label[0]}" has no value.`, `La condición «${def.label[1]}» no tiene valor.`)
        }
        break
      }
      case 'tag':
        if (!String(c.tag ?? '').trim()) add(step.id, 'A tag step has no tag.', 'Un paso de etiqueta no tiene etiqueta.')
        break
      case 'notify': {
        const to = c.to ?? {}
        if (!to.team_member_id && !to.role_id && !to.practitioner_of_appointment) add(step.id, 'A notify step does not say who to tell.', 'Un aviso no dice a quién avisar.')
        if (!String(c.title ?? '').trim()) add(step.id, 'A notify step has no message.', 'Un aviso no tiene texto.')
        break
      }
      case 'lead_stage':
        if (!c.stage) add(step.id, 'A lead stage step has no stage.', 'Un cambio de etapa no tiene etapa.')
        break
      case 'lead_assign':
        if (!c.team_member_id) add(step.id, 'An assign step has nobody to assign to.', 'Una asignación no dice a quién.')
        break
    }
  }
  return problems
}

/** The message steps of a flow, as "Send test to me" sends them: in tree order, flow steps left out. */
export function messageStepsInOrder(steps: DraftStep[]): DraftStep[] {
  const out: DraftStep[] = []
  const walk = (parentId: string | null, branch: string | null) => {
    for (const s of chainOf(steps, parentId, branch)) {
      if (MESSAGE_STEPS.includes(s.action_type)) out.push(s)
      const outlets = OUTLETS[s.action_type]
      if (outlets) for (const o of outlets) walk(s.id, o)
    }
  }
  walk(null, null)
  return out
}

/** A fresh id for a step the builder has just added, so its children can point at it before it is saved. */
export function newStepId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Fallback for very old browsers; still a valid v4 shape.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Where someone on a removed step goes when they are "moved on": the step
 * that now follows the last surviving step before it, in the same chain --
 * so a step deleted outright hands over to what came after it, and one that
 * was replaced hands over to its replacement. Up the tree when the removed
 * step's whole chain went with it.
 */
export function successorInNewTree(removedId: string, oldSteps: DraftStep[], newSteps: DraftStep[]): DraftStep | null {
  const newIds = new Set(newSteps.map((s) => s.id))
  const byId = new Map(oldSteps.map((s) => [s.id, s]))
  let top = byId.get(removedId)
  while (top?.parent_id && !newIds.has(top.parent_id)) top = byId.get(top.parent_id)
  if (!top) return null
  const oldChain = chainOf(oldSteps, top.parent_id, top.branch)
  const before = oldChain.filter((s) => s.position < top!.position && newIds.has(s.id)).pop() ?? null
  const newChain = chainOf(newSteps, top.parent_id, top.branch)
  if (!before) return newChain[0] ?? null
  const anchor = newChain.findIndex((s) => s.id === before.id)
  return anchor >= 0 ? (newChain[anchor + 1] ?? null) : null
}
