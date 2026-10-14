import { randomUUID } from 'node:crypto'

// The patient's side of a satisfaction survey (satisfaction_surveys), shared
// by GET and POST /api/satisfaction/<token>. No session: the token is the
// key, read on the service role, the way review and waitlist links work.

export interface SurveyRow {
  id: string
  account_id: string
  appointment_id: string
  rule_id: string | null
  score: number | null
  comment: string | null
  answered_at: string | null
  review_offered_at: string | null
  appointments: { patient_id: string | null; starts_at: string; clinics: { name: string } | null; patients: { first_name: string | null; last_name: string | null } | null } | null
}

/** How long after answering the patient can still change the score or add a comment. */
export const SURVEY_EDIT_HOURS = 24

export async function surveyByToken(supabase: any, token: string): Promise<SurveyRow | null> {
  const { data } = await supabase
    .from('satisfaction_surveys')
    .select('id, account_id, appointment_id, rule_id, score, comment, answered_at, review_offered_at, appointments(patient_id, starts_at, clinics(name), patients(first_name, last_name))')
    .eq('token', token)
    .maybeSingle()
  return (data as SurveyRow | null) ?? null
}

export function surveyLocked(row: SurveyRow, now = Date.now()) {
  return !!row.answered_at && now - Date.parse(row.answered_at) > SURVEY_EDIT_HOURS * 3_600_000
}

/**
 * The clinic's Google review page, through a tracked review_requests link
 * (/api/r/<token>) so Reputation's funnel counts it like any other review
 * request. One per survey: a second visit to the page reuses it.
 */
export async function reviewLinkFor(supabase: any, row: SurveyRow, origin: string): Promise<string | null> {
  const { data: account } = await supabase.from('accounts').select('google_review_url').eq('id', row.account_id).maybeSingle()
  if (!account?.google_review_url) return null
  const patientId = row.appointments?.patient_id
  if (!patientId) return account.google_review_url
  const { data: existing } = await supabase.from('review_requests').select('token').eq('appointment_id', row.appointment_id).eq('patient_id', patientId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existing?.token) return `${origin}/api/r/${existing.token}`
  const token = randomUUID().replace(/-/g, '')
  const { error } = await supabase.from('review_requests').insert({ account_id: row.account_id, patient_id: patientId, appointment_id: row.appointment_id, token })
  return error ? account.google_review_url : `${origin}/api/r/${token}`
}

/**
 * A low score, told to the clinic's owners the same day: a task each, on
 * their My Day, linked to the patient. Private -- nothing about it is public
 * or goes back to the patient.
 */
export async function alertOwners(supabase: any, row: SurveyRow, score: number) {
  const { data: owners } = await supabase.from('team_members').select('id').eq('account_id', row.account_id).eq('is_owner', true).is('deleted_at', null)
  if (!owners?.length) return
  const p = row.appointments?.patients
  const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Un paciente'
  const title = `Valoración ${score}/5 de ${name}: ver en Reputación`
  await supabase.from('staff_tasks').insert(
    owners.map((o: { id: string }) => ({ account_id: row.account_id, team_member_id: o.id, patient_id: row.appointments?.patient_id ?? null, title, rule_id: row.rule_id })),
  )
}
