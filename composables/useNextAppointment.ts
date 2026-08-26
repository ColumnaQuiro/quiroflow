// Shared by the on-screen invoice and (server-side, via its own inline
// query using the same shape) the PDF, so "Your next visit" can't drift
// between the two -- matches PracticeHub's own invoice, which prints the
// same line.
export function useNextAppointment(patientId: MaybeRefOrGetter<string>) {
  const supabase = useSupabaseClient()
  const nextAppointmentDate = ref<string | null>(null)
  const loading = ref(true)

  async function load() {
    const id = toValue(patientId)
    if (!id) {
      nextAppointmentDate.value = null
      loading.value = false
      return
    }
    loading.value = true
    const { data } = await supabase
      .from('appointments')
      .select('starts_at')
      .eq('patient_id', id)
      .neq('status', 'cancelled')
      .gt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    nextAppointmentDate.value = data?.starts_at ?? null
    loading.value = false
  }

  onMounted(load)
  watch(() => toValue(patientId), load)

  return { nextAppointmentDate, loading, refresh: load }
}
