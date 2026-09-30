// What a visit would land on if it were moved -- dragged, resized, "Mover…"
// or "Cambiar". Booking a new visit onto a taken time already needs "allow
// double booking" ticked (NewAppointmentPanel); moving one checked only
// working hours, so a visit dropped onto another patient's slot, or into a
// block, saved without a word. Pure, so the rules are pinned without a
// database: composables/useMoveClashCheck.ts fetches the candidates.
//
// The same rules as the create panel's busyFor(), plus the room: the
// practitioner's other visits, any block for the whole clinic or for that
// practitioner, and -- when the visit has a room -- that room's other visits
// and its own blocks.

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
}

export interface MoveTarget {
  /** The visit being moved: never a clash with itself. */
  appointmentId: string
  practitionerId: string | null
  roomId: string | null
  startsAt: Date | string
  endsAt: Date | string
}

export type MoveClash =
  | { kind: 'appointment'; via: 'practitioner' | 'room'; patientName: string; startsAt: string; endsAt: string }
  | { kind: 'block'; note: string | null; startsAt: string; endsAt: string }

const ms = (d: Date | string) => new Date(d).getTime()
const overlaps = (s: number, e: number, row: { starts_at: string; ends_at: string }) => ms(row.starts_at) < e && ms(row.ends_at) > s

/** Everything the moved visit would overlap, earliest first. */
export function moveClashes(target: MoveTarget, appointments: ClashCandidateAppointment[], blocks: ClashCandidateBlock[]): MoveClash[] {
  const s = ms(target.startsAt)
  const e = ms(target.endsAt)
  const out: MoveClash[] = []
  for (const a of appointments) {
    if (a.id === target.appointmentId || a.status === 'cancelled' || a.deleted_at || !overlaps(s, e, a)) continue
    const via = target.practitionerId && a.practitioner_id === target.practitionerId ? 'practitioner' : target.roomId && a.room_id === target.roomId ? 'room' : null
    if (!via) continue
    const patientName = `${a.patients?.first_name ?? ''} ${a.patients?.last_name ?? ''}`.trim()
    out.push({ kind: 'appointment', via, patientName, startsAt: a.starts_at, endsAt: a.ends_at })
  }
  for (const b of blocks) {
    if (!overlaps(s, e, b)) continue
    const clinicWide = b.practitioner_id === null && b.room_id === null
    const practitioners = !!target.practitionerId && b.practitioner_id === target.practitionerId
    const room = !!target.roomId && b.practitioner_id === null && b.room_id === target.roomId
    if (!clinicWide && !practitioners && !room) continue
    out.push({ kind: 'block', note: b.note?.trim() || null, startsAt: b.starts_at, endsAt: b.ends_at })
  }
  return out.sort((x, y) => ms(x.startsAt) - ms(y.startsAt))
}
