// An automation's trigger in words, for the list, the canvas and the trigger
// panel: "Appointment · 24 h before it starts", "Bono · 1 session left".
// Pure: the caller passes its own t().

import { LEAD_STAGE_OPTIONS } from './automationCatalog'
import { momentDef, subjectDef, type TriggerAtom, type TimingUnit } from './automationTrigger'

type Translate = (en: string, es: string) => string
type Filters = Record<string, unknown> | null | undefined

/** "3 days", "24 h", "30 min". */
export function amountText(t: Translate, n: number, unit: TimingUnit): string {
  if (unit === 'minutes') return t(`${n} min`, `${n} min`)
  if (unit === 'hours') return t(`${n} h`, `${n} h`)
  return n === 1 ? t('1 day', '1 día') : t(`${n} days`, `${n} días`)
}

/** The timing alone, after the moment's own words: "24 h before it starts". */
export function timingText(t: Translate, atom: TriggerAtom, filters?: Filters): string {
  const timing = atom.timing
  const def = momentDef(atom.subject, atom.moment)
  if (!timing || !def) return ''
  const n = Math.round(Number(timing.amount) || 0)
  const amount = amountText(t, n, timing.unit)
  const before = timing.direction === 'before'
  if (def.kind === 'event') return t(`${amount} later`, `${amount} después`)
  switch (`${atom.subject}.${atom.moment}`) {
    case 'appointment.start':
      if (timing.at) {
        if (n === 0) return t(`The day of it, at ${timing.at}`, `El mismo día, a las ${timing.at}`)
        return before ? t(`${amount} before, at ${timing.at}`, `${amount} antes, a las ${timing.at}`) : t(`${amount} after, at ${timing.at}`, `${amount} después, a las ${timing.at}`)
      }
      return before ? t(`${amount} before it starts`, `${amount} antes de que empiece`) : t(`${amount} after it starts`, `${amount} después de que empiece`)
    case 'appointment.end':
      return t(`${amount} after it ends`, `${amount} después de que termine`)
    case 'patient.birthday':
      if (n === 0) return t('On their birthday', 'El día de su cumpleaños')
      return before ? t(`${amount} before their birthday`, `${amount} antes de su cumpleaños`) : t(`${amount} after their birthday`, `${amount} después de su cumpleaños`)
    case 'patient.date_field':
      if (n === 0) return t('On the date', 'El día de la fecha')
      return before ? t(`${amount} before the date`, `${amount} antes de la fecha`) : t(`${amount} after the date`, `${amount} después de la fecha`)
    case 'patient.last_visit':
      return t(`${amount} after their last visit`, `${amount} después de su última visita`)
    case 'care_plan.started':
    case 'membership.started':
      return n === 0 ? t('The day it starts', 'El día que empieza') : t(`${amount} after it started`, `${amount} después de empezar`)
    case 'invoice.issued':
      return filters?.invoice_unpaid === true ? t(`${amount} after it was issued, still unpaid`, `${amount} después de emitirla, sin pagar`) : t(`${amount} after it was issued`, `${amount} después de emitirla`)
  }
  return before ? t(`${amount} before`, `${amount} antes`) : t(`${amount} after`, `${amount} después`)
}

/** The moment's own setting, when it narrows it: which tag, which score, how many sessions left. */
function optionText(t: Translate, atom: TriggerAtom): string {
  const o = atom.options ?? {}
  const key = `${atom.subject}.${atom.moment}`
  if ((key === 'patient.tag_added' || key === 'patient.tag_removed') && String(o.trigger_tag ?? '').trim()) {
    const tag = String(o.trigger_tag).trim()
    return key === 'patient.tag_added' ? t(`Tagged "${tag}"`, `Etiquetado «${tag}»`) : t(`"${tag}" removed`, `Quitada «${tag}»`)
  }
  if ((key === 'patient.type_added' || key === 'patient.type_removed') && typeof o.trigger_type_name === 'string' && o.trigger_type_name) {
    const name = o.trigger_type_name
    return key === 'patient.type_added' ? t(`Given the type "${name}"`, `Se pone el tipo «${name}»`) : t(`Type "${name}" taken away`, `Se quita el tipo «${name}»`)
  }
  if (key === 'rating.answered' && (o.trigger_score === 'high' || o.trigger_score === 'low')) {
    return o.trigger_score === 'high' ? t('Rated the visit 4-5', 'Valoró la visita con 4-5') : t('Rated the visit 1-3', 'Valoró la visita con 1-3')
  }
  if (key === 'care_plan.milestone') {
    if (o.trigger_milestone === 'finished') return t('Care plan finished', 'Plan de cuidado terminado')
    if (o.trigger_milestone === 'visit') {
      const n = Number(o.trigger_visit_number) || 1
      return t(`Visit ${n} of the care plan`, `Visita ${n} del plan de cuidado`)
    }
    return t('Re-exam is the next visit', 'La siguiente visita es la revisión')
  }
  if (key === 'bono.running_low') {
    const n = Number.isInteger(Number(o.trigger_sessions_left)) && o.trigger_sessions_left !== undefined ? Number(o.trigger_sessions_left) : 1
    return n === 0 ? t('Bono used up', 'Bono agotado') : n === 1 ? t('1 session left', '1 sesión restante') : t(`${n} sessions left`, `${n} sesiones restantes`)
  }
  if (key === 'lead.stage_changed' && typeof o.trigger_lead_stage === 'string') {
    const stage = LEAD_STAGE_OPTIONS.find((s) => s.value === o.trigger_lead_stage)
    if (stage) return t(`Moved to ${stage.label[0]}`, `Movido a ${stage.label[1]}`)
  }
  return ''
}

/**
 * The trigger as the list and the canvas name it: the subject, then the most
 * specific thing that can be said of the moment -- its timing, its option, or
 * just the moment.
 */
export function atomTitle(t: Translate, atom: TriggerAtom, filters?: Filters): string {
  if (atom.subject === 'group') return t('A group of patients', 'Un grupo de pacientes')
  const subject = subjectDef(atom.subject)
  const def = momentDef(atom.subject, atom.moment)
  if (!subject || !def) return t('Choose a trigger', 'Elige un disparador')
  const head = t(subject.label[0], subject.label[1])
  const moment = t(def.label[0], def.label[1])
  if (atom.send_to === 'referrer') return t(`Referred patient · ${moment.toLowerCase()}`, `Paciente referido · ${moment.toLowerCase()}`)
  const option = optionText(t, atom)
  const timing = timingText(t, atom, filters)
  if (def.kind === 'event' && timing) return `${head} · ${(option || moment).toLowerCase()}, ${timing}`
  return `${head} · ${timing || option || moment.toLowerCase()}`
}
