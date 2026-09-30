import { moveClashes, type ClashCandidateAppointment, type MoveClash, type MoveTarget } from '~/utils/moveClash'

// What a moved visit would land on, asked of the database rather than of the
// calendar's loaded rows: the grid may be showing one practitioner's tab, or
// another week altogether ("Mover…" crosses weeks), so what is on screen is
// not everything that could clash. The rules themselves are utils/moveClash.
//
// Appointments are matched by practitioner or room across the account, not
// the clinic: a practitioner working at two clinics is still one person.
// Blocks are the current clinic's, as the calendar and the create panel read
// them.
//
// A failed lookup answers "no clash" rather than blocking the move: the check
// is a warning, and the move's own write reports a connection problem anyway.
export function useMoveClashCheck() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()

  async function findMoveClashes(target: MoveTarget): Promise<MoveClash[]> {
    const from = new Date(target.startsAt).toISOString()
    const to = new Date(target.endsAt).toISOString()
    const who = [target.practitionerId && `practitioner_id.eq.${target.practitionerId}`, target.roomId && `room_id.eq.${target.roomId}`].filter(Boolean).join(',')
    const [appts, blocks] = await Promise.all([
      who
        ? supabase
            .from('appointments')
            .select('id, starts_at, ends_at, practitioner_id, room_id, status, deleted_at, patients(first_name, last_name)')
            .neq('id', target.appointmentId)
            .neq('status', 'cancelled')
            .is('deleted_at', null)
            .lt('starts_at', to)
            .gt('ends_at', from)
            .or(who)
        : Promise.resolve({ data: [], error: null }),
      store.currentClinicId
        ? supabase.from('availability_blocks').select('starts_at, ends_at, practitioner_id, room_id, note').eq('clinic_id', store.currentClinicId).lt('starts_at', to).gt('ends_at', from)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (appts.error) console.error('move clash: appointments lookup failed', appts.error)
    if (blocks.error) console.error('move clash: blocks lookup failed', blocks.error)
    return moveClashes(target, (appts.data as unknown as ClashCandidateAppointment[] | null) ?? [], blocks.data ?? [])
  }

  return { findMoveClashes }
}
