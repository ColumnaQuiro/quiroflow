import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { TYPING_PAUSE_SECONDS, autoReplyNow, clinicOpenAt, stillTyping } from '~/utils/receptionistAutoReply'
import type { BusinessHours } from '~/utils/businessHours'

// Drafts a reply for every lead waiting on one, so the draft is there before
// anybody goes looking.
//
// Until now drafting only happened when somebody opened a thread and pressed
// a button, which means the receptionist only ever helped people who had
// already decided to deal with that lead. A lead writing at 21:40 had a draft
// available, not a draft waiting -- and those are different products.
//
// Deliberately still only a draft. Nothing here sends; approving stays a
// person reading the words and pressing send, which is why this needs no kill
// switch beyond the one it already honours and no answer to "what if it is
// wrong".
//
// Every minute, now that it can answer on its own: somebody in the middle of
// booking should not wait five minutes per message. The pg_cron job only
// calls this when an inbound message arrived in the last 15 minutes, so a
// quiet clinic costs nothing; and a conversation still being typed (the
// newest message under TYPING_PAUSE_SECONDS old) waits for the next tick, so
// a burst of four messages gets one answer, not four.
const MAX_PER_TICK = 25

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  // How long the newest message must sit before it is answered (stillTyping).
  // The schedule sends nothing and gets the default; the e2e specs, which
  // deliver a message and run the tick straight away, pass 0. Behind the
  // same cron secret as the rest of this route.
  const body = (await readBody<{ typingPauseSeconds?: unknown }>(event).catch(() => null)) ?? {}
  const pause = typeof body.typingPauseSeconds === 'number' ? Math.min(Math.max(body.typingPauseSeconds, 0), 300) : TYPING_PAUSE_SECONDS

  // Only accounts that switched the receptionist on. Reading this first, and
  // once, rather than per lead: it is the cheapest way to narrow the work and
  // it is the answer least likely to change within a tick.
  const { data: enabledConfigs } = await supabase
    .from('receptionist_config')
    .select('account_id')
    .eq('enabled', true)

  const accountIds = (enabledConfigs ?? []).map((c) => c.account_id)
  if (accountIds.length === 0) return { considered: 0, consideredLeadIds: [] as string[], consideredPatientIds: [] as string[], dispatchedLeadIds: [] as string[], dispatchedPatientIds: [] as string[] }

  // Growth is a paid add-on, and the cron runs as the service role -- outside
  // requireGrowth, which is what enforces that everywhere else. Checked here
  // rather than assumed: an account that stops paying must stop being worked
  // on, and a background job is exactly where that would go unnoticed.
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('account_id, plan_id, growth_addon, status, comped')
    .in('account_id', accountIds)

  const entitled = new Set(
    (subscriptions ?? []).filter((s) => hasGrowth(s)).map((s) => s.account_id),
  )
  if (entitled.size === 0) return { considered: 0, consideredLeadIds: [] as string[], consideredPatientIds: [] as string[], dispatchedLeadIds: [] as string[], dispatchedPatientIds: [] as string[] }

  // Which of them the receptionist answers for on its own right now, rather
  // than drafting: their "answer outside / during clinic hours" switches,
  // read against their first clinic's opening hours on its own clock.
  const answersNow = await accountsAnsweringNow(supabase, Array.from(entitled), new Date())

  // Who is due a draft: a lead the receptionist is handling, with no draft
  // waiting, whose newest inbound message is one drafting has not read yet
  // and is still inside WhatsApp's 24-hour window.
  //
  // Read from the messages end, newest first, rather than from the leads. The
  // leads end used to take 200 'handling' leads in no particular order and
  // only then ask each one whether it had written -- and the AI is on every
  // form lead from the moment it arrives, most of whom never write back. Past
  // 200 of those, a lead who had just asked a question was simply not in the
  // set, tick after tick. Starting from what was said in the last 24 hours
  // means a lead who has said nothing is never read at all, and the newest
  // question is the first one answered.
  //
  // The first row seen for a lead is its newest inbound message, which is the
  // only one the "read past it already?" test needs. Paged because one chatty
  // lead can fill a page on their own; stops as soon as the tick is full.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const due: { id: string; accountId: string }[] = []
  const seen = new Set<string>()
  const PAGE = 500

  for (let from = 0; due.length < MAX_PER_TICK; from += PAGE) {
    // Untyped: the filters on the embedded lead are what make it an inner
    // join, and the generated types do not model filtering through one.
    const { data: page, error } = await (supabase as any)
      .from('whatsapp_messages')
      .select('id, lead_id, created_at, leads!inner(id, account_id, ai_drafted_through_at)')
      .in('account_id', Array.from(entitled))
      .eq('direction', 'inbound')
      .not('lead_id', 'is', null)
      // WhatsApp refuses a free-form reply more than 24h after the last
      // inbound message, so a draft nobody could send is a draft not worth
      // paying a model to write.
      .gt('created_at', since)
      // 'none' too: a lead nobody has taken over or handed to a person. Only
      // new leads arrive on 'handling', so with just that, switching the
      // receptionist on drafted for nobody already in the Inbox. Never for
      // 'paused' (a person took it), 'needs_human' or 'blocked'.
      .in('leads.ai_state', ['handling', 'none'])
      .is('leads.deleted_at', null)
      // A draft already sitting there is somebody's to deal with, not ours to
      // replace. Overwriting it would discard an edit in progress.
      .is('leads.ai_draft_body', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('[receptionist-draft-cron] could not read waiting leads:', error.message)
      break
    }

    const rows = (page ?? []) as { lead_id: string; created_at: string; leads: { id: string; account_id: string; ai_drafted_through_at: string | null } }[]
    for (const message of rows) {
      if (seen.has(message.lead_id)) continue
      seen.add(message.lead_id)

      // Nothing new since the last draft. This is what stops a discarded draft
      // being rewritten on the next tick, over and over, with the clinic unable
      // to get rid of it.
      const draftedThrough = message.leads.ai_drafted_through_at
      if (draftedThrough && new Date(message.created_at).getTime() <= new Date(draftedThrough).getTime()) continue
      // Still typing: the next tick has the whole burst.
      if (stillTyping(message.created_at, new Date(), pause)) continue

      due.push({ id: message.lead_id, accountId: message.leads.account_id })
      if (due.length >= MAX_PER_TICK) break
    }
    if (rows.length < PAGE) break
  }

  // Patients too, not only leads: a patient asking to move their visit at
  // 21:40 has a draft waiting in the morning, as a lead does. Stored in
  // inbox_reply_drafts (patientReplyDraft.ts, `store`), without their
  // balance, since anyone with Inbox access reads it.
  const duePatients = await patientsDue(supabase, Array.from(entitled), since, pause)

  // Each conversation in its own call (/api/automations/receptionist-reply),
  // made by the database so this tick does not wait for any of them: a reply
  // takes 3-10 seconds, a function has 60, and 25 leads and 25 patients done
  // here in one call would be cut off half way. Skipped when another call
  // still holds the conversation's lease -- the next tick will see it.
  const busy = await leasedConversations(supabase, [...due.map((l) => `lead:${l.id}`), ...duePatients.map((p) => p.id)])
  const url = `${getRequestURL(event).origin}/api/automations/receptionist-reply`
  const dispatch = async (kind: 'lead' | 'patient', id: string, accountId: string) => {
    const { error } = await (supabase as any).rpc('dispatch_receptionist_reply', {
      p_url: url,
      p_secret: runtimeConfig.cronSecret,
      p_body: { kind, id, accountId, send: answersNow.has(accountId) },
    })
    if (error) console.error(`[receptionist-draft-cron] could not dispatch ${kind} ${id}:`, error.message)
    return !error
  }
  const dispatchedLeadIds: string[] = []
  for (const lead of due) {
    if (!busy.has(`lead:${lead.id}`) && (await dispatch('lead', lead.id, lead.accountId))) dispatchedLeadIds.push(lead.id)
  }
  const dispatchedPatientIds: string[] = []
  for (const patient of duePatients) {
    if (!busy.has(patient.id) && (await dispatch('patient', patient.id, patient.accountId))) dispatchedPatientIds.push(patient.id)
  }

  // The ids, not just the count: a tick that sent nothing and a tick that
  // sent somebody unexpected look identical in a number, and this is a
  // background job whose choices nobody watches. Bounded by MAX_PER_TICK.
  return {
    considered: due.length,
    consideredLeadIds: due.map((l) => l.id),
    consideredPatientIds: duePatients.map((p) => p.id),
    dispatchedLeadIds,
    dispatchedPatientIds,
  }
})

