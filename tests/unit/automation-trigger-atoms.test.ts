import { describe, it, expect } from 'vitest'
import {
  TRIGGER_MOMENTS,
  atomFromLegacy,
  atomProblem,
  atomOfRaisedEvent,
  defaultAtom,
  eventDelayMinutes,
  isDateAtom,
  isUpcomingVisitAtom,
  legacyFromAtom,
  onlyIfFilters,
  ruleAtom,
  ruleColumnsForAtom,
  timingMinutes,
  type TriggerAtom,
} from '../../utils/automationTrigger'

// Every trigger an automation could be saved on before the atoms, with the
// filters it was saved with (including the shapes production holds on
// 24 Nov 2026), and what it is as an atom. The backfill
// (automation_trigger_from_legacy in 20261124120000_automation_trigger_atoms.sql)
// is the same mapping; scripts/verify-trigger-atoms.mjs checks the two agree.

type Case = { event: string; filters: Record<string, unknown>; atom: Partial<TriggerAtom>; implied?: Record<string, unknown> }

const TYPE = '085069ad-2267-4707-bd40-eea9a504c642'
const FIELD = 'field:4f2c0f1e-0000-4000-8000-000000000001'

const CASES: Case[] = [
  { event: 'appointment.booked', filters: { appointment_type_id: TYPE, no_prior_appointments: true }, atom: { subject: 'appointment', moment: 'booked', timing: null } },
  { event: 'appointment.rescheduled', filters: {}, atom: { subject: 'appointment', moment: 'rescheduled', timing: null } },
  { event: 'appointment.cancelled', filters: { total_visits: 1 }, atom: { subject: 'appointment', moment: 'cancelled', timing: null } },
  { event: 'appointment.no_show', filters: {}, atom: { subject: 'appointment', moment: 'no_show', timing: null } },
  { event: 'appointment.checked_in', filters: { appointment_type_ids: [TYPE], total_visits: 1 }, atom: { subject: 'appointment', moment: 'checked_in', timing: null } },
  { event: 'appointment.completed', filters: { has_future_appointment: false }, atom: { subject: 'appointment', moment: 'completed', timing: null } },
  {
    event: 'appointment.hours_before',
    filters: { hours_before: 72 },
    atom: { subject: 'appointment', moment: 'start', timing: { amount: 72, unit: 'hours', direction: 'before' } },
    implied: { appointment_statuses: ['booked'], reminder_unanswered: true },
  },
  {
    event: 'appointment.hours_before',
    filters: { hours_before: 48, skip_if_answered: false, appointment_type_ids: [TYPE] },
    atom: { subject: 'appointment', moment: 'start', timing: { amount: 48, unit: 'hours', direction: 'before' } },
    implied: { appointment_statuses: ['booked'] },
  },
  {
    event: 'appointment.hours_before',
    filters: {},
    atom: { subject: 'appointment', moment: 'start', timing: { amount: 24, unit: 'hours', direction: 'before' } },
    implied: { appointment_statuses: ['booked'], reminder_unanswered: true },
  },
  {
    event: 'appointment.same_day',
    filters: { no_prior_appointments: true },
    atom: { subject: 'appointment', moment: 'start', timing: { amount: 0, unit: 'days', direction: 'before', at: '09:00' } },
    implied: { appointment_statuses: ['booked'] },
  },
  {
    event: 'appointment.review_request',
    filters: { days_after: 1, appointment_type_ids: [TYPE], has_future_appointment: false },
    atom: { subject: 'appointment', moment: 'end', timing: { amount: 1, unit: 'days', direction: 'after' } },
    implied: { appointment_statuses: ['completed'] },
  },
  {
    event: 'appointment.review_request',
    filters: {},
    atom: { subject: 'appointment', moment: 'end', timing: { amount: 2, unit: 'days', direction: 'after' } },
    implied: { appointment_statuses: ['completed'] },
  },
  {
    event: 'appointment.satisfaction',
    filters: { first_visit: true, hours_after: 2, every_visits: 10 },
    atom: { subject: 'appointment', moment: 'end', timing: { amount: 2, unit: 'hours', direction: 'after' } },
    implied: { appointment_statuses: ['completed'], visit_number: { first: true, every: 10 }, not_rated_days: 30 },
  },
  {
    event: 'appointment.satisfaction',
    filters: { first_visit: false, every_visits: 0, hours_after: 4 },
    atom: { subject: 'appointment', moment: 'end', timing: { amount: 4, unit: 'hours', direction: 'after' } },
    implied: { appointment_statuses: ['completed'], visit_number: { first: false, every: 0 }, not_rated_days: 30 },
  },
  { event: 'satisfaction.answered', filters: { trigger_score: 'low' }, atom: { subject: 'rating', moment: 'answered', timing: null, options: { trigger_score: 'low' } } },
  { event: 'invoice.paid', filters: {}, atom: { subject: 'invoice', moment: 'paid', timing: null } },
  {
    event: 'invoice.overdue',
    filters: { days_overdue: 7 },
    atom: { subject: 'invoice', moment: 'issued', timing: { amount: 7, unit: 'days', direction: 'after' } },
    implied: { invoice_unpaid: true },
  },
  { event: 'patient.birthday', filters: { has_future_appointment: true }, atom: { subject: 'patient', moment: 'birthday', timing: { amount: 0, unit: 'days', direction: 'after' } } },
  { event: 'patient.date', filters: { trigger_date: 'last_visit', trigger_days: 90 }, atom: { subject: 'patient', moment: 'last_visit', timing: { amount: 90, unit: 'days', direction: 'after' } } },
  { event: 'patient.date', filters: { trigger_date: 'membership_start', trigger_days: 30 }, atom: { subject: 'membership', moment: 'started', timing: { amount: 30, unit: 'days', direction: 'after' } } },
  { event: 'patient.date', filters: { trigger_date: 'care_plan_start', trigger_days: 0 }, atom: { subject: 'care_plan', moment: 'started', timing: { amount: 0, unit: 'days', direction: 'after' } } },
  {
    event: 'patient.date',
    filters: { trigger_date: FIELD, trigger_days: 14, trigger_when: 'before' },
    atom: { subject: 'patient', moment: 'date_field', timing: { amount: 14, unit: 'days', direction: 'before' }, options: { trigger_date: FIELD } },
  },
  { event: 'patient.tag_added', filters: { trigger_tag: 'VIP' }, atom: { subject: 'patient', moment: 'tag_added', timing: null, options: { trigger_tag: 'VIP' } } },
  { event: 'patient.tag_removed', filters: {}, atom: { subject: 'patient', moment: 'tag_removed', timing: null, options: {} } },
  {
    event: 'patient.type_added',
    filters: { trigger_type_id: TYPE, trigger_type_name: 'Embarazada' },
    atom: { subject: 'patient', moment: 'type_added', timing: null, options: { trigger_type_id: TYPE, trigger_type_name: 'Embarazada' } },
  },
  { event: 'patient.type_removed', filters: {}, atom: { subject: 'patient', moment: 'type_removed', timing: null } },
  { event: 'patient.referred', filters: {}, atom: { subject: 'referral', moment: 'referred', timing: null } },
  { event: 'referral.visit_completed', filters: { total_visits: 1 }, atom: { subject: 'appointment', moment: 'completed', timing: null, send_to: 'referrer' } },
  { event: 'membership.new_member', filters: {}, atom: { subject: 'membership', moment: 'started', timing: null } },
  { event: 'membership.removed', filters: {}, atom: { subject: 'membership', moment: 'cancelled', timing: null } },
  { event: 'membership.payment_processed', filters: {}, atom: { subject: 'membership', moment: 'charged', timing: null } },
  { event: 'waitlist.slot_offered', filters: {}, atom: { subject: 'waitlist', moment: 'slot_offered', timing: null } },
  { event: 'doc.completed', filters: { trigger_doc_template_ids: [TYPE] }, atom: { subject: 'form', moment: 'completed', timing: null, options: { trigger_doc_template_ids: [TYPE] } } },
  {
    event: 'care_plan.milestone',
    filters: { trigger_milestone: 'visit', trigger_visit_number: 6 },
    atom: { subject: 'care_plan', moment: 'milestone', timing: null, options: { trigger_milestone: 'visit', trigger_visit_number: 6 } },
  },
  { event: 'care_plan.milestone', filters: {}, atom: { subject: 'care_plan', moment: 'milestone', timing: null, options: {} } },
  { event: 'bono.running_low', filters: { trigger_sessions_left: 0 }, atom: { subject: 'bono', moment: 'running_low', timing: null, options: { trigger_sessions_left: 0 } } },
  { event: 'bono.running_low', filters: {}, atom: { subject: 'bono', moment: 'running_low', timing: null, options: { trigger_sessions_left: 1 } } },
  {
    event: 'audience.entered',
    filters: { trigger_audience: { kind: 'list', id: TYPE }, include_current: true },
    atom: { subject: 'patient', moment: 'entered_audience', timing: null, options: { trigger_audience: { kind: 'list', id: TYPE }, include_current: true } },
  },
  { event: 'lead.created', filters: {}, atom: { subject: 'lead', moment: 'created', timing: null } },
  { event: 'lead.stage_changed', filters: { trigger_lead_stage: 'contacted' }, atom: { subject: 'lead', moment: 'stage_changed', timing: null, options: { trigger_lead_stage: 'contacted' } } },
  { event: 'segment', filters: {}, atom: { subject: 'group', moment: 'scheduled', timing: null } },
]

