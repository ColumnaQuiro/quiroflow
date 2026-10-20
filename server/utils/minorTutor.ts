/**
 * Who hears about a minor's appointments: their tutor.
 *
 * A minor is never messaged themselves, and for a long time that was the whole
 * rule -- so nobody heard anything, not even the parent whose own patient
 * record `patients.tutor_patient_id` already named. The automatic messages
 * about a minor's care (confirmation and reminder, and the automations that
 * are not marketing) now go to that record instead: its phone, its email, its
 * language, and its own do-not-contact flag.
 *
 * Null when there is nobody to tell -- no tutor named, a tutor in another
 * clinic or since deleted, a tutor who is a minor too, or one marked
 * do-not-contact. The caller then sends nothing, as it always did for a minor.
 *
 * Marketing stays off for minors whoever would receive it, and recalls never
 * enrol them (automationEngine.ts, segmentAudience.ts); this only answers
 * "where does a message about this child go".
 */
export interface MinorTutor {
  id: string
  firstName: string
  email: string | null
  preferredLanguage: string | null
}

export async function contactableTutor(supabase: any, minorPatientId: string): Promise<MinorTutor | null> {
  const { data: minor } = await supabase.from('patients').select('account_id, tutor_patient_id').eq('id', minorPatientId).maybeSingle()
  if (!minor?.tutor_patient_id) return null
  const { data: tutor } = await supabase
    .from('patients')
    .select('id, account_id, first_name, email, preferred_language, is_minor, do_not_contact')
    .eq('id', minor.tutor_patient_id)
    .maybeSingle()
  if (!tutor || tutor.account_id !== minor.account_id || tutor.is_minor || tutor.do_not_contact) return null
  return { id: tutor.id, firstName: tutor.first_name ?? '', email: tutor.email ?? null, preferredLanguage: tutor.preferred_language ?? null }
}

/**
 * The line an email to a tutor opens with. The body is the clinic's own text,
 * written for the patient, and nothing makes it name them -- so without this
 * a parent could receive "your appointment is tomorrow" and not know whose.
 * Already HTML-escaped.
 */
export function tutorEmailNote(minorFirstName: string, language: string | null): string {
  const name = minorFirstName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const text = language?.startsWith('en')
    ? `You are receiving this message as the guardian of <strong>${name}</strong>.`
    : `Recibes este mensaje como tutor/a de <strong>${name}</strong>.`
  return `<p style="margin:0 0 16px;padding:10px 14px;background:#F4F4F6;border-radius:8px;font-size:13px;color:#4A4A57;">${text}</p>`
}
