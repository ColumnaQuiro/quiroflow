import type { H3Event } from 'h3'
import { announceHandover, sendAsReceptionist, type ReceptionistTarget } from '~/server/utils/receptionistSend'
import { accountsAnsweringNow } from '~/server/utils/receptionistHeld'
import { hasReceptionist } from '~/server/utils/requireGrowth'
import { isWithin24hWindow } from '~/server/utils/whatsappSend'
import { choiceLanguage } from '~/utils/cancellationReason'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { offersTimes } from '~/utils/receptionistFollowThrough'
import { NUDGE_EVERY_DAYS, agreedText, followUpDecision, followUpTaskReason, nudgeDueAt, nudgeText, type FollowUpKind } from '~/utils/receptionistConversion'

// The receptionist writing first.
//
// Everything else it does answers a message. That is why "ya te aviso" was
// the end of a conversation: of 47 patients who said it (12 Oct - 19 Nov
// 2026) nine booked, and of five leads none -- and why two times offered at
// 22:30 to somebody who then went to bed were never mentioned again.
//
// Two kinds (receptionist_follow_ups):
//   'nudge'  -- times were offered and nobody answered: one message the next
//               morning, at most once a week per conversation.
//   'agreed' -- the day it said it would write (write_back_on).
//
// Both are fixed sentences, not the model's: nobody is there to answer, so
// there is nothing to get wrong, and they name no time that may have gone by
// then. Whatever they answer is an ordinary message, answered as any other.
//
// Sent from handover-reminder-cron (every 15 minutes: no new pg_cron job),
// through the same send as a reply, so the 24-hour window, the minor check
// and the number they wrote from all hold. Where WhatsApp no longer lets it
// write, an agreed day becomes a task for a person; a nudge is let go.

/** Looked at per tick. */
const MAX_PER_TICK = 50

export type FollowUpChannel = 'whatsapp' | 'app' | 'webchat' | 'messenger'

/** The channel as a follow-up is filed, from the one they last wrote on. */
export function followUpChannel(channel: string | null | undefined): FollowUpChannel {
  return channel === 'app' || channel === 'webchat' || channel === 'messenger' ? channel : 'whatsapp'
}

/**
 * After a reply went out: if it offers times and books nothing, a nudge for
 * the next morning -- replacing one already waiting, and not when one was
 * sent in this conversation within the week. Best-effort: the reply is sent
 * either way.
 */
export async function scheduleNudgeAfterOffer(
  service: any,
  accountId: string,
  conversationKey: string,
  channel: string | null | undefined,
  reply: { text: string; offeredTimes: boolean; changedDiary: boolean },
  timeZone: string | null | undefined,
  now = new Date(),
): Promise<void> {
  try {
    if (reply.changedDiary || !(reply.offeredTimes || offersTimes(reply.text))) return
    const key = { account_id: accountId, conversation_key: conversationKey, kind: 'nudge' }
    const since = new Date(now.getTime() - NUDGE_EVERY_DAYS * 86_400_000).toISOString()
    const { data: recent } = await service.from('receptionist_follow_ups').select('id').match(key).eq('outcome', 'sent').gt('done_at', since).limit(1)
    if ((recent ?? []).length) return
    await service.from('receptionist_follow_ups').update({ done_at: now.toISOString(), outcome: 'dropped' }).match(key).is('done_at', null)
    const { error } = await service.from('receptionist_follow_ups').insert({ ...key, channel: followUpChannel(channel), due_at: nudgeDueAt(now, timeZone || DEFAULT_CLINIC_TIMEZONE).toISOString() })
    if (error) console.error('[receptionist] could not schedule the nudge:', error.message)
  } catch (err) {
    console.error('[receptionist] could not schedule the nudge:', (err as Error)?.message ?? err)
  }
}

interface FollowUpRow {
  id: string
  account_id: string
  conversation_key: string
  channel: FollowUpChannel
  kind: FollowUpKind
  due_at: string
  created_at: string
}

