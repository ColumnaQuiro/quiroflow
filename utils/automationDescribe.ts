// How a step, a trigger and a filter read on the canvas and in the list: the
// short title on a node, the line under it. Pure, from the step's config and
// the names the page has loaded (appointment types, team, roles…).

import {
  BALANCE_OPTIONS,
  KIND_LABEL,
  LEAD_STAGE_OPTIONS,
  CONSENT_CHANNEL_OPTIONS,
  VALUELESS_OPS,
  conditionFieldDef,
  durationText,
  filtersInUse,
  quietHoursText,
  say,
  stepDef,
  waitEventDef,
  weekdayName,
  type Translate,
} from './automationCatalog'
import type { DraftRule, DraftStep } from './automationTree'

export interface NameLookup {
  appointmentTypes: { id: string; name: string }[]
  practitioners: { id: string; full_name: string }[]
  members: { id: string; full_name: string }[]
  roles: { id: string; name: string }[]
  clinics: { id: string; name: string }[]
  memberships: { id: string; name: string }[]
  templates: { name: string; language: string; bodyText: string }[]
}

export const emptyLookup = (): NameLookup => ({ appointmentTypes: [], practitioners: [], members: [], roles: [], clinics: [], memberships: [], templates: [] })

const names = (ids: unknown, list: { id: string; name?: string; full_name?: string }[]) =>
  (Array.isArray(ids) ? ids : [])
    .map((id) => list.find((x) => x.id === id))
    .filter(Boolean)
    .map((x) => x!.name ?? x!.full_name ?? '')
    .join(', ')

export const htmlToLine = (html: string) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

export function stepKindLabel(t: Translate, type: string): string {
  const def = stepDef(type)
  return say(t, KIND_LABEL[def?.kind ?? 'action'])
}

/** The eyebrow over a node: "Mensaje · WhatsApp", "Condición · Si / si no". */
export function stepEyebrow(t: Translate, type: string): string {
  const def = stepDef(type)
  if (!def) return type
  if (type === 'branch') return `${stepKindLabel(t, type)} · ${t('If / else', 'Si / si no')}`
  if (type === 'wait_until') return `${stepKindLabel(t, type)} · ${t('until an event', 'hasta un evento')}`
  if (def.kind === 'wait') return stepKindLabel(t, type)
  return `${stepKindLabel(t, type)} · ${say(t, def.label)}`
}

export function stepTitle(t: Translate, step: DraftStep, lookup: NameLookup): string {
  const c = step.config ?? {}
  switch (step.action_type) {
    case 'whatsapp_template':
      return c.template_name ? t(`WhatsApp "${c.template_name}"`, `WhatsApp «${c.template_name}»`) : t('WhatsApp · choose a template', 'WhatsApp · elige una plantilla')
    case 'email':
      return c.subject ? t(`Email "${c.subject}"`, `Email «${c.subject}»`) : t('Email · no subject yet', 'Email · sin asunto')
    case 'webhook':
      return 'Webhook'
    case 'delay':
      return t(`Wait ${durationText(t, Number(c.delay_minutes) || 0)}`, `Esperar ${durationText(t, Number(c.delay_minutes) || 0)}`)
    case 'wait_until': {
      const ev = waitEventDef(String(c.event ?? ''))
      return ev ? say(t, ev.until) : t('Wait until…', 'Esperar hasta que…')
    }
    case 'branch':
      return String(c.title ?? '').trim() || t('If / else', 'Si / si no')
    case 'tag':
      return c.mode === 'remove'
        ? t(`Remove tag "${c.tag ?? ''}"`, `Quitar etiqueta «${c.tag ?? ''}»`)
        : t(`Add tag "${c.tag ?? ''}"`, `Añadir etiqueta «${c.tag ?? ''}»`)
    case 'notify': {
      const to = c.to ?? {}
      const who = to.role_id
        ? (lookup.roles.find((r) => r.id === to.role_id)?.name ?? t('a role', 'un rol'))
        : to.team_member_id
          ? (lookup.members.find((m) => m.id === to.team_member_id)?.full_name ?? t('a person', 'una persona'))
          : to.practitioner_of_appointment
            ? t('the practitioner', 'el profesional')
            : t('someone', 'alguien')
      return t(`Notify ${who}`, `Avisar a ${who}`)
    }
    case 'lead_stage': {
      const stage = LEAD_STAGE_OPTIONS.find((s) => s.value === c.stage)
      return stage ? t(`Move lead to "${stage.label[0]}"`, `Cambiar etapa a «${stage.label[1]}»`) : t('Change lead stage', 'Cambiar etapa del lead')
    }
    case 'lead_assign': {
      const who = lookup.members.find((m) => m.id === c.team_member_id)?.full_name
      return who ? t(`Assign to ${who}`, `Asignar a ${who}`) : t('Assign the lead', 'Asignar el lead')
    }
    default:
      return step.action_type
  }
}

