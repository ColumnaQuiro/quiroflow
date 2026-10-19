import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, startOfLocalDate } from '~/utils/clinicClock'
import { receptionistEventKind, type ReceptionistActivity, type ReceptionistEvent } from '~/utils/receptionistActivity'

// What the AI receptionist has done, for the Overview of Growth > AI
// receptionist and the dashboard's card.
//
// Nothing here is a new record. Everything the receptionist does on its own
// already leaves one: a reply it writes is a receptionist_replies row (the
// allowance), a draft waits on leads.ai_draft_body or in inbox_reply_drafts,
// a handover is an open staff_tasks row, and every visit it books, moves or
// cancels is narrated in an authorless inbox_notes row (receptionistSend.ts,
// noteInConversation) -- the same note the team reads in the thread. This
// reads those back, so the Overview cannot claim something the thread does
// not show.
//
// Reads with the service role, scoped to one account: inbox_notes needs
// inbox_access to read, and the person on the settings page holds
// communication_config, which is a different permission.

const RECENT = 30

/** Midnight on the 1st of this month where the clinic is, as the allowance counts it. */
function monthStart(timeZone: string, now = new Date()): string {
  const today = clinicDateOf(now, timeZone)
  return startOfLocalDate(`${today.slice(0, 7)}-01`, timeZone).toISOString()
}

export async function loadReceptionistActivity(service: any, accountId: string): Promise<ReceptionistActivity> {
  const { data: clinics } = await service.from('clinics').select('timezone').eq('account_id', accountId).is('archived_at', null).order('created_at').limit(1)
  const timeZone = ((clinics ?? []) as { timezone: string | null }[])[0]?.timezone || DEFAULT_CLINIC_TIMEZONE
  const since = monthStart(timeZone)

  const [replies, leadDrafts, patientDrafts, handovers, notes] = await Promise.all([
    service.from('receptionist_replies').select('delivery, conversation_key').eq('account_id', accountId).gte('created_at', since).limit(20000),
    service.from('leads').select('id', { count: 'exact', head: true }).eq('account_id', accountId).is('deleted_at', null).not('ai_draft_body', 'is', null),
    // '-' is the marker the tick leaves when it read a message and had
    // nothing to say (patientReplyDraft.ts): a record, not a draft.
    service.from('inbox_reply_drafts').select('conversation_key', { count: 'exact', head: true }).eq('account_id', accountId).is('dismissed_at', null).neq('body', '-'),
    service.from('staff_tasks').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('receptionist_handover', true).is('done_at', null),
    service.from('inbox_notes').select('id, conversation_key, body, created_at').eq('account_id', accountId).is('author_id', null).order('created_at', { ascending: false }).limit(500),
  ])

  const rows = (replies.data ?? []) as { delivery: string; conversation_key: string }[]
  const month = {
    sent: rows.filter((r) => r.delivery === 'sent').length,
    drafted: rows.filter((r) => r.delivery === 'draft').length,
    conversations: new Set(rows.map((r) => r.conversation_key)).size,
  }

  const allNotes = (notes.data ?? []) as { id: string; conversation_key: string; body: string; created_at: string }[]
  const thisMonth = allNotes.filter((n) => n.created_at >= since)
  const count = (kind: ReceptionistEvent['kind']) => thisMonth.filter((n) => receptionistEventKind(n.body) === kind).length

  const recentNotes = allNotes.slice(0, RECENT)
  const names = await namesFor(service, accountId, recentNotes.map((n) => n.conversation_key))
  const recent: ReceptionistEvent[] = recentNotes.map((n) => ({
    id: n.id,
    at: n.created_at,
    conversationKey: n.conversation_key,
    name: names.get(n.conversation_key) ?? null,
    body: n.body,
    kind: receptionistEventKind(n.body),
  }))

  return {
    month,
    draftsWaiting: (leadDrafts.count ?? 0) + (patientDrafts.count ?? 0),
    handoversOpen: handovers.count ?? 0,
    booked: count('booked'),
    moved: count('moved'),
    cancelled: count('cancelled'),
    waitlisted: count('waitlisted'),
    handedOver: count('handover'),
    recent,
  }
}

/** Who each conversation is with: a lead's name, or a patient's. */
async function namesFor(service: any, accountId: string, keys: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const leadIds = [...new Set(keys.filter((k) => k.startsWith('lead:')).map((k) => k.slice('lead:'.length)))]
  const patientIds = [...new Set(keys.filter((k) => !k.startsWith('lead:')))]
  const [leads, patients] = await Promise.all([
    leadIds.length ? service.from('leads').select('id, full_name').eq('account_id', accountId).in('id', leadIds) : Promise.resolve({ data: [] }),
    patientIds.length ? service.from('patients').select('id, first_name, last_name').eq('account_id', accountId).in('id', patientIds) : Promise.resolve({ data: [] }),
  ])
  for (const lead of (leads.data ?? []) as { id: string; full_name: string | null }[]) {
    if (lead.full_name?.trim()) names.set(`lead:${lead.id}`, lead.full_name.trim())
  }
  for (const p of (patients.data ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
    if (name) names.set(p.id, name)
  }
  return names
}
