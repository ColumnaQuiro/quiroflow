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
}

const SELECT = 'id, starts_at, ends_at, status, appointment_types(name), team_members(full_name)'

export function usePatientAppointments(patientId: () => string, settings: () => PatientAppSettings) {
  const supabase = useSupabaseClient()
  const t = useT()
  const { showToast } = useToast()

  const upcoming = ref<PatientAppointmentRow[]>([])
  const past = ref<PatientAppointmentRow[]>([])
  const loading = ref(true)
  const busyId = ref<string | null>(null)

  async function load() {
    const id = patientId()
    if (!id) return
    loading.value = true
    const nowIso = new Date().toISOString()
    const [{ data: next }, { data: history }] = await Promise.all([
      supabase.from('appointments').select(SELECT).eq('patient_id', id).gte('starts_at', nowIso).neq('status', 'cancelled').order('starts_at'),
      supabase.from('appointments').select(SELECT).eq('patient_id', id).lt('starts_at', nowIso).order('starts_at', { ascending: false }).limit(20),
    ])
    upcoming.value = (next as unknown as PatientAppointmentRow[]) ?? []
    past.value = (history as unknown as PatientAppointmentRow[]) ?? []
    loading.value = false
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
    const { error } = await supabase.rpc('cancel_patient_appointment', { p_appointment_id: appt.id })
    busyId.value = null
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast(t('Appointment cancelled.', 'Cita cancelada.'))
    await load()
  }

  watch(patientId, load, { immediate: true })

  return { upcoming, past, loading, busyId, canChange, cancel, reload: load }
}

export const PATIENT_APPOINTMENT_STATUS: Record<string, [string, string]> = {
  booked: ['Booked', 'Reservada'],
  completed: ['Attended', 'Asistida'],
  cancelled: ['Cancelled', 'Cancelada'],
  no_show: ['Missed', 'No asistida'],
}
