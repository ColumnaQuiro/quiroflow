import type { H3Event } from 'h3'
import { sendInboxMessage } from '~/server/utils/inboxSend'
import { notifyInboxTeamMembers, sendPushToPatients } from '~/server/utils/pushNotifications'
import { changesTheDiary, offersPastTimeToday } from '~/utils/receptionistAutoReply'

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

/**
 * Why a reply written from the diary as it was at `readAt` must not go out
 * now, or null -- checked again in the last moment before sending, because a
 * reply takes seconds to write and the front desk does not wait for it.
 *
 * 'person' -- somebody from the clinic wrote in the conversation meanwhile.
 * 'diary' -- one of this patient's visits was booked, moved, cancelled or
 *   had meanwhile by anyone but the receptionist. The team moved a visit to
 *   12:30 and, a minute later, the reply read the 12:30 as taken and told the
 *   patient "me he confundido, es a las 13:30" (22 Oct 2026); the same thing
 *   happened with 18:15 the same afternoon.
 * 'past_time' -- it offers a time today that has already gone by
 *   (offersPastTimeToday).
 *
 * The first two are a person on the conversation: the reply stays a draft
 * for them, as autoReplyHeldBack's 'person' does. A past time has nobody on
 * it, so the caller hands it over.
 */
export async function heldBackBeforeSending(
  service: any,
  accountId: string,
  who: { patientId: string | null; leadId: string | null },
  readAt: string,
  text: string,
  timeZone: string,
): Promise<'person' | 'diary' | 'past_time' | null> {
  if (offersPastTimeToday(text, new Date(), timeZone)) return 'past_time'

  // A person's message: not the receptionist's, not a template or automation.
  const byPerson = (query: any) => query.eq('account_id', accountId).eq('direction', 'outbound').not('sent_by_ai', 'is', true).gt('created_at', readAt).limit(1)
  const reads: Promise<{ data: unknown[] | null }>[] = []
  if (who.leadId) reads.push(byPerson(service.from('whatsapp_messages').select('id')).eq('lead_id', who.leadId).is('template_name', null).is('rule_id', null).is('automation_action_id', null))
  if (who.patientId) {
    reads.push(byPerson(service.from('whatsapp_messages').select('id')).eq('patient_id', who.patientId).is('template_name', null).is('rule_id', null).is('automation_action_id', null))
    reads.push(byPerson(service.from('patient_app_messages').select('id')).eq('patient_id', who.patientId))
  }
  const written = await Promise.all(reads)
  if (written.some(({ data }) => (data ?? []).length > 0)) return 'person'

  if (who.patientId) {
    const { data: changes } = await service
      .from('audit_logs')
      .select('action, changes')
      .eq('account_id', accountId)
      .eq('entity_type', 'appointment')
      .eq('patient_id', who.patientId)
      // Not its own booking in this same reply. A row with no actor is
      // somebody's, so it counts.
      .or('actor.is.null,actor.neq.receptionist')
      .gt('created_at', readAt)
      .limit(20)
    if (((changes ?? []) as { action: string; changes: Record<string, unknown> | null }[]).some(changesTheDiary)) return 'diary'
  }
  return null
}

/** The handover note when a reply was held back for offering a time already gone. */
export const PAST_TIME_REASON = 'Mi respuesta ofrecía una hora de hoy que ya había pasado; la he dejado como borrador para que la revises.'

/** The Inbox's key for the conversation: a patient's id, or lead:<id>. */
export function conversationKeyFor(target: ReceptionistTarget): string {
  return target.kind === 'lead' ? `lead:${target.leadId}` : target.patientId
}

/**
 * An internal note in the conversation by "Recepcionista IA" (NoteBubble.vue:
 * a note with no author) -- seen by the team, never sent. What it did that a
 * person may need to check or undo: a handover, a visit it booked or moved.
 */
export async function noteInConversation(service: any, accountId: string, target: ReceptionistTarget, body: string) {
  const { error } = await service.from('inbox_notes').insert({ account_id: accountId, conversation_key: conversationKeyFor(target), author_id: null, body: body.slice(0, 2000), mentions: [] })
  if (error) console.error('[receptionist] could not leave a note in the conversation:', error.message)
}

/**
 * The receptionist passed this conversation to a person: an internal note in
 * the thread saying why (seen by the team, never sent), and a push to whoever
 * the Inbox notifies about it. The caller records the state that keeps the
 * receptionist quiet there (a lead's ai_state, a patient's handed_over_at).
 */
export async function announceHandover(service: any, accountId: string, target: ReceptionistTarget, personName: string, reason: string) {
  await noteInConversation(service, accountId, target, `He pasado esta conversación a una persona. Motivo: ${reason}`)
  await notifyInboxTeamMembers(service, accountId, `${personName} · necesita a una persona`, reason, {
    type: target.kind === 'patient' && target.channel === 'app' ? 'patient_app_message' : 'whatsapp_message',
    key: conversationKeyFor(target),
  })
  await handoverTask(service, accountId, target, personName, reason)
}

/**
 * The handover in Mi día as well: a task for whoever answers patients
 * (inbox_task_role_id), until somebody ticks it off. A push is gone once it is
 * swiped away, and a patient told "mi compañera te escribirá" about cancelling
 * a visit still had it booked the next morning. Overdue and unanswered, it
 * earns one more push (handover-reminder-cron). Best-effort -- the note and
 * the push have already gone out.
 */
async function handoverTask(service: any, accountId: string, target: ReceptionistTarget, personName: string, reason: string) {
  try {
    const { data: roleId } = await service.rpc('inbox_task_role_id', { p_account_id: accountId })
    if (!roleId) return
    const { error } = await service.from('staff_tasks').insert({
      account_id: accountId,
      role_id: roleId,
      patient_id: target.kind === 'patient' ? target.patientId : null,
      lead_id: target.kind === 'lead' ? target.leadId : null,
      title: `Responder a ${personName}: ${reason}`.slice(0, 300),
      due_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      // What handover-reminder-cron looks for: still open and overdue, with
      // nobody having written since, it pushes the team once more.
      receptionist_handover: true,
    })
    if (error) console.error('[receptionist] could not add the handover task:', error.message)
  } catch (err) {
    console.error('[receptionist] could not add the handover task:', (err as Error)?.message ?? err)
  }
}
