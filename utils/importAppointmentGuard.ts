// Whether a PracticeHub export row may change a visit that is already here.
//
// The importer was built for a clinic that has not started using QuiroFlow
// yet, when PracticeHub is the only record and a re-run should follow it. Once
// a clinic works in QuiroFlow the two drift apart, and a re-run matched by id
// would drag QuiroFlow's visits back to wherever PracticeHub last had them.
// Columnaquiro moved over around 10 Sep 2026 and stopped updating PracticeHub;
// on 30 Sep a re-run would have moved 16 visits to an older day, among them
// visits completed and invoiced here that PracticeHub still has as booked a
// week earlier (9425: completed 22 Sep here, booked 15 Sep there).
//
// So the rule is not a date but whether QuiroFlow has acted on the visit:
//
// - Moved in QuiroFlow (`rescheduled`). Every calendar, patient-app and API
//   move sets it and the importer never does, so it is proof the time here is
//   QuiroFlow's. All 16 of the 30 Sep cases carried it. Nothing is taken from
//   the row: whoever moved the visit may have changed its practitioner too.
// - An outcome recorded here: checked in, or any status other than booked.
//   The row may still correct its practitioner or type, but not move it or
//   change what happened at it -- that would turn a completed visit back into
//   a booking, or un-cancel one.
//
// A visit QuiroFlow has not touched still follows PracticeHub, which is all
// of the history from before the clinic moved over.
//
// A kept visit is not an error. It is listed in the preview with what
// PracticeHub has, so a real correction can still be made by hand.

export interface AppointmentHere {
  status: string
  rescheduled: boolean
  checkedInAt: string | null
}

export type KeptReason =
  /** Moved in QuiroFlow: its time, and everything else about it, is QuiroFlow's. */
  | 'moved_here'
  /** Checked in, completed, no-show or cancelled here, and the row would move it or change its status. */
  | 'outcome_here'

const OUTCOME_FIELDS = new Set(['starts_at', 'ends_at', 'status'])

/**
 * Why QuiroFlow's version of this visit stands, or null when the row may
 * apply. `changing` is the fields the row would change; with none, there is
 * nothing to keep.
 */
export function quiroflowKeeps(here: AppointmentHere, changing: readonly string[]): KeptReason | null {
  if (changing.length === 0) return null
  if (here.rescheduled) return 'moved_here'
  const outcomeHere = here.checkedInAt !== null || here.status !== 'booked'
  if (outcomeHere && changing.some((f) => OUTCOME_FIELDS.has(f))) return 'outcome_here'
  return null
}
