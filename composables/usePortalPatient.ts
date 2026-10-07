// The signed-in patient, resolved once for the whole portal.
//
// Every card used to run its own `patients where user_id = auth.uid()`
// query, so a page with four of them made four identical round trips and
// each one rendered its own loading state at its own moment. The shell
// needs the same row anyway (the sidebar greets them by name), so it is
// resolved here and shared.
//
// Shared through useState, not module-level refs. The portal is server
// rendered, and module state on the server lives for the whole process: a
// request rendered while another patient's row was still in it put THAT
// patient's name and initials into this patient's HTML (the sidebar renders
// them with no loading check). useState is per request on the server and
// shared app-wide in the browser, which is what "resolved once for the
// whole portal" needed. It stays reactive to the signed-in user, so a
// sign-out clears it.
export interface PortalPatient {
  id: string
  first_name: string
  last_name: string | null
}

export function usePortalPatient() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const patient = useState<PortalPatient | null>('portal-patient', () => null)
  const loading = useState('portal-patient-loading', () => true)
  const loadError = useState('portal-patient-error', () => '')
  const loadedFor = useState<string | null>('portal-patient-for', () => null)

  async function load(force = false) {
    const userId = user.value?.sub ?? null
    if (!userId) {
      patient.value = null
      loadedFor.value = null
      loading.value = false
      return
    }
    if (!force && loadedFor.value === userId) return
    // Someone else's row is never shown while this one loads.
    if (loadedFor.value !== userId) patient.value = null
    loading.value = true
    loadError.value = ''
    const { data, error } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) loadError.value = error.message
    patient.value = data
    loadedFor.value = data ? userId : null
    loading.value = false
  }

  watch(user, () => load(), { immediate: true })

  const fullName = computed(() => [patient.value?.first_name, patient.value?.last_name].filter(Boolean).join(' '))
  const initials = computed(() =>
    [patient.value?.first_name?.[0], patient.value?.last_name?.[0]].filter(Boolean).join('').toUpperCase(),
  )

  return { patient, fullName, initials, loading, loadError, reload: () => load(true) }
}