export function conditionText(t: Translate, cond: { field?: string; op?: string; value?: unknown }, lookup: NameLookup): string {
  const def = conditionFieldDef(String(cond.field ?? ''))
  if (!def) return t('(no question)', '(sin pregunta)')
  const op = def.ops.find((o) => o.op === cond.op)
  let value = ''
  if (def.value === 'balance') {
    value = say(t, BALANCE_OPTIONS.find((b) => b.op === cond.op && Number(cond.value) === b.cents)?.label ?? ['?', '?'])
    return `${say(t, def.label)} ${value}`
  }
  if (!VALUELESS_OPS.includes(String(cond.op))) {
    if (def.value === 'multi') {
      const list = def.options === 'appointment_types' ? lookup.appointmentTypes : def.options === 'practitioners' ? lookup.practitioners : []
      value = list.length
        ? names(cond.value, list)
        : (Array.isArray(cond.value) ? cond.value : [])
            .map((v) => say(t, LEAD_STAGE_OPTIONS.find((s) => s.value === v)?.label ?? [String(v), String(v)]))
            .join(', ')
    } else if (def.value === 'channel') {
      value = say(t, CONSENT_CHANNEL_OPTIONS.find((m) => m.value === cond.value)?.label ?? [String(cond.value ?? ''), String(cond.value ?? '')])
    } else {
      value = `«${String(cond.value ?? '')}»`
    }
  }
  return [say(t, def.label), op ? say(t, op.label) : '', value].filter(Boolean).join(' ')
}

export function stepDetail(t: Translate, step: DraftStep, lookup: NameLookup, rule: Pick<DraftRule, 'quiet_hours'>): string {
  const c = step.config ?? {}
  switch (step.action_type) {
    case 'whatsapp_template': {
      const tpl = lookup.templates.find((x) => x.name === c.template_name && x.language === (c.template_language || 'es'))
      return tpl?.bodyText ? tpl.bodyText.replace(/\s+/g, ' ').slice(0, 110) : c.template_name ? `${c.template_language || 'es'}` : ''
    }
    case 'email':
      return htmlToLine(c.body ?? '').slice(0, 110)
    case 'webhook': {
      try {
        return new URL(String(c.url)).host
      } catch {
        return t('No URL yet', 'Sin URL')
      }
    }
    case 'delay':
      return rule.quiet_hours ? t(`Sends ${quietHoursText(t, rule.quiet_hours).toLowerCase()}`, `Envía ${quietHoursText(t, rule.quiet_hours).toLowerCase()}`) : ''
    case 'wait_until':
      return Number(c.timeout_minutes) > 0 ? t(`At most ${durationText(t, Number(c.timeout_minutes))}`, `Como mucho ${durationText(t, Number(c.timeout_minutes))}`) : t('No time limit yet', 'Sin límite')
    case 'branch': {
      const conds: any[] = Array.isArray(c.conditions) ? c.conditions : []
      if (conds.length === 0) return t('Asks nothing yet', 'Aún no pregunta nada')
      return conds.map((x) => conditionText(t, x, lookup)).join(c.match === 'any' ? t(' or ', ' o ') : ' · ')
    }
    case 'tag':
      return t("On the patient's record", 'En la ficha del paciente')
    case 'notify':
      return String(c.title ?? '')
    case 'lead_stage':
    case 'lead_assign':
      return t('Lead', 'Lead')
    default:
      return ''
  }
}

