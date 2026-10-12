import type { H3Event } from 'h3'
import { sendInboxMessage } from '~/server/utils/inboxSend'
import { notifyInboxTeamMembers, sendPushToPatients } from '~/server/utils/pushNotifications'

// The AI receptionist sending a reply on its own, and passing a conversation
// to a person -- what receptionist-draft-cron does instead of leaving a draft
// when the clinic's hours switches say so (utils/receptionistAutoReply.ts).
//
// A WhatsApp reply goes through sendInboxMessage, the Inbox composer's own
// send, so it is held to everything a person's reply is: the 24-hour window,
// "do not contact", the number they last wrote from, the message row on the
// right thread. Only the row says sent_by_ai. An app reply is the
// patient_app_messages row plus the push to their phone that
// /api/patient-messages/send gives a person's reply.

export type ReceptionistTarget =
  | { kind: 'lead'; leadId: string }
  | { kind: 'patient'; patientId: string; channel: 'whatsapp' | 'app' }

/** Sends `text` as the receptionist. Throws when it cannot be sent (e.g. outside WhatsApp's window). */
export async function sendAsReceptionist(event: H3Event, service: any, accountId: string, target: ReceptionistTarget, text: string) {
  if (target.kind === 'patient' && target.channel === 'app') {
    const { error } = await service
      .from('patient_app_messages')
      .insert({ account_id: accountId, patient_id: target.patientId, direction: 'outbound', body: text.slice(0, 4000), sent_by_ai: true })
    if (error) throw new Error(`could not store the app reply: ${error.message}`)
    const { data: account } = await service.from('accounts').select('name').eq('id', accountId).maybeSingle()
    await sendPushToPatients(service, accountId, [target.patientId], { title: account?.name ?? 'Your clinic', body: text, data: { type: 'patient_app_message' } })
    return
  }
  // sendInboxMessage reads only the sender's account; the receptionist has no
  // team member of its own.
  const sender = { supabase: service, teamMember: { account_id: accountId } } as unknown as Parameters<typeof sendInboxMessage>[1]
  await sendInboxMessage(event, sender, target.kind === 'lead' ? { leadId: target.leadId, text, sentByAi: true } : { patientId: target.patientId, text, sentByAi: true })
}

/** The Inbox's key for the conversation: a patient's id, or lead:<id>. */
export function conversationKeyFor(target: ReceptionistTarget): string {
  return target.kind === 'lead' ? `lead:${target.leadId}` : target.patientId
}

/**
 * The receptionist passed this conversation to a person: an internal note in
 * the thread saying why (seen by the team, never sent), and a push to whoever
 * the Inbox notifies about it. The caller records the state that keeps the
 * receptionist quiet there (a lead's ai_state, a patient's handed_over_at).
 */
export async function announceHandover(service: any, accountId: string, target: ReceptionistTarget, personName: string, reason: string) {
  // Shown as an internal note by "Recepcionista IA" (NoteBubble.vue: no author).
  const body = `He pasado esta conversación a una persona. Motivo: ${reason}`.slice(0, 2000)
  const { error } = await service.from('inbox_notes').insert({ account_id: accountId, conversation_key: conversationKeyFor(target), author_id: null, body, mentions: [] })
  if (error) console.error('[receptionist] could not leave the handover note:', error.message)
  await notifyInboxTeamMembers(service, accountId, `${personName} · necesita a una persona`, reason, {
    type: target.kind === 'patient' && target.channel === 'app' ? 'patient_app_message' : 'whatsapp_message',
    key: conversationKeyFor(target),
  })
}
