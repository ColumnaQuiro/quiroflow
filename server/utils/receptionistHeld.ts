import { announceHandover, type ReceptionistTarget } from '~/server/utils/receptionistSend'
import { receptionistHandlesNewLeads } from '~/server/utils/receptionist'
import { autoReplyNow, clinicOpenAt } from '~/utils/receptionistAutoReply'
import type { BusinessHours } from '~/utils/businessHours'

// A reply the receptionist held back because somebody from the clinic was in
// the conversation ('person'), or changed the patient's visits while it was
// being written ('diary'), picked up again once the hold ends.
//
// Held, it became a draft and the message counted as answered. A person who
// was on the conversation but did not answer that last message -- they had
// moved on, or thought the receptionist would -- left it unanswered for good:
// a patient sent an MRI at 19:03, four minutes after somebody at the desk
// had written, and nothing answered until they wrote again the next morning
// (29 Oct 2026). The tick that answers only runs while messages arrive, so
// it never came back to it.
//
// Run from handover-reminder-cron, every 15 minutes. For each held reply
// whose hold has ended (receptionist_reply_traces.held_until):
// - somebody has written since, they have written again, or a person has the
//   conversation now: nothing to do;
// - otherwise, if the receptionist answers on its own at this hour, it
//   answers the conversation again, from scratch -- the diary and the
//   conversation may have moved since the draft;
// - if it does not, a person is told there is a message nobody answered,
//   with the draft waiting (the usual handover: note, push, task).

/** Held replies looked at per tick. */
const MAX_PER_TICK = 50
/** Older than this, WhatsApp's 24-hour window is closing: a person's, by handover, not ours. */
const MAX_AGE_HOURS = 20

/** The reason a person is given when the receptionist is not answering now. */
export const UNANSWERED_AFTER_HOLD_REASON = 'Escribió cuando había alguien del equipo en la conversación y nadie le ha contestado después. Te he dejado un borrador: revísalo y envíaselo.'

export async function resumeHeldReplies(supabase: any, opts: { url: string; secret: string; now?: Date }): Promise<{ key: string; outcome: string }[]> {
  const now = opts.now ?? new Date()
  const { data: held, error } = await supabase
    .from('receptionist_reply_traces')
    .select('id, account_id, conversation_key, kind, answers_through, created_at')
    .in('outcome', ['held_person', 'held_diary'])
    .is('resumed_at', null)
    .lte('held_until', now.toISOString())
    .gt('created_at', new Date(now.getTime() - MAX_AGE_HOURS * 3600_000).toISOString())
    .order('held_until')
    .limit(MAX_PER_TICK)
  if (error) {
    console.error('[receptionist] could not read held replies:', error.message)
    return []
  }
  const rows = (held ?? []) as { id: string; account_id: string; conversation_key: string; kind: 'lead' | 'patient'; answers_through: string | null; created_at: string }[]
  if (!rows.length) return []

  // Only the newest held reply per conversation: an older one is answered
  // by whatever is done for the newer.
  const newest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const seen = newest.get(row.conversation_key)
    if (!seen || row.created_at > seen.created_at) newest.set(row.conversation_key, row)
  }
  const older = rows.filter((row) => newest.get(row.conversation_key)!.id !== row.id).map((row) => row.id)
  if (older.length) await supabase.from('receptionist_reply_traces').update({ resumed_at: now.toISOString(), resume_outcome: 'superseded' }).in('id', older).is('resumed_at', null)

  const answering = await accountsAnsweringNow(supabase, [...new Set(rows.map((r) => r.account_id))], now)
  const done: { key: string; outcome: string }[] = []
  for (const row of newest.values()) {
    try {
      const outcome = await resumeOne(supabase, row, answering.has(row.account_id), opts)
      if (outcome) done.push({ key: row.conversation_key, outcome })
    } catch (err) {
      console.error(`[receptionist] could not resume the held reply in ${row.conversation_key}:`, (err as Error)?.message ?? err)
    }
  }
  return done
}

