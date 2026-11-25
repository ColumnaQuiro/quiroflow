import { moveClashes, type MoveClash, type MoveTarget } from '~/utils/moveClash'

// The blocked time a moved visit would land in, asked of the database rather
// than of the calendar's loaded rows: the grid may be showing one
// practitioner's tab, or another week altogether ("Mover…" crosses weeks), so
// what is on screen is not everything that could clash. The rules themselves
// are utils/moveClash -- other visits at the same time are not a clash.
//
// Blocks are the current clinic's, plus the practitioner's own blocks at any
// other clinic: a practitioner working at two clinics is still one person
// (utils/moveClash decides which of those count).
//
// A failed lookup answers "no clash" rather than blocking the move: the check
// is a warning, and the move's own write reports a connection problem anyway.
export function useMoveClashCheck() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()

  async function findMoveClashes(target: MoveTarget): Promise<MoveClash[]> {
    const from = new Date(target.startsAt).toISOString()
    const to = new Date(target.endsAt).toISOString()
    const clinicId = target.clinicId ?? store.currentClinicId
    const where = [clinicId && `clinic_id.eq.${clinicId}`, target.practitionerId && `practitioner_id.eq.${target.practitionerId}`].filter(Boolean).join(',')
    if (!where) return []
    const blocks = await supabase.from('availability_blocks').select('starts_at, ends_at, practitioner_id, room_id, note, clinic_id').or(where).lt('starts_at', to).gt('ends_at', from)
    if (blocks.error) console.error('move clash: blocks lookup failed', blocks.error)
    return moveClashes({ ...target, clinicId }, blocks.data ?? [])
  }

  return { findMoveClashes }
}