// Every trigger_event value the check constraint allowed before the atoms.
const LEGACY_EVENTS = [
  'appointment.checked_in', 'appointment.booked', 'appointment.completed', 'appointment.cancelled',
  'appointment.no_show', 'appointment.rescheduled', 'appointment.same_day', 'appointment.hours_before',
  'invoice.paid', 'invoice.overdue', 'patient.birthday', 'membership.new_member', 'membership.removed',
  'membership.payment_processed', 'patient.referred', 'appointment.review_request', 'appointment.satisfaction',
  'lead.created', 'waitlist.slot_offered', 'segment',
  'satisfaction.answered', 'patient.tag_added', 'patient.tag_removed', 'doc.completed', 'lead.stage_changed',
  'care_plan.milestone', 'bono.running_low', 'audience.entered', 'patient.date',
  'patient.type_added', 'patient.type_removed', 'referral.visit_completed',
]

describe('atomFromLegacy', () => {
  it('covers every trigger the old check constraint allowed', () => {
    for (const event of LEGACY_EVENTS) expect(CASES.some((c) => c.event === event), event).toBe(true)
  })

  for (const c of CASES) {
    it(`${c.event} ${JSON.stringify(c.filters)}`, () => {
      const { trigger, implied } = atomFromLegacy(c.event, c.filters)
      expect(trigger).toMatchObject({ options: {}, ...c.atom })
      if (!('send_to' in c.atom)) expect(trigger.send_to).toBeUndefined()
      expect(implied).toEqual(c.implied ?? {})
      expect(atomProblem(trigger)).toBeNull()
    })
  }

  it('an unknown trigger becomes an atom that names nothing, which never fires', () => {
    const { trigger } = atomFromLegacy('appointment.something_new', {})
    expect(atomProblem(trigger)).not.toBeNull()
  })

  it('a malformed filters value is read as no filters', () => {
    expect(atomFromLegacy('appointment.hours_before', null).trigger.timing).toEqual({ amount: 24, unit: 'hours', direction: 'before' })
    expect(atomFromLegacy('appointment.hours_before', ['x']).trigger.timing).toEqual({ amount: 24, unit: 'hours', direction: 'before' })
  })
})

