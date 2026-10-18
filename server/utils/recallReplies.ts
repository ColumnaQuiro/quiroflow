import { stopPatientRuns } from '~/server/utils/automationEngine'
import { localParts } from '~/utils/automationTiming'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { RECALL_SNOOZE_DAYS, snoozedUntil, type RecallReplyIntent } from '~/utils/recallReply'

// What the WhatsApp webhook does with a patient's "No, gracias" or "Más
// adelante" (utils/recallReply.ts decides which a message is).
//
// The recall templates carry no opt-out sentence: they go out as continuity
// of care (LSSI 21.2, existing patient, same service), which is lawful only
// as long as refusing works. This is where it works. A decline is applied
// before the automations see the reply, so a wait_until on "whatsapp.replied"
// does not carry on down its "met" branch after the person said no.

/** The tag a decline adds, so the patients list and Recalls can filter on it. */
export const DECLINED_TAG = 'baja whatsapp'

export async function applyRecallReply(supabase: any, accountId: string, patientId: string, intent: RecallReplyIntent, text: string): Promise<void> {
  const quoted = text.trim().slice(0, 80)
  if (intent === 'decline') {
    const { data: patient } = await supabase.from('patients').select('tags').eq('id', patientId).maybeSingle()
    const tags: string[] = patient?.tags ?? []
    const nextTags = tags.some((t) => t.toLowerCase() === DECLINED_TAG) ? tags : [...tags, DECLINED_TAG]
    const { error } = await supabase.from('patients').update({ do_not_contact: true, tags: nextTags }).eq('id', patientId)
    if (error) {
      console.error(`[whatsapp] could not mark patient ${patientId} do-not-contact after a decline: ${error.message}`)
      return
    }
    await stopPatientRuns(supabase, accountId, patientId, 'declined', `Replied "${quoted}": do not contact.`)
    await supabase.from('contact_log').insert({
      account_id: accountId,
      patient_id: patientId,
      action: 'other',
      note: `Baja por WhatsApp: respondió «${quoted}». Marcado como «no contactar».`,
    })
    return
  }

  // Snooze: today in the clinic's own zone, plus two months. The Recalls
  // queue reads recall_snoozed_until as a date, and the band filters do not
  // read it at all -- so the recall that asked is ended here too, and
  // reentry_days keeps it from asking again before the snooze is up.
  const { data: clinic } = await supabase.from('clinics').select('timezone').eq('account_id', accountId).is('archived_at', null).order('created_at').limit(1).maybeSingle()
  const today = localParts(new Date(), clinic?.timezone || DEFAULT_CLINIC_TIMEZONE).date
  const until = snoozedUntil(today)
  const { error } = await supabase.from('patients').update({ recall_snoozed_until: until }).eq('id', patientId)
  if (error) {
    console.error(`[whatsapp] could not snooze patient ${patientId} after a "later" reply: ${error.message}`)
    return
  }
  await stopPatientRuns(supabase, accountId, patientId, 'snoozed', `Replied "${quoted}": parked for ${RECALL_SNOOZE_DAYS} days.`, { recallOnly: true })
  await supabase.from('contact_log').insert({
    account_id: accountId,
    patient_id: patientId,
    action: 'other',
    note: `Respondió «${quoted}» por WhatsApp: aparcado en revisiones hasta el ${until}.`,
  })
}
