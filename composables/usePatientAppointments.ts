// A patient's own appointments, plus the two things they may do to one.
//
// Extracted from components/patient/AppointmentsCard.vue when the web
// portal grew its own appointments page: the query, the notice-window rule
// and the cancel call are identical on both, and a second copy of the
// notice rule is exactly the kind of drift that lets a button appear for
// something the RPC will refuse.
//
// Every rule here is a courtesy. cancel_patient_appointment (0162)
// re-checks the clinic's switches and the notice window server-side, so
// hiding a button never *is* the enforcement.
export interface PatientAppointmentRow {
  id: string
  starts_at: string
  ends_at: string
  status: string
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
  clinic_id?: string | null
}

// clinic_id so the screens can show a visit at its clinic's hour
// (usePatientAppInfo().zoneOf), not the phone's.
const SELECT = 'id, clinic_id, starts_at, ends_at, status, appointment_types(name), team_members(full_name)'

export function usePatientAppointments(patientId: () => string, settings: () => PatientAppSettings) {
  const supabase = useSupabaseClient()
  const t = useT()
  const { showToast } = useToast()
  const authedFetch = useAuthedFetch()

  const upcoming = ref<PatientAppointmentRow[]>([])
  const past = ref<PatientAppointmentRow[]>([])
  const loading = ref(true)
  // A failed read keeps what was shown and says so, rather than reading as
  // "no appointments".
  const loadError = ref(false)
  const busyId = ref<string | null>(null)

  async function load() {
    const id = patientId()
    if (!id) return
    loading.value = true
    const nowIso = new Date().toISOString()
    // deleted_at: "Eliminar cita" leaves status 'booked', and the patients'
    // RLS policy does not hide deleted rows, so an appointment the clinic
    // deleted still showed here as upcoming -- with a cancel button the RPC
    // then refused.
    const [{ data: next, error: nextError }, { data: history, error: historyError }] = await Promise.all([
      supabase.from('appointments').select(SELECT).eq('patient_id', id).is('deleted_at', null).gte('starts_at', nowIso).neq('status', 'cancelled').order('starts_at'),
      supabase.from('appointments').select(SELECT).eq('patient_id', id).is('deleted_at', null).lt('starts_at', nowIso).order('starts_at', { ascending: false }).limit(20),
    ])
    loading.value = false
    loadError.value = !!(nextError || historyError)
    if (loadError.value) return
    upcoming.value = (next as unknown as PatientAppointmentRow[]) ?? []
    past.value = (history as unknown as PatientAppointmentRow[]) ?? []
  }

  function withinNotice(appt: PatientAppointmentRow): boolean {
    return new Date(appt.starts_at).getTime() < Date.now() + settings().changeNoticeHours * 3600_000
  }
  function canChange(appt: PatientAppointmentRow): boolean {
    return appt.status === 'booked' && !withinNotice(appt)
  }

  async function cancel(appt: PatientAppointmentRow, whenLabel: string) {
    if (!confirm(t(`Cancel your appointment on ${whenLabel}?`, `¿Cancelar tu cita del ${whenLabel}?`))) return
    busyId.value = appt.id
    // Through the server, which cancels as the patient (the same RPC) and
    // then tells the clinic: the practitioner's push, the clinic's
    // automations and the freed slot offered to the waitlist.
    try {
      await authedFetch('/api/portal/appointments/cancel', { method: 'POST', body: { appointmentId: appt.id } })
    } catch (err: unknown) {
      busyId.value = null
      showToast((err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t('Could not cancel the appointment.', 'No se ha podido cancelar la cita.'), 'error')
      return
    }
    busyId.value = null
    showToast(t('Appointment cancelled.', 'Cita cancelada.'))
    await load()
  }

  watch(patientId, load, { immediate: true })

  return { upcoming, past, loading, loadError, busyId, canChange, cancel, reload: load }
}

export const PATIENT_APPOINTMENT_STATUS: Record<string, [string, string]> = {
  booked: ['Booked', 'Reservada'],
  completed: ['Attended', 'Asistida'],
  cancelled: ['Cancelled', 'Cancelada'],
  no_show: ['Missed', 'No asistida'],
}