describe('legacyFromAtom: the old code keeps reading what it read', () => {
  for (const c of CASES) {
    it(`${c.event} ${JSON.stringify(c.filters)} round-trips`, () => {
      const { trigger, implied } = atomFromLegacy(c.event, c.filters)
      const filters = { ...onlyIfFilters(c.filters), ...implied }
      const back = legacyFromAtom(trigger, filters)
      expect(back?.trigger_event).toBe(c.event)
      // The settings the old code reads, re-derived, map to the same atom again.
      const again = atomFromLegacy(back!.trigger_event, { ...filters, ...back!.settings })
      expect(again.trigger).toEqual(trigger)
      expect(again.implied).toEqual(implied)
    })
  }

  it('an atom the old triggers cannot say is saved as "atom"', () => {
    const tenMinutesAfterStart: TriggerAtom = { subject: 'appointment', moment: 'start', timing: { amount: 10, unit: 'minutes', direction: 'after' }, options: {} }
    expect(legacyFromAtom(tenMinutesAfterStart, { appointment_statuses: ['booked'] })).toBeNull()
    expect(ruleColumnsForAtom(tenMinutesAfterStart, { appointment_statuses: ['booked'] }).trigger_event).toBe('atom')
    expect(legacyFromAtom(defaultAtom('patient', 'created'))).toBeNull()
    expect(legacyFromAtom({ ...defaultAtom('lead', 'created'), timing: { amount: 2, unit: 'hours', direction: 'after' } })).toBeNull()
    // A same-day message that is not only for booked visits is no longer the old trigger.
    expect(legacyFromAtom(atomFromLegacy('appointment.same_day', {}).trigger, { appointment_statuses: ['booked', 'completed'] })).toBeNull()
  })

  it('ruleColumnsForAtom keeps only-if filters and writes the old settings beside them', () => {
    const atom = atomFromLegacy('appointment.hours_before', { hours_before: 24 }).trigger
    const cols = ruleColumnsForAtom(atom, { appointment_statuses: ['booked'], reminder_unanswered: true, appointment_type_ids: [TYPE], hours_before: 999 })
    expect(cols.trigger_event).toBe('appointment.hours_before')
    expect(cols.filters).toEqual({ appointment_statuses: ['booked'], reminder_unanswered: true, appointment_type_ids: [TYPE], hours_before: 24, skip_if_answered: true })
  })
})