/** Sends, hands to a person or drops every follow-up that is due. What became of each, by id. */
export async function runDueFollowUps(event: H3Event, supabase: any, now = new Date()): Promise<{ id: string; outcome: string }[]> {
  const { data: due, error } = await supabase
    .from('receptionist_follow_ups')
    .select('id, account_id, conversation_key, channel, kind, due_at, created_at')
    .is('done_at', null)
    .lte('due_at', now.toISOString())
    .order('due_at')
    .limit(MAX_PER_TICK)
  if (error) throw new Error(error.message)
  const rows = (due ?? []) as FollowUpRow[]
  if (!rows.length) return []

  const accountIds = [...new Set(rows.map((r) => r.account_id))]
  const [answering, { data: configs }, { data: subscriptions }] = await Promise.all([
    accountsAnsweringNow(supabase, accountIds, now),
    supabase.from('receptionist_config').select('account_id, enabled').in('account_id', accountIds),
    supabase.from('subscriptions').select('account_id, plan_id, growth_addon, receptionist_addon, status, comped').in('account_id', accountIds),
  ])
  const enabled = new Set(((configs ?? []) as { account_id: string; enabled: boolean }[]).filter((c) => c.enabled).map((c) => c.account_id))
  const entitled = new Set(((subscriptions ?? []) as { account_id: string }[]).filter((s) => hasReceptionist(s as never)).map((s) => s.account_id))

  const results: { id: string; outcome: string }[] = []
  for (const row of rows) {
    try {
      const on = enabled.has(row.account_id) && entitled.has(row.account_id)
      results.push({ id: row.id, outcome: await runOne(event, supabase, row, now, on, on && answering.has(row.account_id)) })
    } catch (err) {
      console.error(`[receptionist] follow-up ${row.id} failed:`, (err as Error)?.message ?? err)
      await finish(supabase, row.id, 'failed', now)
      results.push({ id: row.id, outcome: 'failed' })
    }
  }
  return results
}

async function finish(supabase: any, id: string, outcome: 'sent' | 'task' | 'dropped' | 'failed', now: Date): Promise<boolean> {
  // Only while still waiting, so two ticks cannot both send it.
  const { data } = await supabase.from('receptionist_follow_ups').update({ done_at: now.toISOString(), outcome }).eq('id', id).is('done_at', null).select('id')
  return (data ?? []).length > 0
}

