// Whether the AI receptionist has a conversation, for the Inbox chips -- web
// and app alike.
//
// A plain module (no Nuxt auto-imports): the app imports it by path, and the
// unit tests pin it.

export type InboxAiState = 'handling' | 'needs_human'

/** A lead's ai_state as a chip: handling, or a person needed. */
export function leadAiState(state: string | null | undefined): InboxAiState | null {
  if (state === 'handling') return 'handling'
  if (state === 'needs_human' || state === 'blocked') return 'needs_human'
  return null
}

export interface AiOutbound { patient_id: string; created_at: string; sent_by_ai: boolean | null }
export interface AiHandover { conversation_key: string; handed_over_at: string }

/**
 * A patient's conversation has no ai_state -- only leads carry one -- so it is
 * read from what happened: the receptionist wrote last for the clinic
 * (handling), or it handed the conversation over and no person has written
 * since (needs a person). The same test the server makes before answering
 * (personRepliedSince). `outbound` is what the clinic sent by hand or by the
 * receptionist, never a template or an automation.
 */
export function aiStatesFromMessages(handovers: AiHandover[], outbound: AiOutbound[]): Record<string, InboxAiState> {
  const lastAi: Record<string, string> = {}
  const lastPerson: Record<string, string> = {}
  for (const m of outbound) {
    const into = m.sent_by_ai ? lastAi : lastPerson
    if (!into[m.patient_id] || into[m.patient_id]! < m.created_at) into[m.patient_id] = m.created_at
  }
  const states: Record<string, InboxAiState> = {}
  for (const h of handovers) {
    const person = lastPerson[h.conversation_key]
    if (!person || person < h.handed_over_at) states[h.conversation_key] = 'needs_human'
  }
  for (const [id, at] of Object.entries(lastAi)) {
    const person = lastPerson[id]
    if (!states[id] && (!person || person < at)) states[id] = 'handling'
  }
  return states
}

/** How far back a conversation counts as the receptionist's. */
const SINCE_DAYS = 7

export interface PatientAiDetails {
  states: Record<string, InboxAiState>
  /** Patients with a receptionist draft waiting on a person (inbox_reply_drafts). */
  drafts: Set<string>
}

/**
 * The states for these patients' conversations, and which of them have a
 * draft waiting, read with the caller's own client (RLS scopes it to their
 * account). Empty when the receptionist is off.
 *
 * The drafts come from the same table as the handovers, so they cost no
 * extra request: a row with a body (the tick writes '-' when it read a
 * message and had nothing to say) that nobody has dealt with yet.
 */
export async function fetchPatientAiDetails(supabase: any, patientIds: string[]): Promise<PatientAiDetails> {
  if (patientIds.length === 0) return { states: {}, drafts: new Set() }
  const since = new Date(Date.now() - SINCE_DAYS * 86_400_000).toISOString()
  const [{ data: config }, { data: rows }, { data: wa }, { data: app }] = await Promise.all([
    supabase.from('receptionist_config').select('enabled').maybeSingle(),
    supabase.from('inbox_reply_drafts').select('conversation_key, handed_over_at, body, dismissed_at').in('conversation_key', patientIds),
    supabase.from('whatsapp_messages').select('patient_id, created_at, sent_by_ai').in('patient_id', patientIds).eq('direction', 'outbound').is('template_name', null).is('rule_id', null).is('automation_action_id', null).gt('created_at', since).order('created_at', { ascending: false }).limit(1000),
    supabase.from('patient_app_messages').select('patient_id, created_at, sent_by_ai').in('patient_id', patientIds).eq('direction', 'outbound').gt('created_at', since).order('created_at', { ascending: false }).limit(1000),
  ])
  if (!(config as { enabled?: boolean } | null)?.enabled) return { states: {}, drafts: new Set() }
  const all = (rows ?? []) as { conversation_key: string; handed_over_at: string | null; body: string; dismissed_at: string | null }[]
  const handovers = all.filter((r): r is typeof r & { handed_over_at: string } => Boolean(r.handed_over_at))
  const drafts = new Set(all.filter((r) => !r.dismissed_at && r.body && r.body !== '-').map((r) => r.conversation_key))
  return { states: aiStatesFromMessages(handovers, [...(wa ?? []), ...(app ?? [])] as AiOutbound[]), drafts }
}

/** The states alone -- what the app's Inbox reads. */
export async function fetchPatientAiStates(supabase: any, patientIds: string[]): Promise<Record<string, InboxAiState>> {
  return (await fetchPatientAiDetails(supabase, patientIds)).states
}

/**
 * Why a conversation was handed to a person: the latest note the receptionist
 * left saying so (receptionistSend.ts, announceHandover), without its fixed
 * opening. Null when no such note is in the thread.
 */
export function latestHandoverReason(notes: { author_id: string | null; body: string; created_at: string }[]): string | null {
  const handovers = notes.filter((n) => !n.author_id && /^he pasado esta conversación/i.test(n.body.trim()))
  const latest = handovers.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (!latest) return null
  const match = /motivo:\s*(.+)$/is.exec(latest.body)
  return (match?.[1] ?? latest.body).trim()
}
