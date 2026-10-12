import type { H3Event } from 'h3'
import { createAnthropicClient } from '~/server/utils/anthropicClient'
import { announceHandover, sendAsReceptionist } from '~/server/utils/receptionistSend'
import { autoReplyHeldBack, personRepliedSince } from '~/utils/receptionistAutoReply'
import { loadBookedVisits, loadOfferedTypes, loadPatientPractitioners, loadReceptionistCalendar, toConfig, toneWording, uniqueTypes } from '~/server/utils/receptionist'
import { freeTimesLookup, runReceptionistModel } from '~/server/utils/receptionistModel'
import { typesForAudience } from '~/utils/receptionistTypes'
import { internalNotes } from '~/utils/receptionistGuard'
import { carePlanCadenceLabel } from '~/utils/carePlanCadence'
import { buildPatientReplyPrompt, type PatientReplyFacts } from '~/utils/patientReplyPrompt'

// A reply to a PATIENT's message in the Inbox, drafted by the receptionist
// (Growth's AI receptionist, the one that drafts for leads -- same persona,
// tone, knowledge cards and free times), for a person to read and send.
//
// Unlike a lead draft it is not stored: nobody drafts for patients without
// being asked, so there is no tick to tell "already drafted" to, and the
// words go straight back to the person who pressed the button. Sending is the
// Inbox's ordinary send, by them.
//
// What it knows about the patient (next visits, care plan, what they owe) is
// read with the ASKER's client: a role that cannot see money gets a draft
// that does not mention it. Only the free times are read with the service
// role, for the reason loadReceptionistCalendar gives.

// Sonnet, as for leads (see receptionistDraft.ts): short, briefed writing
// that a person reads before it goes.
const MODEL = 'claude-sonnet-5'
const MAX_TOKENS = 1024
const HISTORY_TURNS = 24

export type PatientDraftOutcome =
  | { status: 'drafted'; draft: string }
  /** Sent by the receptionist itself (`send`). */
  | { status: 'sent'; text: string; handedOver: boolean }
  | { status: 'unavailable' }
  | { status: 'refused' }
  | { status: 'nothing_to_answer' }
  | { status: 'not_found' }

interface Turn { direction: string; body: string; created_at: string; sent_by_ai?: boolean | null; channel?: string | null }

/**
 * `supabase` is the asker's own client (RLS decides what of the patient they
 * see); `service` reads only the free times.
 */
