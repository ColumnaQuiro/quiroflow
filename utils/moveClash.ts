// What a visit would land on if it were moved -- dragged, resized, "Mover…"
// or "Cambiar" -- before it is saved. Pure, so the rules are pinned without a
// database: composables/useMoveClashCheck.ts fetches the candidates.
//
// Only BLOCKED time counts: any block for the whole clinic or for that
// practitioner, and -- when the visit has a room -- that room's own blocks.
// Another patient at the same time does not. Most clinics see several
// patients an hour with one practitioner, so asking "that time is taken" on
// every move to a busy hour only taught the desk to click past it. The create
// panel (NewAppointmentPanel) follows the same rule.
//
// The practitioner's own blocks count at EVERY clinic: somebody who works at
// two is one person, and a morning blocked off at the other one keeps them
// away from this one too. A block for the whole of another clinic, or for one
// of its rooms, is that clinic's business and never counts here.

export interface ClashCandidateAppointment {
  id: string
  starts_at: string
  ends_at: string
  practitioner_id: string | null
  room_id: string | null
  status?: string | null
  deleted_at?: string | null
  patients: { first_name: string; last_name: string | null } | null
}

export interface ClashCandidateBlock {
  starts_at: string
  ends_at: string
  practitioner_id: string | null
  room_id: string | null
  note?: string | null
  /** Where the block is. Left out, it is taken to be at the visit's clinic. */
  clinic_id?: string | null
}

export interface MoveTarget {
  /** The visit being moved: never a clash with itself. */
  appointmentId: string
  practitionerId: string | null
  roomId: string | null
  /** The visit's clinic: only the practitioner's own blocks count anywhere else. */
  clinicId?: string | null
  startsAt: Date | string
  endsAt: Date | string
}

export interface MoveClash {
  kind: 'block'
  note: string | null
  startsAt: string
  endsAt: string
}

const ms = (d: Date | string) => new Date(d).getTime()
const overlaps = (s: number, e: number, row: { starts_at: string; ends_at: string }) => ms(row.starts_at) < e && ms(row.ends_at) > s

/** Every block the moved visit would land in, earliest first. */
export function moveClashes(target: MoveTarget, blocks: ClashCandidateBlock[]): MoveClash[] {
  const s = ms(target.startsAt)
  const e = ms(target.endsAt)
  const out: MoveClash[] = []
  for (const b of blocks) {
    if (!overlaps(s, e, b)) continue
    const elsewhere = !!b.clinic_id && !!target.clinicId && b.clinic_id !== target.clinicId
    const clinicWide = b.practitioner_id === null && b.room_id === null
    const practitioners = !!target.practitionerId && b.practitioner_id === target.practitionerId
    const room = !!target.roomId && b.practitioner_id === null && b.room_id === target.roomId
    if (elsewhere ? !practitioners : !clinicWide && !practitioners && !room) continue
    out.push({ kind: 'block', note: b.note?.trim() || null, startsAt: b.starts_at, endsAt: b.ends_at })
  }
  return out.sort((x, y) => ms(x.startsAt) - ms(y.startsAt))
}

/**
 * The other way round: the visits a new or edited block would land on
 * ("Bloquear horario"), so the desk is told before it saves rather than
 * finding them later inside the grey. The same reach as above: a block that
 * names a practitioner catches their visits at every clinic; one that names
 * nobody catches its clinic -- only that room's visits when it has a room,
 * all of them when it does not. Cancelled, no-show and deleted visits are not
 * in the way. Earliest first.
 */
export function appointmentsUnderBlock<A extends ClashCandidateAppointment & { clinic_id?: string | null }>(
  block: { practitionerId: string | null; roomId: string | null; clinicId: string | null; startsAt: Date | string; endsAt: Date | string },
  appointments: A[],
): A[] {
  const s = ms(block.startsAt)
  const e = ms(block.endsAt)
  return appointments
    .filter((a) => {
      if (a.status === 'cancelled' || a.status === 'no_show' || a.deleted_at || !overlaps(s, e, a)) return false
      if (block.practitionerId) return a.practitioner_id === block.practitionerId
      if (block.clinicId && a.clinic_id && a.clinic_id !== block.clinicId) return false
      return !block.roomId || a.room_id === block.roomId
    })
    .sort((x, y) => ms(x.starts_at) - ms(y.starts_at))
}
