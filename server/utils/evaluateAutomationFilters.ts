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
  // Same OR-across-one-dimension reasoning as appointment_type_ids -- an
  // appointment only has one practitioner.
  practitioner_ids?: string[]
  // Substring match (case-insensitive) against any one of patients.tags --
  // mirrors the same "contains" semantics recalls.vue's own tag filter
  // already uses, since patients.tags holds messy migrated compound values
  // (e.g. "1x10|No contactar") rather than a clean tag taxonomy an exact
  // multi-select could work against.
  tag_contains?: string
  // Mirrors recalls.vue's "Any balance / Owing / In credit" filter exactly --
  // 'debit' means the patient owes money (balance_cents < 0), 'credit' means
  // they're in credit (balance_cents > 0). Reads patients.balance_cents
  // directly rather than recomputing paid/invoiced/credit-ledger sums here.
  balance?: 'debit' | 'credit'
  // true alone means "has any active membership"; paired with membership_ids
  // it means "has an active membership in one of these specific plans".
  membership_active?: boolean
  membership_ids?: string[]
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
  const practitionerIds = filters.practitioner_ids?.length ? filters.practitioner_ids : null
  if (typeIds || practitionerIds) {
    if (!appointmentId) return false
    const { data: appt } = await supabase.from('appointments').select('appointment_type_id, practitioner_id').eq('id', appointmentId).maybeSingle()
    if (!appt) return false
    if (typeIds && !typeIds.includes(appt.appointment_type_id)) return false
    if (practitionerIds && !practitionerIds.includes(appt.practitioner_id)) return false
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

  if (filters.tag_contains || filters.balance) {
    const { data: patient } = await supabase.from('patients').select('tags, balance_cents').eq('id', patientId).maybeSingle()
    if (filters.tag_contains) {
      const needle = filters.tag_contains.toLowerCase()
      const tags: string[] = patient?.tags ?? []
      if (!tags.some((tag) => tag.toLowerCase().includes(needle))) return false
    }
    if (filters.balance) {
      const balanceCents = patient?.balance_cents ?? 0
      if (filters.balance === 'debit' && !(balanceCents < 0)) return false
      if (filters.balance === 'credit' && !(balanceCents > 0)) return false
    }
  }

  if (filters.membership_active || filters.membership_ids?.length) {
    let query = supabase.from('patient_memberships').select('id', { count: 'exact', head: true }).eq('patient_id', patientId).eq('status', 'active')
    if (filters.membership_ids?.length) query = query.in('membership_id', filters.membership_ids)
    const { count } = await query
    if ((count ?? 0) === 0) return false
  }

  return true
}