export async function draftPatientReply(
  supabase: any,
  service: any,
  accountId: string,
  patientId: string,
  // `store`: written by the tick, without anyone asking, and kept in
  // inbox_reply_drafts for whoever opens the thread. Then it must not
  // mention money -- anyone with Inbox access reads it -- and `supabase` is
  // the service role too.
  opts: { store?: boolean; send?: { event: H3Event } } = {},
  // `send`: from the tick, when the clinic's hours switches say the
  // receptionist answers now -- sent rather than stored, unless the
  // conversation holds it back (a person in it, the day's limit, a handover
  // nobody has picked up yet), when it is stored as a draft as before.
): Promise<PatientDraftOutcome> {
  const { data: patient } = await supabase.from('patients').select('id, first_name').eq('id', patientId).eq('account_id', accountId).maybeSingle()
  if (!patient) return { status: 'not_found' }

  // Both channels the Inbox shows as one conversation: WhatsApp and the app.
  const [{ data: wa }, { data: app }] = await Promise.all([
    supabase.from('whatsapp_messages').select('direction, body_preview, created_at, sent_by_ai, channel').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(HISTORY_TURNS),
    supabase.from('patient_app_messages').select('direction, body, created_at, sent_by_ai').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(HISTORY_TURNS),
  ])
  const turns: Turn[] = [
    ...((wa ?? []) as { direction: string; body_preview: string | null; created_at: string; sent_by_ai?: boolean | null; channel?: string | null }[]).map((m) => ({
      direction: m.direction,
      body: m.body_preview ?? '',
      created_at: m.created_at,
      sent_by_ai: m.sent_by_ai,
      channel: m.channel ?? 'whatsapp',
    })),
    ...((app ?? []) as Turn[]).map((m) => ({ ...m, channel: 'app' })),
  ]
    .filter((m) => m.body.trim().length > 0)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-HISTORY_TURNS)
  // The model's messages must alternate; consecutive messages from one side
  // (three WhatsApps in a row) are one turn.
  const history: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of turns) {
    const role = m.direction === 'inbound' ? 'user' as const : 'assistant' as const
    const last = history[history.length - 1]
    if (last && last.role === role) last.content += `\n${m.body}`
    else history.push({ role, content: m.body })
  }
  while (history.length && history[0]!.role !== 'user') history.shift()
  // The newest thing they said, which a stored draft answers: the tick writes
  // another only once they have said something after it.
  const newestInboundAt = [...turns].reverse().find((m) => m.direction === 'inbound')?.created_at ?? null
  if (history.length === 0 || history[history.length - 1]!.role !== 'user') return { status: 'nothing_to_answer' }

  const apiKey = useRuntimeConfig().anthropicApiKey
  if (!apiKey) return { status: 'unavailable' }

  const { data: configRow } = await supabase.from('receptionist_config').select('*').eq('account_id', accountId).maybeSingle()
  const config = toConfig(configRow)

  const nowIso = new Date().toISOString()
  const [{ data: upcoming }, { data: last }, { data: plans }, { data: balance }] = await Promise.all([
    supabase.from('appointments').select('starts_at, appointment_types(name), team_members(full_name)').eq('patient_id', patientId).eq('status', 'booked').is('deleted_at', null).gte('starts_at', nowIso).order('starts_at').limit(3),
    supabase.from('appointments').select('starts_at, appointment_types(name)').eq('patient_id', patientId).eq('status', 'completed').is('deleted_at', null).lt('starts_at', nowIso).order('starts_at', { ascending: false }).limit(1),
    supabase.from('care_plans').select('name, total_visits, started_at, frequency_value, frequency_unit, visits_per_period').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(1),
    supabase.from('patient_live_balances').select('outstanding_cents').eq('patient_id', patientId).maybeSingle(),
  ])
  const plan = (plans ?? [])[0] as { name: string; total_visits: number; started_at: string; frequency_value: number; frequency_unit: string; visits_per_period: number | null } | undefined
  let done = 0
  if (plan) {
    const { count } = await supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', patientId).eq('status', 'completed').is('deleted_at', null).gte('starts_at', plan.started_at)
    done = count ?? 0
  }
  const en = (e: string) => e
  const facts: PatientReplyFacts = {
    firstName: patient.first_name ?? null,
    upcoming: ((upcoming ?? []) as { starts_at: string; appointment_types: { name: string } | null; team_members: { full_name: string } | null }[]).map((a) => ({
      startsAt: a.starts_at,
      typeName: a.appointment_types?.name ?? null,
      practitionerName: a.team_members?.full_name ?? null,
    })),
    lastVisitAt: (last ?? [])[0]?.starts_at ?? null,
    lastVisitType: ((last ?? [])[0] as { appointment_types?: { name: string } | null } | undefined)?.appointment_types?.name ?? null,
    plan: plan ? { name: plan.name, totalVisits: plan.total_visits, done, cadence: carePlanCadenceLabel(plan, en) } : null,
    outstandingCents: !opts.store && typeof balance?.outstanding_cents === 'number' ? balance.outstanding_cents : null,
  }

  // A patient who writes is somebody the clinic knows: never a first visit.
  const { types } = typesForAudience(await loadOfferedTypes(supabase, accountId, config), 'existing')
  // Moving a visit keeps its type, offered or not -- the prompt lists the
  // visits themselves under patient facts.
  const booked = await loadBookedVisits(supabase, accountId, patientId)
  const bookable = uniqueTypes(types, booked.types)
  // Somebody who has been before is seen by their own practitioner; a
  // patient record with no visit yet (a first visit booked, say) is still
  // somebody new, and a first visit is with whoever is free.
  const practitionerIds = facts.lastVisitAt ? await loadPatientPractitioners(supabase, accountId, patientId, booked.practitionerIds) : null
  const calendar = await loadReceptionistCalendar(service, accountId, config, bookable, undefined, undefined, practitionerIds)
  const findFreeTimes = calendar.availability ? freeTimesLookup(service, accountId, config, bookable, calendar.timeZone, practitionerIds) : null

  // Sent rather than stored: asked for, on the channel they last wrote on
  // (WhatsApp or the app), and nothing in the conversation holding it back.
  const lastInbound = [...turns].reverse().find((m) => m.direction === 'inbound')
  const channel: 'app' | 'whatsapp' | null = lastInbound?.channel === 'app' ? 'app' : lastInbound?.channel === 'whatsapp' ? 'whatsapp' : null
  const asTurns = turns.map((m) => ({ direction: m.direction, sentByAi: m.sent_by_ai === true, createdAt: m.created_at }))
  let handoverOpen = false
  if (opts.send) {
    const { data: state } = await service.from('inbox_reply_drafts').select('handed_over_at').eq('account_id', accountId).eq('conversation_key', patientId).maybeSingle()
    handoverOpen = Boolean(state?.handed_over_at) && !personRepliedSince(asTurns, state.handed_over_at)
  }
  const sends = Boolean(opts.send) && channel !== null && !handoverOpen && autoReplyHeldBack(asTurns, new Date()) === null

  const { text: draft, refused, handedOver } = await runReceptionistModel(createAnthropicClient(apiKey), {
    model: MODEL,
    maxTokens: MAX_TOKENS,
    system: buildPatientReplyPrompt({ ...config, toneLine: toneWording(config.tone) }, { facts, offeredTypes: types, calendar, searchTool: Boolean(findFreeTimes), bookedVisits: booked.visits, sendsItself: sends }),
    messages: history,
    findFreeTimes,
    handOver: sends,
    internalNotes: internalNotes(config),
    logLabel: `patient ${patientId}`,
  })
  const name = patient.first_name ?? 'Paciente'
  if (sends && opts.send && channel && newestInboundAt) {
    const target = { kind: 'patient' as const, patientId, channel }
    const now = new Date().toISOString()
    // Nothing to send: their question goes to a person now, and the
    // receptionist stays quiet here until somebody has answered.
    if (refused || !draft) {
      await service.from('inbox_reply_drafts').upsert({ account_id: accountId, conversation_key: patientId, body: '-', drafted_through_at: newestInboundAt, dismissed_at: now, handed_over_at: now })
      await announceHandover(service, accountId, target, name, 'La recepcionista no ha podido responder a su último mensaje.')
      return { status: 'refused' }
    }
    let sent = true
    try {
      await sendAsReceptionist(opts.send.event, service, accountId, target, draft)
    } catch (err) {
      // Refused (the window closed, "do not contact"...): stored as a draft
      // below instead, so a person still sees what it would have said.
      console.error(`[receptionist] could not send to patient ${patientId}:`, (err as Error)?.message ?? err)
      sent = false
    }
    if (sent) {
      // Kept as the conversation's marker -- answered up to here, dealt with
      // -- so the tick does not answer the same message twice.
      const { error } = await service.from('inbox_reply_drafts').upsert({
        account_id: accountId,
        conversation_key: patientId,
        body: draft.slice(0, 4000),
        drafted_through_at: newestInboundAt,
        dismissed_at: now,
        handed_over_at: handedOver ? now : null,
        created_at: now,
      })
      if (error) console.error(`[receptionist] could not record the reply to patient ${patientId}:`, error.message)
      if (handedOver) await announceHandover(service, accountId, target, name, handedOver)
      return { status: 'sent', text: draft, handedOver: Boolean(handedOver) }
    }
  }

  if (refused || !draft) return { status: 'refused' }
  if ((opts.store || opts.send) && newestInboundAt) {
    const { error } = await service
      .from('inbox_reply_drafts')
      .upsert({ account_id: accountId, conversation_key: patientId, body: draft.slice(0, 4000), drafted_through_at: newestInboundAt, dismissed_at: null, created_at: new Date().toISOString() })
    if (error) throw new Error(`could not store the draft: ${error.message}`)
  }
  return { status: 'drafted', draft }
}