describe('ruleAtom', () => {
  it('prefers the stored atom and falls back to the old trigger', () => {
    const stored = defaultAtom('waitlist', 'joined')
    expect(ruleAtom({ trigger: stored, trigger_event: 'atom' })).toEqual(stored)
    expect(ruleAtom({ trigger: null, trigger_event: 'invoice.paid' })).toMatchObject({ subject: 'invoice', moment: 'paid' })
  })
})

describe('raised events', () => {
  const SCANNED = ['appointment.hours_before', 'appointment.same_day', 'appointment.review_request', 'appointment.satisfaction', 'invoice.overdue', 'patient.birthday', 'patient.date', 'bono.running_low', 'segment']
  it('every event the app raises names the atom its old rules map to', () => {
    for (const event of LEGACY_EVENTS.filter((e) => !SCANNED.includes(e))) {
      const a = atomOfRaisedEvent(event)
      const mapped = atomFromLegacy(event, {}).trigger
      expect(a, event).toMatchObject({ subject: mapped.subject, moment: mapped.moment })
    }
    expect(atomOfRaisedEvent('referral.visit_completed')).toEqual({ subject: 'appointment', moment: 'completed', sendTo: 'referrer' })
  })
})

describe('timing', () => {
  it('signed minutes', () => {
    expect(timingMinutes({ amount: 24, unit: 'hours', direction: 'before' })).toBe(-1440)
    expect(timingMinutes({ amount: 2, unit: 'days', direction: 'after' })).toBe(2880)
    expect(timingMinutes(null)).toBe(0)
  })

  it('an event held back waits; a date is scanned', () => {
    const held: TriggerAtom = { ...defaultAtom('appointment', 'checked_in'), timing: { amount: 3, unit: 'hours', direction: 'after' } }
    expect(eventDelayMinutes(held)).toBe(180)
    expect(isDateAtom(held)).toBe(false)
    expect(isDateAtom(defaultAtom('appointment', 'start'))).toBe(true)
    expect(isDateAtom(defaultAtom('membership', 'started'))).toBe(false)
    expect(isDateAtom({ ...defaultAtom('membership', 'started'), timing: { amount: 30, unit: 'days', direction: 'after' } })).toBe(true)
  })

  it('only a countdown to a visit is a reminder', () => {
    expect(isUpcomingVisitAtom(atomFromLegacy('appointment.hours_before', {}).trigger)).toBe(true)
    expect(isUpcomingVisitAtom(atomFromLegacy('appointment.review_request', {}).trigger)).toBe(false)
    expect(isUpcomingVisitAtom(defaultAtom('appointment', 'booked'))).toBe(false)
  })

  it('refuses timings a moment does not allow', () => {
    expect(atomProblem({ ...defaultAtom('appointment', 'booked'), timing: { amount: 1, unit: 'hours', direction: 'before' } })).not.toBeNull()
    expect(atomProblem({ ...defaultAtom('appointment', 'end'), timing: { amount: 1, unit: 'hours', direction: 'before' } })).not.toBeNull()
    expect(atomProblem({ ...defaultAtom('patient', 'birthday'), timing: { amount: 3, unit: 'hours', direction: 'after' } })).not.toBeNull()
    expect(atomProblem({ ...defaultAtom('appointment', 'start'), timing: { amount: 1, unit: 'hours', direction: 'before', at: '09:00' } })).not.toBeNull()
    expect(atomProblem({ ...defaultAtom('appointment', 'start'), timing: { amount: 1, unit: 'days', direction: 'before', at: '25:00' } })).not.toBeNull()
    expect(atomProblem({ ...defaultAtom('appointment', 'start'), timing: null })).not.toBeNull()
  })

  it('every moment in the picker has a valid default atom', () => {
    for (const m of TRIGGER_MOMENTS) expect(atomProblem(defaultAtom(m.subject, m.moment)), `${m.subject}.${m.moment}`).toBeNull()
  })
})

