import { isDateAtom, type TriggerAtom } from '~/utils/automationTrigger'

// Switching an automation on "for those who already meet it too": a one-off
// pass that enrols everyone the automation WOULD have taken in had it been on
// for the last few days, on top of the usual "from now on"
// (server/utils/automationBackfill.ts does it).
//
// Only where "already meets it" has a clear answer in the records: an
// appointment missed, cancelled or completed; a row the atoms add (a patient,
// a bono, an invoice, a form sent, a care plan, a waitlist entry); a form
// completed; and "has not been back since a visit". Never a reminder counting
// down to a date (a message about a visit that has passed), a birthday that
// has gone, or a lead (whose drip is about the moment they arrived).
//
// Pure data and helpers: the activation dialog and the server read the same.

/** How far back the pass can look, in days. A short window by default: an old no-show is not news. */
export const BACKFILL_DAY_OPTIONS = [7, 30, 90] as const
export const BACKFILL_DEFAULT_DAYS = 30
/** The most patients one pass enrols: the most recent first. */
export const BACKFILL_MAX_PATIENTS = 500

export type BackfillKind = 'appointment' | 'created' | 'doc' | 'last_visit'

/** The appointment moments that are a status the visit keeps. */
export const BACKFILL_APPOINTMENT_MOMENTS = ['no_show', 'cancelled', 'completed'] as const

/** The rows the atoms add, as "is added / is bought / is issued..." (server/utils/automationAtomRules.ts CREATED_MOMENTS). */
export const BACKFILL_CREATED_MOMENTS: readonly string[] = ['patient.created', 'care_plan.created', 'bono.bought', 'form.sent', 'waitlist.joined', 'invoice.issued']

/** How a pass finds who already meets this trigger, or null when it cannot be done after the fact. */
export function backfillKindOf(atom: TriggerAtom | null | undefined): BackfillKind | null {
  if (!atom || atom.send_to === 'referrer') return null
  if (atom.subject === 'patient' && atom.moment === 'last_visit') {
    return atom.timing?.unit === 'days' && atom.timing.direction === 'after' ? 'last_visit' : null
  }
  // Every other date ("24 h before it starts", a birthday, a start date) is
  // a moment on the calendar: passed, it is gone.
  if (isDateAtom(atom)) return null
  if (atom.subject === 'appointment' && (BACKFILL_APPOINTMENT_MOMENTS as readonly string[]).includes(atom.moment)) return 'appointment'
  if (atom.subject === 'form' && atom.moment === 'completed') return 'doc'
  if (BACKFILL_CREATED_MOMENTS.includes(`${atom.subject}.${atom.moment}`)) return 'created'
  return null
}

export const canBackfill = (atom: TriggerAtom | null | undefined) => backfillKindOf(atom) !== null

/** A requested window, made one of the offered ones. */
export function backfillDays(value: unknown): number {
  const n = Number(value)
  return (BACKFILL_DAY_OPTIONS as readonly number[]).includes(n) ? n : BACKFILL_DEFAULT_DAYS
}
