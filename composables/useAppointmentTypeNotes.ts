// The team's notes on appointment types (appointment_type_staff_notes), by
// type id. Read once per account and shared: the calendar, the booking sheet
// and the visit panel all want them, and a clinic has a handful at most.
export function useAppointmentTypeNotes() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const notes = useState<Record<string, string>>('appointment-type-notes', () => ({}))
  const loadedFor = useState<string | null>('appointment-type-notes-account', () => null)

  async function load(force = false) {
    const accountId = store.accountId
    if (!accountId || (!force && loadedFor.value === accountId)) return
    loadedFor.value = accountId
    const { data } = await supabase.from('appointment_type_staff_notes').select('id, note').eq('account_id', accountId)
    notes.value = Object.fromEntries((data ?? []).map((r) => [r.id, r.note]))
  }

  function noteFor(typeId: string | null | undefined): string | null {
    return (typeId && notes.value[typeId]) || null
  }

  return { notes, load, noteFor }
}
