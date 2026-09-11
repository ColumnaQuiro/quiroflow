// The signed-in patient, resolved once for the whole portal.
//
// Every card used to run its own `patients where user_id = auth.uid()`
// query, so a page with four of them made four identical round trips and
// each one rendered its own loading state at its own moment. The shell
// needs the same row anyway (the sidebar greets them by name), so it is
// resolved here and shared.
//
// Module-level state, like usePractitionerContext: navigating between
// portal pages must not re-query, but it stays reactive to the signed-in
// user so a sign-out clears it.
export interface PortalPatient {
  id: string
  first_name: string
  last_name: string | null
}

const patient = ref<PortalPatient | null>(null)
const loading = ref(true)
const loadError = ref('')
let loadedForUserId: string | null = null

export function usePortalPatient() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  async function load(force = false) {
    const userId = user.value?.sub ?? null
    if (!userId) {
      patient.value = null
      loadedForUserId = null
      loading.value = false
      return
    }
    if (!force && loadedForUserId === userId) return
    loading.value = true
    loadError.value = ''
    const { data, error } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) loadError.value = error.message
    patient.value = data
    loadedForUserId = data ? userId : null
    loading.value = false
  }

  watch(user, () => load(), { immediate: true })

  const fullName = computed(() => [patient.value?.first_name, patient.value?.last_name].filter(Boolean).join(' '))
  const initials = computed(() =>
    [patient.value?.first_name?.[0], patient.value?.last_name?.[0]].filter(Boolean).join('').toUpperCase(),
  )

  return { patient, fullName, initials, loading, loadError, reload: () => load(true) }
}
