import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { draftLeadReply } from '~/server/utils/receptionistDraft'
import { draftPatientReply } from '~/server/utils/patientReplyDraft'
import { hasGrowth } from '~/server/utils/requireGrowth'
import { autoReplyNow, clinicOpenAt } from '~/utils/receptionistAutoReply'
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
// Same 15-minute tick as the other automation crons. A tick is fine because
// nothing is waiting on this: the person who reads the draft is not sitting
// there watching for it, and a reply drafted 9 minutes after the question is
// indistinguishable from one drafted instantly by the time anyone looks.
const MAX_PER_TICK = 25
const CONCURRENCY = 3

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  // Only accounts that switched the receptionist on. Reading this first, and
  // once, rather than per lead: it is the cheapest way to narrow the work and
  // it is the answer least likely to change within a tick.
  const { data: enabledConfigs } = await supabase
    .from('receptionist_config')
    .select('account_id')
    .eq('enabled', true)

  const accountIds = (enabledConfigs ?? []).map((c) => c.account_id)
  if (accountIds.length === 0) return { drafted: 0, considered: 0, consideredLeadIds: [] as string[] }

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
  if (entitled.size === 0) return { drafted: 0, considered: 0, consideredLeadIds: [] as string[] }

  // Which of them the receptionist answers for on its own right now, rather
  // than drafting: their "answer outside / during clinic hours" switches,
  // read against their first clinic's opening hours on its own clock.
  const answersNow = await accountsAnsweringNow(supabase, Array.from(entitled), new Date())
  const sendOpts = (accountId: string) => (answersNow.has(accountId) ? { send: { event } } : {})

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

      due.push({ id: message.lead_id, accountId: message.leads.account_id })
      if (due.length >= MAX_PER_TICK) break
    }
    if (rows.length < PAGE) break
  }

  let drafted = 0

  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const batch = due.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (lead) => {
        try {
          const outcome = await draftLeadReply(supabase, lead.accountId, lead.id, supabase, sendOpts(lead.accountId))
          // The AI cannot answer this one: the model declined, or this
          // deployment has no model to ask. Left on 'handling' the lead would
          // sit there as the AI's, waiting on a draft that is never coming, so
          // it goes to a person -- the one other way it gets an answer. Only
          // from 'handling', so a person who took it over meanwhile keeps it.
          if (outcome.status === 'refused' || outcome.status === 'unavailable') {
            await supabase.from('leads').update({ ai_state: 'needs_human' }).eq('id', lead.id).eq('ai_state', 'handling')
          }
          return outcome.status === 'drafted' || outcome.status === 'sent'
        } catch (err) {
          // One lead's model call failing must not cost the rest of the tick.
          // Whatever went wrong is still true next tick, and the lead is
          // still due then.
          console.error(`[receptionist-draft-cron] lead ${lead.id} failed:`, (err as Error)?.message ?? err)
          return false
        }
      }),
    )
    drafted += results.filter(Boolean).length
  }

  // Patients too, not only leads: a patient asking to move their visit at
  // 21:40 has a draft waiting in the morning, as a lead does. Stored in
  // inbox_reply_drafts (patientReplyDraft.ts, `store`), without their
  // balance, since anyone with Inbox access reads it.
  const duePatients = await patientsDue(supabase, Array.from(entitled), since)
  let draftedPatients = 0
  for (let i = 0; i < duePatients.length; i += CONCURRENCY) {
    const batch = duePatients.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (patient) => {
        try {
          const outcome = await draftPatientReply(supabase, supabase, patient.accountId, patient.id, { store: true, ...sendOpts(patient.accountId) })
          return outcome.status === 'drafted' || outcome.status === 'sent'
        } catch (err) {
          console.error(`[receptionist-draft-cron] patient ${patient.id} failed:`, (err as Error)?.message ?? err)
          return false
        }
      }),
    )
    draftedPatients += results.filter(Boolean).length
  }

  // The ids, not just the count: a tick that drafted nothing and a tick that
  // drafted for somebody unexpected look identical in a number, and this is a
  // background job whose choices nobody watches. Bounded by MAX_PER_TICK.
  return {
    drafted,
    considered: due.length,
    consideredLeadIds: due.map((l) => l.id),
    draftedPatients,
    consideredPatientIds: duePatients.map((p) => p.id),
  }
})

/**
 * Patients due a draft: newest message from them in the last 24 hours (on
 * WhatsApp or in the app), newer than whatever their stored draft answers.
 * Newest first, so the latest question is answered first; whether they are
 * still the last to have written is draftPatientReply's to check, before any
 * model is asked.
 *
 * WhatsApp messages that belong to a lead are the lead tick's above.
 */
async function patientsDue(supabase: any, accountIds: string[], since: string): Promise<{ id: string; accountId: string }[]> {
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
      return !through || new Date(m.at).getTime() > new Date(through).getTime()
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