async function runOne(event: H3Event, supabase: any, row: FollowUpRow, now: Date, on: boolean, answersNow: boolean): Promise<string> {
  const drop = async () => ((await finish(supabase, row.id, 'dropped', now)), 'dropped')
  // Switched off or no longer paid for: nothing is sent, and nothing is asked of anyone.
  if (!on) return drop()

  const leadId = row.conversation_key.startsWith('lead:') ? row.conversation_key.slice(5) : null
  let patientId = leadId ? null : row.conversation_key
  let name: string | null = null
  let language: string | null = null
  let withPerson = false
  let doNotContact = false

  if (leadId) {
    const { data: lead } = await supabase.from('leads').select('full_name, ai_state, patient_id, deleted_at').eq('id', leadId).eq('account_id', row.account_id).maybeSingle()
    if (!lead || lead.deleted_at) return drop()
    name = lead.full_name ?? null
    withPerson = !['handling', 'none'].includes(lead.ai_state)
    patientId = lead.patient_id ?? null
  } else {
    const [{ data: patient }, { data: state }] = await Promise.all([
      supabase.from('patients').select('first_name, preferred_language, do_not_contact, is_minor').eq('id', patientId).eq('account_id', row.account_id).maybeSingle(),
      supabase.from('inbox_reply_drafts').select('handed_over_at').eq('account_id', row.account_id).eq('conversation_key', row.conversation_key).maybeSingle(),
    ])
    // Gone (merged into another record, anonymised, deleted): nobody to write to.
    if (!patient) return drop()
    name = patient.first_name ?? null
    language = patient.preferred_language ?? null
    doNotContact = Boolean(patient.do_not_contact) || Boolean(patient.is_minor)
    withPerson = Boolean(state?.handed_over_at) && state.handed_over_at > row.created_at
  }

  // The conversation since it was scheduled, newest first.
  const scope = (query: any) => (leadId ? query.eq('lead_id', leadId) : query.eq('patient_id', patientId))
  const { data: wa } = await scope(
    supabase.from('whatsapp_messages').select('direction, sent_by_ai, template_name, rule_id, automation_action_id, created_at').eq('account_id', row.account_id).gt('created_at', row.created_at).order('created_at', { ascending: false }).limit(40),
  )
  const since = ((wa ?? []) as { direction: string; sent_by_ai: boolean | null; template_name: string | null; rule_id: string | null; automation_action_id: string | null; created_at: string }[]).map((m) => ({
    inbound: m.direction === 'inbound',
    person: m.direction === 'outbound' && m.sent_by_ai !== true && !m.template_name && !m.rule_id && !m.automation_action_id,
  }))
  if (!leadId && patientId) {
    const { data: app } = await supabase.from('patient_app_messages').select('direction, sent_by_ai').eq('account_id', row.account_id).eq('patient_id', patientId).gt('created_at', row.created_at).limit(40)
    for (const m of (app ?? []) as { direction: string; sent_by_ai: boolean | null }[]) since.push({ inbound: m.direction === 'inbound', person: m.direction === 'outbound' && m.sent_by_ai !== true })
  }

  let visitChangedSince = false
  if (patientId) {
    const { data: changes } = await supabase
      .from('audit_logs')
      .select('action, changes')
      .eq('account_id', row.account_id)
      .eq('entity_type', 'appointment')
      .eq('patient_id', patientId)
      .gt('created_at', row.created_at)
      .limit(20)
    visitChangedSince = ((changes ?? []) as { action: string; changes: Record<string, unknown> | null }[]).some((c) => c.action === 'created' || Boolean(c.changes && 'starts_at' in c.changes))
  }

  // WhatsApp and Messenger let a business write freely for 24 hours after
  // their last message; the clinic's own app does not mind.
  let windowOpen = row.channel === 'app'
  if (!windowOpen) {
    const { data: last } = await scope(supabase.from('whatsapp_messages').select('created_at').eq('account_id', row.account_id).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(1))
    windowOpen = isWithin24hWindow(((last ?? []) as { created_at: string }[])[0]?.created_at ?? null)
  }

  const decision = followUpDecision({
    kind: row.kind,
    dueAt: row.due_at,
    now,
    theyWroteSince: since.some((m) => m.inbound),
    personWroteSince: since.some((m) => m.person),
    visitChangedSince,
    withPerson,
    doNotContact,
    windowOpen,
    answersNow,
  })
  if (decision === 'drop') return drop()

  const target: ReceptionistTarget = leadId
    ? { kind: 'lead', leadId, channel: row.channel }
    : { kind: 'patient', patientId: patientId!, channel: row.channel === 'app' ? 'app' : 'whatsapp' }
  const person = name ?? (leadId ? 'Lead' : 'Paciente')

  if (decision === 'send') {
    // Claimed first: a tick that is cut off after sending must not send again.
    if (!(await finish(supabase, row.id, 'sent', now))) return 'taken'
    const text = row.kind === 'agreed' ? agreedText(name, choiceLanguage(language)) : nudgeText(name, choiceLanguage(language))
    try {
      await sendAsReceptionist(event, supabase, row.account_id, target, text)
      return 'sent'
    } catch (err) {
      console.error(`[receptionist] could not send follow-up ${row.id}:`, (err as Error)?.message ?? err)
      await supabase.from('receptionist_follow_ups').update({ outcome: row.kind === 'agreed' ? 'task' : 'failed' }).eq('id', row.id)
      // A day it promised to write on is still owed: a person is asked to.
      if (row.kind === 'agreed') await announceHandover(supabase, row.account_id, target, person, followUpTaskReason(row.kind))
      return row.kind === 'agreed' ? 'task' : 'failed'
    }
  }

  if (!(await finish(supabase, row.id, 'task', now))) return 'taken'
  await announceHandover(supabase, row.account_id, target, person, followUpTaskReason(row.kind))
  return 'task'
}
