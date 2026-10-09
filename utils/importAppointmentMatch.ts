import { clinicDateOf, DEFAULT_CLINIC_TIMEZONE } from './clinicClock'

// Which appointment here a row of PracticeHub's appointments export is.
//
// PracticeHub's own appointment id is tried first, and for almost every row it
// is the whole answer. It fails when staff delete an appointment in
// PracticeHub and re-create it to check the patient out, which Columnaquiro
// did while dual-running: the re-created appointment has a NEW id, and the
// visit it describes is already here -- imported under the old id (one
// patient's 9 Sep visit is 9851 here, 9876 in PracticeHub now), or
// entered in QuiroFlow and never carrying an id at all. PracticeHub
// 9865-9889 are one such batch. Matched by id alone, every one of them would
// be inserted as a second visit beside the first.
//
// So a row whose id is not here is matched to the patient's visit on the same
// day at the same clinic -- but only a visit that no longer answers to a live
// PracticeHub id: one with no id, or one whose id is absent from the export.
// A visit whose id IS in the export is PracticeHub's own record of a different
// appointment and is never taken.
//
// Time is a tie-break, not a gate. The re-created appointments were keyed in
// a day later and land 15 to 90 minutes from the visit they replace, so
// "overlapping" alone would have missed most of them.
//
// Anything less certain than one visit for one row is held back: the row is
// neither inserted nor matched, and the preview names it. A wrong match
// overwrites a real visit; a held row only waits for a person.

export interface IncomingAppointment {
  /** The row's position in the file; results are keyed by it. */
  key: number
  /** PracticeHub's appointment id. */
  ref: string | null
  patientId: string | null
  startsAt: string
  endsAt: string
  /** Already mapped to QuiroFlow's statuses. */
  status: string
}

export interface ExistingAppointment {
  id: string
  patientId: string
  clinicId: string | null
  externalReference: string | null
  startsAt: string
  endsAt: string
  status: string
}

export type HeldReason =
  /** Several visits that day could be the one, and time does not single one out. */
  | 'several'
  /** Another row in the file reaches for the same visit. */
  | 'contested'
  /**
   * The visit here that day carries a PracticeHub id that PracticeHub now has
   * on another day (or for another patient) while a new id describes this
   * day. Following the id would move a visit that happened into the future;
   * inserting the new one would leave the day doubled. Both rows wait.
   */
  | 'moved_away'

export type AppointmentMatch =
  | { kind: 'ref'; existingId: string }
  | { kind: 'adopt'; existingId: string; replacesRef: string | null }
  | { kind: 'insert' }
  | { kind: 'held'; reason: HeldReason; existingIds: string[] }

const isCancelled = (status: string) => status === 'cancelled'

function overlaps(a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) {
  return new Date(a.startsAt).getTime() < new Date(b.endsAt).getTime() && new Date(b.startsAt).getTime() < new Date(a.endsAt).getTime()
}

/**
 * A match for every incoming row. Rows with neither a matching id nor a
 * patient come back as `insert`; the caller cannot insert them and skips
 * them as it always has.
 *
 * `refsInFile` is every PracticeHub id in the export, including rows the
 * caller could not use: a row with a bad date still proves its id is live.
 */
export function matchIncomingAppointments(
  incoming: IncomingAppointment[],
  existing: ExistingAppointment[],
  refsInFile: Set<string>,
  clinicId: string,
  timeZone: string | null | undefined = DEFAULT_CLINIC_TIMEZONE,
): Map<number, AppointmentMatch> {
  const tz = timeZone || DEFAULT_CLINIC_TIMEZONE
  const dateOf = (at: string) => clinicDateOf(new Date(at), tz)
  const result = new Map<number, AppointmentMatch>()

  const byRef = new Map<string, ExistingAppointment>()
  for (const a of existing) if (a.externalReference) byRef.set(a.externalReference, a)

  // PracticeHub's own id first, for every row, so a date match can never take
  // a visit that some row names outright.
  const claimedByRef = new Map<string, IncomingAppointment>()
  const unmatched: IncomingAppointment[] = []
  for (const row of incoming) {
    const direct = row.ref ? byRef.get(row.ref) : undefined
    if (direct) {
      result.set(row.key, { kind: 'ref', existingId: direct.id })
      claimedByRef.set(direct.id, row)
    } else {
      unmatched.push(row)
    }
  }

  // An id missing from the export means deleted only for a day the export
  // covers; a file cut to a date range says nothing about the days outside it.
  let firstDay: string | null = null
  let lastDay: string | null = null
  for (const row of incoming) {
    const day = dateOf(row.startsAt)
    if (!firstDay || day < firstDay) firstDay = day
    if (!lastDay || day > lastDay) lastDay = day
  }
  const answersToNoLiveId = (a: ExistingAppointment) => {
    if (!a.externalReference) return true
    if (refsInFile.has(a.externalReference)) return false
    const day = dateOf(a.startsAt)
    return firstDay !== null && lastDay !== null && day >= firstDay && day <= lastDay
  }

  const sameDayByPatient = new Map<string, ExistingAppointment[]>()
  for (const a of existing) {
    if (a.clinicId !== clinicId) continue
    const k = `${a.patientId}|${dateOf(a.startsAt)}`
    const list = sameDayByPatient.get(k) ?? []
    list.push(a)
    sameDayByPatient.set(k, list)
  }

  const claims = new Map<string, number[]>()
  const heldRefRows = new Map<number, string>()
  for (const row of unmatched) {
    if (!row.patientId) {
      result.set(row.key, { kind: 'insert' })
      continue
    }
    const day = dateOf(row.startsAt)
    // A cancellation is only ever the same appointment as another
    // cancellation: letting it take a completed visit would cancel the visit.
    const sameDay = (sameDayByPatient.get(`${row.patientId}|${day}`) ?? []).filter((a) => isCancelled(a.status) === isCancelled(row.status))

    const movedAway = sameDay.filter((a) => {
      const claimant = claimedByRef.get(a.id)
      if (!claimant) return false
      return dateOf(claimant.startsAt) !== day || (claimant.patientId !== null && claimant.patientId !== a.patientId)
    })
    if (movedAway.length > 0) {
      result.set(row.key, { kind: 'held', reason: 'moved_away', existingIds: movedAway.map((a) => a.id) })
      for (const a of movedAway) heldRefRows.set(claimedByRef.get(a.id)!.key, a.id)
      continue
    }

    const free = sameDay.filter((a) => !claimedByRef.has(a.id) && answersToNoLiveId(a))
    if (free.length === 0) {
      result.set(row.key, { kind: 'insert' })
      continue
    }
    const pick = free.length === 1 ? free : free.filter((a) => overlaps(a, row))
    if (pick.length !== 1) {
      result.set(row.key, { kind: 'held', reason: 'several', existingIds: free.map((a) => a.id) })
      continue
    }
    const claimants = claims.get(pick[0]!.id) ?? []
    claimants.push(row.key)
    claims.set(pick[0]!.id, claimants)
  }

  const existingById = new Map(existing.map((a) => [a.id, a]))
  for (const [existingId, keys] of claims) {
    for (const key of keys) {
      result.set(
        key,
        keys.length === 1
          ? { kind: 'adopt', existingId, replacesRef: existingById.get(existingId)!.externalReference }
          : { kind: 'held', reason: 'contested', existingIds: [existingId] },
      )
    }
  }

  // The id-matched row on the other side of a moved_away is held with it, so
  // the visit stays where it is until someone has looked.
  for (const [key, existingId] of heldRefRows) {
    result.set(key, { kind: 'held', reason: 'moved_away', existingIds: [existingId] })
  }
  return result
}