/** The label on a fork's outlet: "Sí", "No", "Reservó", "No reservó en 7 días". */
export function outletLabel(t: Translate, parent: DraftStep | undefined, branch: string): string {
  if (branch === 'yes') return t('Yes', 'Sí')
  if (branch === 'no') return t('No', 'No')
  const ev = waitEventDef(String(parent?.config?.event ?? ''))
  if (branch === 'met') return ev ? say(t, ev.met) : t('It happened', 'Ocurrió')
  const minutes = Number(parent?.config?.timeout_minutes) || 0
  const prefix = ev ? say(t, ev.timeoutPrefix) : t('Not in', 'No en')
  return minutes > 0 ? `${prefix} ${durationText(t, minutes)}` : prefix
}

/** The trigger node's second line: its filters, or its schedule for a segment. */
export function triggerDetail(t: Translate, rule: DraftRule, lookup: NameLookup): string {
  if (rule.trigger_event === 'segment') {
    const s = rule.segment?.schedule
    if (!s) return ''
    if (s.kind === 'once') return t('Once', 'Una vez')
    if (s.kind === 'daily') return t(`Every day at ${s.time ?? '09:00'}`, `Cada día a las ${s.time ?? '09:00'}`)
    return t(`Every ${weekdayName(t, s.weekday ?? 1)} at ${s.time ?? '09:00'}`, `Cada ${weekdayName(t, s.weekday ?? 1)} a las ${s.time ?? '09:00'}`)
  }
  return filtersText(t, rule.filters, lookup)
}

export function filtersText(t: Translate, filters: Record<string, any> | null | undefined, lookup: NameLookup): string {
  const f = filters ?? {}
  const parts: string[] = []
  for (const key of filtersInUse(f)) {
    switch (key) {
      case 'appointment_types': {
        const ids = Array.isArray(f.appointment_type_ids) ? f.appointment_type_ids : f.appointment_type_id ? [f.appointment_type_id] : []
        const n = names(ids, lookup.appointmentTypes)
        if (n) parts.push(t(`Type: ${n}`, `Tipo: ${n}`))
        break
      }
      case 'practitioners': {
        const n = names(f.practitioner_ids, lookup.practitioners)
        if (n) parts.push(n)
        break
      }
      case 'total_visits':
        parts.push(t(`${f.total_visits} completed visits`, `${f.total_visits} visitas completadas`))
        break
      case 'no_prior_appointments':
        parts.push(t('First-time patients', 'Pacientes nuevos'))
        break
      case 'has_future_appointment':
        parts.push(f.has_future_appointment ? t('With a future appointment', 'Con cita futura') : t('No future appointment', 'Sin cita futura'))
        break
      case 'last_visit':
        parts.push(t(`Last visit over ${durationText(t, Number(f.last_visit_before_days) * 1440)} ago`, `Última visita hace más de ${durationText(t, Number(f.last_visit_before_days) * 1440)}`))
        break
      case 'tag_contains':
        parts.push(t(`Tag contains "${f.tag_contains}"`, `Etiqueta contiene «${f.tag_contains}»`))
        break
      case 'balance':
        parts.push(f.balance === 'debit' ? t('Owes money', 'Debe dinero') : t('In credit', 'Con saldo a favor'))
        break
      case 'membership':
        parts.push(names(f.membership_ids, lookup.memberships) || t('Active membership', 'Con membresía activa'))
        break
      case 'clinics':
        parts.push(names(f.clinic_ids, lookup.clinics))
        break
    }
  }
  return parts.filter(Boolean).join(' · ')
}
