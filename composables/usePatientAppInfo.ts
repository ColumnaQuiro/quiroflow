// What this clinic lets its patients do in the app.
//
// Patients have no RLS read on accounts -- it holds the clinic's Stripe
// keys and WhatsApp tokens -- so these flags cannot be selected directly.
// get_patient_booking_info() is the patient-side view of "what may I do
// here" and returns them alongside the bookable clinics/types/practitioners
// it already returned (0162).
//
// Fails closed: if the call errors, every capability reads false, so a
// patient sees a read-only app rather than buttons that will be refused by
// the RPC anyway.
export interface PatientAppSettings {
  bookingEnabled: boolean
  cancelEnabled: boolean
  rescheduleEnabled: boolean
  changeNoticeHours: number
  clinicName: string | null
}

const CLOSED: PatientAppSettings = {
  bookingEnabled: false,
  cancelEnabled: false,
  rescheduleEnabled: false,
  changeNoticeHours: 24,
  clinicName: null,
}

export function usePatientAppInfo() {
  const supabase = useSupabaseClient()
  const settings = ref<PatientAppSettings>({ ...CLOSED })
  const loading = ref(true)

  async function load() {
    loading.value = true
    const { data, error } = await supabase.rpc('get_patient_booking_info')
    if (error || !data) {
      settings.value = { ...CLOSED }
      loading.value = false
      return
    }
    const raw = (data as { settings?: Record<string, unknown> }).settings ?? {}
    settings.value = {
      bookingEnabled: raw.booking_enabled === true,
      cancelEnabled: raw.cancel_enabled === true,
      rescheduleEnabled: raw.reschedule_enabled === true,
      changeNoticeHours: typeof raw.change_notice_hours === 'number' ? raw.change_notice_hours : 24,
      clinicName: typeof raw.clinic_name === 'string' ? raw.clinic_name : null,
    }
    loading.value = false
  }

  onMounted(load)

  return { settings, loading, reload: load }
}
