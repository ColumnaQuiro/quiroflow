// "Avísame si queda un hueco antes": the patient's own place on their
// clinic's waitlist. Staff see the entry on their Lista de espera like any
// other, and a cancellation offers the freed slot to it the usual way.
//
// Joining is the clinic's call (join_my_waitlist only accepts it where the
// clinic lets patients book from the app); leaving works while the entry is
// still only waiting -- one already offered a slot is answered through the
// offer.
export interface PatientWaitlistEntry {
  id: string
  clinic_id: string
  status: 'waiting' | 'offered'
  created_at: string
  offered_starts_at: string | null
  offer_expires_at: string | null
}

export function usePatientWaitlist() {
  const supabase = useSupabaseClient()
  const t = useT()
  const entries = ref<PatientWaitlistEntry[]>([])
  const loading = ref(true)
  const busy = ref(false)
  const error = ref('')

  async function load() {
    const { data, error: readError } = await supabase.rpc('get_my_waitlist' as never)
    loading.value = false
    if (readError) return
    entries.value = (data as PatientWaitlistEntry[] | null) ?? []
  }

  async function join(clinicId: string) {
    busy.value = true
    error.value = ''
    const { error: rpcError } = await supabase.rpc('join_my_waitlist' as never, { p_clinic_id: clinicId } as never)
    busy.value = false
    if (rpcError) {
      error.value = t("Couldn't add you to the waitlist. Try again.", 'No se ha podido apuntarte a la lista de espera. Inténtalo de nuevo.')
      return
    }
    await load()
  }

  async function leave(entryId: string) {
    busy.value = true
    error.value = ''
    const { error: rpcError } = await supabase.rpc('leave_my_waitlist' as never, { p_entry_id: entryId } as never)
    busy.value = false
    if (rpcError) {
      error.value = t("Couldn't take you off the waitlist. Try again.", 'No se ha podido quitarte de la lista de espera. Inténtalo de nuevo.')
      return
    }
    await load()
  }

  onMounted(load)
  return { entries, loading, busy, error, join, leave, reload: load }
}