describe('filters the atoms added', () => {
  it('visit number: the first, every Nth, or both -- as the satisfaction trigger asked', async () => {
    const { visitNumberMatches } = await import('../../utils/automationTrigger')
    expect(visitNumberMatches({ first: true, every: 10 }, 1)).toBe(true)
    expect(visitNumberMatches({ first: true, every: 10 }, 2)).toBe(false)
    expect(visitNumberMatches({ first: true, every: 10 }, 20)).toBe(true)
    expect(visitNumberMatches({ first: false, every: 10 }, 1)).toBe(false)
    expect(visitNumberMatches({ first: false, every: 0 }, 10)).toBe(false)
    expect(visitNumberMatches({ first: true, every: 0 }, 0)).toBe(false)
  })

  it('age counts whole years, birthday included', async () => {
    const { ageInYears, ageMatches } = await import('../../utils/automationTrigger')
    const on = new Date('2026-11-24T12:00:00Z')
    expect(ageInYears('2010-11-24', on)).toBe(16)
    expect(ageInYears('2010-11-25', on)).toBe(15)
    expect(ageInYears(null, on)).toBeNull()
    expect(ageMatches('2010-11-25', 16, undefined, on)).toBe(false)
    expect(ageMatches('1980-01-01', 18, 65, on)).toBe(true)
    expect(ageMatches(null, undefined, 65, on)).toBe(false)
  })
})
