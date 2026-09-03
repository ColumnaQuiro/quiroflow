// automation_rules.filters narrows a trigger down to a specific audience --
// e.g. "only when the appointment type is Primera visita, and only the
// first time it's ever completed for this patient" -- mirroring the
// audience rules PracticeHub's Connect campaigns used, which the fire
// endpoint and the birthday cron task both need to evaluate the same way
// before running a rule's actions.
export interface AutomationFilters {
  // appointment_type_id (singular) is the legacy shape, still read from rules
  // saved before multi-select existed -- appointment_type_ids (plural) is
  // what the UI writes now. A rule matches if the appointment's type is *any*
  // of these (OR) -- an appointment only ever has one type, so requiring it
  // to match several at once (AND) could never fire.
  appointment_type_id?: string
  appointment_type_ids?: string[]
  total_visits?: number
  no_prior_appointments?: boolean
  has_future_appointment?: boolean
  // Only read by hours-before-cron.post.ts to pick its scan window -- not a
  // patient-targeting filter, so ruleFiltersMatch below never looks at it.
  hours_before?: number
  // Only read by review-request-cron.post.ts to pick its scan window, same
  // reasoning as hours_before -- how many days after a completed appointment
  // the review-request campaign fires.
  days_after?: number
}

export async function ruleFiltersMatch(
  supabase: any,
  patientId: string,
  filters: AutomationFilters | null | undefined,
  appointmentId?: string,
): Promise<boolean> {
  if (!filters || Object.keys(filters).length === 0) return true

  const typeIds = filters.appointment_type_ids?.length ? filters.appointment_type_ids : filters.appointment_type_id ? [filters.appointment_type_id] : null
  if (typeIds) {
    if (!appointmentId) return false
    const { data: appt } = await supabase.from('appointments').select('appointment_type_id').eq('id', appointmentId).maybeSingle()
    if (!appt || !typeIds.includes(appt.appointment_type_id)) return false
  }

  if (filters.total_visits !== undefined && filters.total_visits !== null) {
    let query = supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', patientId).eq('status', 'completed')
    if (typeIds) query = query.in('appointment_type_id', typeIds)
    const { count } = await query
    if ((count ?? 0) !== filters.total_visits) return false
  }

  if (filters.no_prior_appointments) {
    let query = supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', patientId)
    if (appointmentId) query = query.neq('id', appointmentId)
    const { count } = await query
    if ((count ?? 0) > 0) return false
  }

  if (filters.has_future_appointment !== undefined) {
    const { count } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .eq('status', 'booked')
      .gt('starts_at', new Date().toISOString())
    const hasFuture = (count ?? 0) > 0
    if (hasFuture !== filters.has_future_appointment) return false
  }

  return true
}
