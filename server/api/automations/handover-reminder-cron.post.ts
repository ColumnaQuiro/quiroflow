import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { notifyInboxTeamMembers } from '~/server/utils/pushNotifications'
import { clinicOpenAt } from '~/utils/receptionistAutoReply'
import { handoverReminderBody, handoverReminderDecision } from '~/utils/handoverReminder'
import type { BusinessHours } from '~/utils/businessHours'

// One more push for a handover nobody has answered.
//
// When the receptionist passes a conversation to a person it pushes the team
// and leaves a task in Mi día due two hours later (receptionistSend.ts,
// announceHandover). Both can be missed: the push is gone once it is swiped
// away, and the task is only seen by whoever opens Mi día. On 16 Oct a
// patient sent a photo the chiropractor had asked for, was told "mi compañera
// revisará la foto y te comentará en breve", and nobody had written back by
// closing time -- with the task sitting there, overdue.
//
// So, once the task is overdue and nobody has written in the conversation
// since the handover: the same Inbox push again, saying it is still waiting.
// Once per task (reminded_at), and only while the clinic is open, so it is
// not spent on a closed clinic overnight. A task whose conversation a person
// already answered is marked dealt with and never looked at again; the task
// itself is left for them to tick off.
//
// Every 15 minutes, like same-day-cron. Bounded per tick; anything over the
// limit is the next tick's.
const MAX_PER_TICK = 100
/** A handover older than this is history, not something to push about now. */
const MAX_AGE_DAYS = 7

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const now = new Date()

  const { data: tasks, error } = await supabase
    .from('staff_tasks')
    .select('id, account_id, patient_id, lead_id, title, created_at, due_at')
    .eq('receptionist_handover', true)
    .is('done_at', null)
    .is('reminded_at', null)
    .lte('due_at', now.toISOString())
    .gt('created_at', new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString())
    .order('due_at')
    .limit(MAX_PER_TICK)
  if (error) {
    console.error('[handover-reminder-cron] could not read handover tasks:', error.message)
    throw createError({ statusCode: 500, statusMessage: 'Could not read handover tasks' })
  }
  const rows = tasks ?? []
  if (rows.length === 0) return { reminded: [] as string[], answered: [] as string[] }

  const accountIds = [...new Set(rows.map((t) => t.account_id))]
  const since = rows.reduce((min, t) => (t.created_at < min ? t.created_at : min), rows[0]!.created_at)
  const [lastReply, open] = await Promise.all([
    lastPersonReplies(supabase, rows, since),
    clinicsOpenNow(supabase, accountIds, now),
  ])

  const reminded: string[] = []
  const answered: string[] = []
  for (const task of rows) {
    const key = task.lead_id ? `lead:${task.lead_id}` : task.patient_id
    if (!key) continue
    const decision = handoverReminderDecision(task, lastReply.get(key) ?? null, open.get(task.account_id) ?? null, now)
    if (decision === 'wait') continue

    // Claimed before the push, and only if still unclaimed: a second call in
    // the same tick (a retried request, a manual run) finds it taken and
    // sends nothing.
    const { data: claimed } = await supabase
      .from('staff_tasks')
      .update({ reminded_at: now.toISOString() })
      .eq('id', task.id)
      .is('reminded_at', null)
      .is('done_at', null)
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    if (decision === 'answered') {
      answered.push(task.id)
      continue
    }
    await notifyInboxTeamMembers(supabase, task.account_id, 'Recordatorio · necesita a una persona', handoverReminderBody(task.title), {
      type: 'inbox_handover_reminder',
      key,
    })
    reminded.push(task.id)
  }

  // The ids, not just counts: a background job nobody watches.
  return { reminded, answered }
})

/**
 * The newest message a person sent in each task's conversation since `since`:
 * outbound, not by the receptionist, not a template or an automation -- the
 * same test as personRepliedSince and the Inbox chips (utils/inboxAiState.ts).
 */
async function lastPersonReplies(
  supabase: any,
  tasks: { patient_id: string | null; lead_id: string | null }[],
  since: string,
): Promise<Map<string, string>> {
  const leadIds = [...new Set(tasks.map((t) => t.lead_id).filter((id): id is string => Boolean(id)))]
  const patientIds = [...new Set(tasks.filter((t) => !t.lead_id).map((t) => t.patient_id).filter((id): id is string => Boolean(id)))]
  const byHand = (query: any) => query
    .eq('direction', 'outbound')
    .not('sent_by_ai', 'is', true)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1000)
  const waHand = (query: any) => byHand(query).is('template_name', null).is('rule_id', null).is('automation_action_id', null)

  const [leadWa, patientWa, patientApp] = await Promise.all([
    leadIds.length ? waHand(supabase.from('whatsapp_messages').select('lead_id, created_at').in('lead_id', leadIds)) : { data: [] },
    patientIds.length ? waHand(supabase.from('whatsapp_messages').select('patient_id, created_at').in('patient_id', patientIds).is('lead_id', null)) : { data: [] },
    patientIds.length ? byHand(supabase.from('patient_app_messages').select('patient_id, created_at').in('patient_id', patientIds)) : { data: [] },
  ])

  const newest = new Map<string, string>()
  const note = (key: string, at: string) => {
    const seen = newest.get(key)
    if (!seen || at > seen) newest.set(key, at)
  }
  for (const m of (leadWa.data ?? []) as { lead_id: string; created_at: string }[]) note(`lead:${m.lead_id}`, m.created_at)
  for (const m of [...(patientWa.data ?? []), ...(patientApp.data ?? [])] as { patient_id: string; created_at: string }[]) note(m.patient_id, m.created_at)
  return newest
}

/** Whether each account's first clinic is open at `now` (null: no hours set). */
async function clinicsOpenNow(supabase: any, accountIds: string[], now: Date): Promise<Map<string, boolean | null>> {
  const { data: clinics } = await supabase
    .from('clinics')
    .select('account_id, timezone, business_hours, created_at')
    .in('account_id', accountIds)
    .is('archived_at', null)
    .order('created_at')
  const open = new Map<string, boolean | null>()
  for (const clinic of (clinics ?? []) as { account_id: string; timezone: string | null; business_hours: BusinessHours | null }[]) {
    if (!open.has(clinic.account_id)) open.set(clinic.account_id, clinicOpenAt(now, clinic.timezone, clinic.business_hours))
  }
  return open
}
