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
  /** The clinic's public booking page, /book/<slug>, for the web portal. */
  bookingSlug: string | null
}

const CLOSED: PatientAppSettings = {
  bookingEnabled: false,
  cancelEnabled: false,
  rescheduleEnabled: false,
  changeNoticeHours: 24,
  clinicName: null,
  bookingSlug: null,
}

export function usePatientAppInfo() {
  const supabase = useSupabaseClient()
  const settings = ref<PatientAppSettings>({ ...CLOSED })
  const loading = ref(true)
  // Each of the patient's clinics' time zones. A patient cannot read the
  // clinics table itself; get_my_clinic_timezones() carries every one (the
  // booking info only lists clinics taking online bookings), and the visits
  // a patient sees are shown at their clinic's hour, not the phone's.
  const clinicZones = ref<Record<string, string>>({})

  async function load() {
    loading.value = true
    const [{ data, error }, { data: allZones, error: zonesError }] = await Promise.all([
      supabase.rpc('get_patient_booking_info'),
      // Every clinic of the account, not only those taking online bookings --
      // a visit at any of them is shown at its own hour.
      supabase.rpc('get_my_clinic_timezones' as never),
    ])
    const zones: Record<string, string> = {}
    if (!zonesError) for (const z of (allZones as { clinic_id: string; timezone: string }[] | null) ?? []) zones[z.clinic_id] = z.timezone
    if (error || !data) {
      clinicZones.value = zones
      settings.value = { ...CLOSED }
      loading.value = false
      return
    }
    for (const c of (data as { clinics?: { id: string; timezone?: string | null }[] }).clinics ?? []) if (c.timezone && !zones[c.id]) zones[c.id] = c.timezone
    clinicZones.value = zones
    const raw = (data as { settings?: Record<string, unknown> }).settings ?? {}
    settings.value = {
      bookingEnabled: raw.booking_enabled === true,
      cancelEnabled: raw.cancel_enabled === true,
      rescheduleEnabled: raw.reschedule_enabled === true,
      changeNoticeHours: typeof raw.change_notice_hours === 'number' ? raw.change_notice_hours : 24,
      clinicName: typeof raw.clinic_name === 'string' ? raw.clinic_name : null,
      bookingSlug: typeof raw.booking_slug === 'string' ? raw.booking_slug : null,
    }
    loading.value = false
  }

  onMounted(load)

  const zoneOf = (clinicId: string | null | undefined) => (clinicId && clinicZones.value[clinicId]) || DEFAULT_CLINIC_TIMEZONE

  return { settings, loading, reload: load, zoneOf }
}