/** Conversations a receptionist-reply call is still working on. */
async function leasedConversations(supabase: any, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const { data } = await supabase.from('receptionist_reply_leases').select('conversation_key').in('conversation_key', keys).gt('leased_until', new Date().toISOString())
  return new Set(((data ?? []) as { conversation_key: string }[]).map((r) => r.conversation_key))
}

/**
 * Patients due a draft: newest message from them in the last 24 hours (on
 * WhatsApp or in the app), newer than whatever their stored draft answers.
 * Newest first, so the latest question is answered first; whether they are
 * still the last to have written is draftPatientReply's to check, before any
 * model is asked.
 *
 * WhatsApp messages that belong to a lead are the lead tick's above.
 */
async function patientsDue(supabase: any, accountIds: string[], since: string, pause: number): Promise<{ id: string; accountId: string }[]> {
  const newest = new Map<string, { accountId: string; at: string }>()
  for (const source of ['whatsapp_messages', 'patient_app_messages'] as const) {
    let query = supabase
      .from(source)
      .select('patient_id, account_id, created_at')
      .in('account_id', accountIds)
      .eq('direction', 'inbound')
      .not('patient_id', 'is', null)
      .gt('created_at', since)
    if (source === 'whatsapp_messages') query = query.is('lead_id', null)
    const { data, error } = await query.order('created_at', { ascending: false }).limit(500)
    if (error) {
      console.error(`[receptionist-draft-cron] could not read ${source}:`, error.message)
      continue
    }
    for (const row of (data ?? []) as { patient_id: string; account_id: string; created_at: string }[]) {
      const seen = newest.get(row.patient_id)
      if (!seen || row.created_at > seen.at) newest.set(row.patient_id, { accountId: row.account_id, at: row.created_at })
    }
  }
  if (newest.size === 0) return []

  // Already answered: a stored draft that reads up to (or past) their newest
  // message. What stops a discarded draft being written again next tick.
  const { data: drafts, error } = await supabase
    .from('inbox_reply_drafts')
    .select('conversation_key, drafted_through_at')
    .in('conversation_key', Array.from(newest.keys()))
  if (error) {
    console.error('[receptionist-draft-cron] could not read stored drafts:', error.message)
    return []
  }
  const draftedThrough = new Map<string, string>((drafts ?? []).map((d: { conversation_key: string; drafted_through_at: string }) => [d.conversation_key, d.drafted_through_at]))

  return Array.from(newest.entries())
    .filter(([id, m]) => {
      const through = draftedThrough.get(id)
      return (!through || new Date(m.at).getTime() > new Date(through).getTime()) && !stillTyping(m.at, new Date(), pause)
    })
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .slice(0, MAX_PER_TICK)
    .map(([id, m]) => ({ id, accountId: m.accountId }))
}

/** Accounts whose receptionist answers on its own at `now` (utils/receptionistAutoReply.ts). */
async function accountsAnsweringNow(supabase: any, accountIds: string[], now: Date): Promise<Set<string>> {
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
