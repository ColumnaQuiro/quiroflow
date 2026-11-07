import { announceHandover, type ReceptionistTarget } from '~/server/utils/receptionistSend'
import { asksWhetherToCancel, cancelQuestionDue } from '~/utils/receptionistFollowThrough'

// "¿Te quito la cita del jueves a las 16:00?" with no answer.
//
// The receptionist asks that when someone says they may not come
// (BASE_BEHAVIOUR, "ya os aviso"). Asked and left unanswered, the visit stays
// booked: a lead's first visit sat in the diary for a day she had said she
// would not come (4 Nov 2026), and nothing in the receptionist runs again
// until they write. So, once the visit is within a day and they have had an
// hour to answer, a person gets it -- the same handover the receptionist makes
// itself (note, push, task in Mi día), and they can call before the time is
// lost.
//
// Run from handover-reminder-cron (every 15 minutes): no new pg_cron job.

/** Questions looked at per tick; the receptionist asks a handful a day. */
const MAX_QUESTIONS = 300
/** A question older than this is history. */
const MAX_AGE_DAYS = 4

interface Asked {
  accountId: string
  patientId: string | null
  leadId: string | null
  channel: 'whatsapp' | 'app'
  askedAt: string
}

export async function handOverUnansweredCancelQuestions(supabase: any, now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString()
  const [{ data: wa }, { data: app }] = await Promise.all([
    supabase.from('whatsapp_messages').select('account_id, patient_id, lead_id, body_preview, created_at').eq('direction', 'outbound').eq('sent_by_ai', true).gt('created_at', since).order('created_at', { ascending: false }).limit(MAX_QUESTIONS),
    supabase.from('patient_app_messages').select('account_id, patient_id, body, created_at').eq('direction', 'outbound').eq('sent_by_ai', true).gt('created_at', since).order('created_at', { ascending: false }).limit(MAX_QUESTIONS),
  ])

  // The newest question in each conversation; the receptionist's later
  // messages there are checked below as "written since".
  const asked = new Map<string, Asked>()
  const keep = (key: string, a: Asked) => {
    const seen = asked.get(key)
    if (!seen || a.askedAt > seen.askedAt) asked.set(key, a)
  }
  for (const m of (wa ?? []) as { account_id: string; patient_id: string | null; lead_id: string | null; body_preview: string | null; created_at: string }[]) {
    if (!asksWhetherToCancel(m.body_preview ?? '')) continue
    const key = m.lead_id ? `lead:${m.lead_id}` : m.patient_id
    if (key) keep(key, { accountId: m.account_id, patientId: m.patient_id, leadId: m.lead_id, channel: 'whatsapp', askedAt: m.created_at })
  }
  for (const m of (app ?? []) as { account_id: string; patient_id: string; body: string | null; created_at: string }[]) {
    if (asksWhetherToCancel(m.body ?? '')) keep(m.patient_id, { accountId: m.account_id, patientId: m.patient_id, leadId: null, channel: 'app', askedAt: m.created_at })
  }

  const handed: string[] = []
  for (const [key, a] of asked) {
    try {
      if (await handOverOne(supabase, key, a, now)) handed.push(key)
    } catch (err) {
      console.error(`[receptionist] could not check the cancel question in ${key}:`, (err as Error)?.message ?? err)
    }
  }
  return handed
}

async function handOverOne(supabase: any, key: string, a: Asked, now: Date): Promise<boolean> {
  // Anything in the conversation since -- their answer, a person's message,
  // the receptionist writing again -- means it is not waiting on this.
  const after = (query: any) => query.eq('account_id', a.accountId).gt('created_at', a.askedAt).limit(1)
  const reads: Promise<{ data: unknown[] | null }>[] = []
  // A reminder or an automation since is not an answer: left out.
  const notAutomated = (query: any) => query.is('template_name', null).is('rule_id', null).is('automation_action_id', null)
  if (a.leadId) reads.push(notAutomated(after(supabase.from('whatsapp_messages').select('id')).eq('lead_id', a.leadId)))
  if (a.patientId) {
    reads.push(notAutomated(after(supabase.from('whatsapp_messages').select('id')).eq('patient_id', a.patientId)))
    reads.push(after(supabase.from('patient_app_messages').select('id')).eq('patient_id', a.patientId))
  }
  if ((await Promise.all(reads)).some(({ data }) => (data ?? []).length > 0)) return false

  let patientId = a.patientId
  let name = 'Paciente'
  if (a.leadId) {
    const { data: lead } = await supabase.from('leads').select('full_name, patient_id, ai_state').eq('id', a.leadId).eq('account_id', a.accountId).maybeSingle()
    // Already a person's.
    if (!lead || !['handling', 'none'].includes(lead.ai_state)) return false
    patientId = patientId ?? lead.patient_id ?? null
    name = lead.full_name ?? 'Lead'
  } else {
    const { data: state } = await supabase.from('inbox_reply_drafts').select('handed_over_at').eq('account_id', a.accountId).eq('conversation_key', key).maybeSingle()
    // Handed over since the question: already a person's.
    if (state?.handed_over_at && state.handed_over_at >= a.askedAt) return false
  }
  if (!patientId) return false

  const { data: visits } = await supabase
    .from('appointments')
    .select('starts_at')
    .eq('account_id', a.accountId)
    .eq('patient_id', patientId)
    .eq('status', 'booked')
    .is('deleted_at', null)
    .gt('starts_at', now.toISOString())
    .order('starts_at')
    .limit(1)
  const visit = ((visits ?? []) as { starts_at: string }[])[0]
  if (!visit || !cancelQuestionDue({ askedAt: a.askedAt, visitStartsAt: visit.starts_at, now })) return false

  if (a.leadId) {
    const { data: claimed } = await supabase.from('leads').update({ ai_state: 'needs_human' }).eq('id', a.leadId).eq('account_id', a.accountId).in('ai_state', ['handling', 'none']).select('id').maybeSingle()
    if (!claimed) return false
  } else {
    const at = now.toISOString()
    const { data: patient } = await supabase.from('patients').select('first_name').eq('id', patientId).eq('account_id', a.accountId).maybeSingle()
    name = patient?.first_name ?? name
    const { data: updated } = await supabase.from('inbox_reply_drafts').update({ handed_over_at: at }).eq('account_id', a.accountId).eq('conversation_key', key).select('conversation_key')
    if (!(updated ?? []).length) {
      await supabase.from('inbox_reply_drafts').insert({ account_id: a.accountId, conversation_key: key, body: '-', drafted_through_at: a.askedAt, dismissed_at: at, handed_over_at: at, created_at: at })
    }
  }

  const { data: clinic } = await supabase.from('clinics').select('timezone').eq('account_id', a.accountId).is('archived_at', null).order('created_at').limit(1)
  const timeZone = ((clinic ?? []) as { timezone: string | null }[])[0]?.timezone || 'Europe/Madrid'
  const when = new Date(visit.starts_at).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone })
  const target: ReceptionistTarget = a.leadId ? { kind: 'lead', leadId: a.leadId, channel: 'whatsapp' } : { kind: 'patient', patientId, channel: a.channel }
  await announceHandover(supabase, a.accountId, target, name, `Le pregunté si le quitaba la cita del ${when} y no ha contestado; sigue reservada. Escríbele o llámale antes de la cita.`)
  return true
}