async function resumeOne(
  supabase: any,
  row: { id: string; account_id: string; conversation_key: string; kind: 'lead' | 'patient'; answers_through: string | null; created_at: string },
  answeringNow: boolean,
  opts: { url: string; secret: string },
): Promise<string | null> {
  const leadId = row.kind === 'lead' ? row.conversation_key.replace(/^lead:/, '') : null
  const patientId = row.kind === 'patient' ? row.conversation_key : null
  const settle = async (outcome: string) => {
    // Claimed: a second tick that read the same row finds it taken.
    const { data } = await supabase.from('receptionist_reply_traces').update({ resumed_at: new Date().toISOString(), resume_outcome: outcome }).eq('id', row.id).is('resumed_at', null).select('id')
    return (data ?? []).length > 0
  }

  // Anything in the conversation since the reply was held: somebody wrote
  // (not a reminder or an automation), or they did.
  const since = row.created_at
  const after = (query: any) => query.eq('account_id', row.account_id).gt('created_at', since).limit(1)
  const outbound = (query: any) => after(query).eq('direction', 'outbound')
  const notAutomated = (query: any) => query.is('template_name', null).is('rule_id', null).is('automation_action_id', null)
  const wrote: Promise<{ data: unknown[] | null }>[] = []
  const theyWrote: Promise<{ data: unknown[] | null }>[] = []
  const inboundAfter = row.answers_through ?? since
  const inbound = (query: any) => query.eq('account_id', row.account_id).eq('direction', 'inbound').gt('created_at', inboundAfter).limit(1)
  if (leadId) {
    wrote.push(notAutomated(outbound(supabase.from('whatsapp_messages').select('id')).eq('lead_id', leadId)))
    theyWrote.push(inbound(supabase.from('whatsapp_messages').select('id')).eq('lead_id', leadId))
  }
  if (patientId) {
    wrote.push(notAutomated(outbound(supabase.from('whatsapp_messages').select('id')).eq('patient_id', patientId)))
    wrote.push(outbound(supabase.from('patient_app_messages').select('id')).eq('patient_id', patientId))
    theyWrote.push(inbound(supabase.from('whatsapp_messages').select('id')).eq('patient_id', patientId))
    theyWrote.push(inbound(supabase.from('patient_app_messages').select('id')).eq('patient_id', patientId))
  }
  if ((await Promise.all(wrote)).some(({ data }) => (data ?? []).length > 0)) return (await settle('answered')) ? 'answered' : null
  // Their newer message is the tick's: it is due there, and answered whole.
  if ((await Promise.all(theyWrote)).some(({ data }) => (data ?? []).length > 0)) return (await settle('superseded')) ? 'superseded' : null

  // A person has the conversation, or put the draft away.
  let name = 'Paciente'
  let channel: string = 'whatsapp'
  if (leadId) {
    const { data: lead } = await supabase.from('leads').select('full_name, ai_state, ai_draft_body').eq('id', leadId).eq('account_id', row.account_id).maybeSingle()
    if (!lead || !['handling', 'none'].includes(lead.ai_state)) return (await settle('person')) ? 'person' : null
    if (!lead.ai_draft_body) return (await settle('dismissed')) ? 'dismissed' : null
    name = lead.full_name ?? 'Lead'
    const { data: last } = await supabase.from('whatsapp_messages').select('channel').eq('lead_id', leadId).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(1).maybeSingle()
    channel = last?.channel ?? 'whatsapp'
  } else if (patientId) {
    const { data: draft } = await supabase.from('inbox_reply_drafts').select('dismissed_at, handed_over_at').eq('account_id', row.account_id).eq('conversation_key', patientId).maybeSingle()
    if (draft?.dismissed_at) return (await settle('dismissed')) ? 'dismissed' : null
    if (draft?.handed_over_at && draft.handed_over_at > since) return (await settle('person')) ? 'person' : null
    const { data: patient } = await supabase.from('patients').select('first_name').eq('id', patientId).eq('account_id', row.account_id).maybeSingle()
    name = patient?.first_name ?? name
    const [{ data: wa }, { data: app }] = await Promise.all([
      supabase.from('whatsapp_messages').select('created_at').eq('patient_id', patientId).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('patient_app_messages').select('created_at').eq('patient_id', patientId).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    channel = app?.created_at && (!wa?.created_at || app.created_at > wa.created_at) ? 'app' : 'whatsapp'
  }

  // Answering on its own now, and still switched on and paid for: answered
  // again from scratch, as if they had just written.
  if (answeringNow && (await receptionistHandlesNewLeads(supabase, row.account_id))) {
    if (!(await settle('resent'))) return null
    const { error } = await supabase.rpc('dispatch_receptionist_reply', {
      p_url: opts.url,
      p_secret: opts.secret,
      p_body: { kind: row.kind, id: leadId ?? patientId, accountId: row.account_id, send: true },
    })
    if (error) {
      console.error(`[receptionist] could not dispatch the held reply in ${row.conversation_key}:`, error.message)
      await supabase.from('receptionist_reply_traces').update({ resumed_at: null, resume_outcome: null }).eq('id', row.id)
      return null
    }
    return 'resent'
  }

  // Not answering now: a person is told, with the draft there for them.
  if (!(await settle('handed_over'))) return null
  const target: ReceptionistTarget = leadId ? { kind: 'lead', leadId, channel } : { kind: 'patient', patientId: patientId!, channel: channel === 'app' ? 'app' : 'whatsapp' }
  await announceHandover(supabase, row.account_id, target, name, UNANSWERED_AFTER_HOLD_REASON)
  return 'handed_over'
}

/** Accounts whose receptionist answers on its own at `now` (utils/receptionistAutoReply.ts). */
export async function accountsAnsweringNow(supabase: any, accountIds: string[], now: Date): Promise<Set<string>> {
  if (!accountIds.length) return new Set()
  const [{ data: configs }, { data: clinics }] = await Promise.all([
    supabase.from('receptionist_config').select('account_id, after_hours, answer_during_hours').in('account_id', accountIds),
    supabase.from('clinics').select('account_id, timezone, business_hours, created_at').in('account_id', accountIds).is('archived_at', null).order('created_at'),
  ])
  const firstClinic = new Map<string, { timezone: string | null; business_hours: BusinessHours | null }>()
  for (const clinic of (clinics ?? []) as { account_id: string; timezone: string | null; business_hours: BusinessHours | null }[]) {
    if (!firstClinic.has(clinic.account_id)) firstClinic.set(clinic.account_id, clinic)
  }
  const answering = new Set<string>()
  for (const config of (configs ?? []) as { account_id: string; after_hours: boolean | null; answer_during_hours: boolean | null }[]) {
    const clinic = firstClinic.get(config.account_id)
    const open = clinicOpenAt(now, clinic?.timezone, clinic?.business_hours)
    if (autoReplyNow({ afterHours: config.after_hours ?? false, answerDuringHours: config.answer_during_hours ?? false }, open)) answering.add(config.account_id)
  }
  return answering
}
