// The patient's clinics with what the app needs to get them there and in
// touch: name, address, phone. Patients cannot read the clinics table, so
// this is get_my_clinics(), the caller's own accounts' open clinics.
//
// Loaded once per app run and shared; a failed read leaves the list empty,
// which hides "Cómo llegar" and "Llamar" rather than offering broken ones.
export interface PatientClinic {
  id: string
  name: string
  address: string | null
  phone: string | null
  timezone: string | null
}

export function usePatientClinics() {
  const supabase = useSupabaseClient()
  const clinics = useState<PatientClinic[]>('patient-clinics', () => [])
  const loaded = useState('patient-clinics-loaded', () => false)

  async function load() {
    const { data, error } = await supabase.rpc('get_my_clinics' as never)
    if (error) return
    clinics.value = (data as PatientClinic[] | null) ?? []
    loaded.value = true
  }
  if (!loaded.value && import.meta.client) load()

  /** The visit's clinic; with only one, that one whatever the visit says. */
  function clinicOf(id: string | null | undefined): PatientClinic | null {
    return clinics.value.find((c) => c.id === id) ?? (clinics.value.length === 1 ? clinics.value[0]! : null)
  }

  return { clinics, clinicOf, reload: load }
}
