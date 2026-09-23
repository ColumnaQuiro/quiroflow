// Where an appointment is in the visit, as ONE value.
//
// The row answers that question across six columns written by four different
// things: `status` by staff, `confirmation_status` by the WhatsApp webhook,
// `source` by whoever booked it, and the three flow timestamps by the front
// desk as the patient moves through the clinic. The calendar used to read a
// different subset in each place -- the block colour from one, the hover pill
// from another, the flow tracker from a third -- so the same appointment could
// read "Confirmed" on the card and "Arrived" in the sidebar at once.
//
// Everything that draws a stage (the block's border and label, the counts
// row, the hover card, the panel's stage track) reads it from here, so they
// cannot disagree. Pure and exported on its own for the same reason as
// utils/visitPayment.ts: the rules are worth pinning without a browser.

export type AppointmentStage =
  | 'pending' // staff booking, confirmation sent, no answer yet
  | 'online' // booked by the patient online, not yet confirmed
  | 'resched' // the patient asked to move it
  | 'confirmed'
  | 'arrived' // checked in, waiting
  | 'withp' // with the practitioner
  | 'checkout' // out of the room, still to pay
  | 'completed'
  | 'noshow'
  | 'cancelled' // not one of the grid's stages: a cancelled visit leaves the grid

export interface StageInput {
  status: string
  confirmation_status: string | null
  source: string | null
  checked_in_at: string | null
  flow_with_practitioner_at: string | null
  flow_checkout_at: string | null
}

export function appointmentStage(a: StageInput): AppointmentStage {
  if (a.status === 'cancelled') return 'cancelled'
  if (a.status === 'completed') return 'completed'
  if (a.status === 'no_show') return 'noshow'

  // Once the patient is in the building, what they said about coming no
  // longer matters: someone who asked to reschedule and then turned up anyway
  // is waiting, not "wants to change". Latest step first, so a skipped step
  // (checkout stamped without a with-practitioner) still lands on the latest.
  if (a.flow_checkout_at) return 'checkout'
  if (a.flow_with_practitioner_at) return 'withp'
  if (a.checked_in_at) return 'arrived'

  if (a.confirmation_status === 'reschedule_requested') return 'resched'
  if (a.confirmation_status === 'confirmed') return 'confirmed'

  // An online booking was made by the patient with nobody at the clinic
  // looking at it, so it stays "not firm" until it is confirmed -- whether or
  // not a confirmation message has gone out yet.
  if (a.source === 'online') return 'online'
  if (a.confirmation_status === 'pending') return 'pending'

  // null: no confirmation was ever requested. A staff booking made with the
  // patient on the phone or at the desk is as firm as it gets, and calling it
  // "unconfirmed" would dash the border of every visit at a clinic that has
  // confirmations switched off.
  return 'confirmed'
}

/** Not firm yet: drawn with a dashed border. */
export function isUnconfirmedStage(stage: AppointmentStage): boolean {
  return stage === 'pending' || stage === 'online' || stage === 'resched'
}

/** The patient is in the building, which is what locks "No vino". */
export function hasArrived(stage: AppointmentStage): boolean {
  return stage === 'arrived' || stage === 'withp' || stage === 'checkout' || stage === 'completed'
}

/**
 * Whether to flag "Sin próxima" on a block. Only at the moment someone can do
 * something about it -- while the patient is in the room or at the desk, or
 * later the same day -- because a visit next week with nothing after it is
 * not yet anyone's problem, and a flag on every such block is noise.
 */
export function needsNextBookingFlag(stage: AppointmentStage, startsAt: string | Date, hasFutureAppointment: boolean, now: Date = new Date()): boolean {
  if (hasFutureAppointment) return false
  if (stage === 'withp' || stage === 'checkout') return true
  if (stage !== 'completed') return false
  const d = typeof startsAt === 'string' ? new Date(startsAt) : startsAt
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

/** The flow, in order, as the panel's stage track draws it. */
export const STAGE_TRACK = ['confirmed', 'arrived', 'withp', 'checkout', 'completed'] as const
export type TrackStep = (typeof STAGE_TRACK)[number]

/** How far along the track a stage is; -1 before the patient has confirmed. */
export function trackIndex(stage: AppointmentStage): number {
  return (STAGE_TRACK as readonly string[]).indexOf(stage)
}

/**
 * The one step forward from here, as the panel's primary button offers it.
 * null when there is nothing left to advance (done, cancelled, no-show).
 * `cobrar` is not a flow step of its own: from checkout, the next thing to
 * do is take the money, and taking it is what completes the visit.
 */
export type NextStep = 'checkin' | 'withp' | 'checkout' | 'charge'
export function nextStep(stage: AppointmentStage): NextStep | null {
  switch (stage) {
    case 'pending':
    case 'online':
    case 'resched':
    case 'confirmed':
      return 'checkin'
    case 'arrived':
      return 'withp'
    case 'withp':
      return 'checkout'
    case 'checkout':
      return 'charge'
    default:
      return null
  }
}

/** The counts row's toggles. `owes` is money, not a stage, but filters the same way. */
export type StageFilter = 'pending' | 'resched' | 'arrived' | 'withp' | 'checkout' | 'owes'
export const STAGE_FILTERS: StageFilter[] = ['pending', 'resched', 'arrived', 'withp', 'checkout', 'owes']

export function matchesFilter(filter: StageFilter, stage: AppointmentStage, owesCents: number): boolean {
  switch (filter) {
    case 'pending':
      // Online bookings are "sin confirmar" too; the chip is about who still
      // has to be chased, and the source does not change the chasing.
      return stage === 'pending' || stage === 'online'
    case 'owes':
      return owesCents > 0
    default:
      return stage === filter
  }
}

export interface CountsInput {
  stage: AppointmentStage
  patientId: string
  owesCents: number
}

/**
 * Per-filter counts plus the money line. Debt is the patient's, not the
 * visit's, so two visits by one patient on the same day count that patient
 * once and add their balance once -- otherwise "4 deben · 180 €" would
 * double a debt just because someone came twice.
 */
export function stageCounts(rows: CountsInput[]): { total: number; counts: Record<StageFilter, number>; owedCents: number } {
  const counts = Object.fromEntries(STAGE_FILTERS.map((f) => [f, 0])) as Record<StageFilter, number>
  const debtors = new Map<string, number>()
  let total = 0
  for (const r of rows) {
    if (r.stage === 'cancelled') continue
    total++
    for (const f of STAGE_FILTERS) {
      if (f !== 'owes' && matchesFilter(f, r.stage, r.owesCents)) counts[f]++
    }
    if (r.owesCents > 0) debtors.set(r.patientId, r.owesCents)
  }
  counts.owes = debtors.size
  let owedCents = 0
  for (const cents of debtors.values()) owedCents += cents
  return { total, counts, owedCents }
}
