import { serverSupabaseServiceRole } from '#supabase/server'
import { createAnthropicClient } from '~/server/utils/anthropicClient'
import { requireReceptionist } from '~/server/utils/requireGrowth'
import { buildSystemPrompt, loadOfferedTypes, loadReceptionistCalendar, loadReceptionistConfig, type LeadOrigin } from '~/server/utils/receptionist'
import { freeTimesLookup, runReceptionistModel, type ReceptionistToolUse } from '~/server/utils/receptionistModel'
import { modelFailureMessage } from '~/utils/modelFailure'
import { typesForAudience, type ReceptionistAudience } from '~/utils/receptionistTypes'
import { isNoReply } from '~/utils/receptionistAutoReply'
import { internalNotes } from '~/utils/receptionistGuard'

// "Try Alba" -- the clinic owner talking to their own configuration.
//
// This is deliberately the safe place to run the model: there is no patient
// on the other end, nothing is sent anywhere, and nothing is written to the
// calendar. It exists so an owner can see what their booking rules and
// escalation rules actually produce BEFORE any of it is pointed at a real
// person -- which is the order those two things should happen in.
//
// What comes back besides the words is what it DID: the free times it looked
// up, and whether it would have handed the conversation to a person and why.
// The hand-over tool is offered exactly as it is when the receptionist
// answers on its own, and here its only effect is the `handedOver` reason in
// the response -- nobody is notified and no task is written. Booking is not
// offered: book_appointment writes to the calendar, and a dry run of it
// would be a second implementation of the booking that could drift from the
// real one.

// Sonnet, matching receptionistDraft.ts -- see the note there. The test
// panel has to run the model the drafts actually run on, or it advertises a
// quality the clinic will not get.
const MODEL = 'claude-sonnet-5'
const MAX_TOKENS = 1024
const MAX_TURNS = 20

interface Body {
  messages?: unknown
  /**
   * Who the owner is pretending to be: 'ad' for a lead that came from an
   * ad, 'existing' for a patient who has been to the clinic before, anything
   * else for a WhatsApp enquiry nobody knows the source of.
   */
  scenario?: unknown
  /** The old name for `scenario`, still sent by an app that has not updated. */
  origin?: unknown
}

export type TestScenario = 'new' | 'ad' | 'existing'

// The cases worth trying by hand. An ad lead is a Meta lead-ad form, which
// is what real ad leads arrive as, so the prompt is built exactly as a real
// draft for one would be. A new enquiry is a WhatsApp message nobody knows
// the source of -- the case where the receptionist has to ask. An existing
// patient is never offered a first visit and is seen by their own
// practitioner; here, with nobody real behind it, their times are anyone's
// and they have no visit booked to move.
const SCENARIOS: Record<TestScenario, { origin: LeadOrigin; audience: ReceptionistAudience }> = {
  ad: { origin: { channel: 'facebook', source: null, externalSource: 'facebook', campaign: null, ad: null }, audience: 'new_from_ad' },
  new: { origin: { channel: 'whatsapp', source: null, externalSource: null, campaign: null, ad: null }, audience: 'new' },
  existing: { origin: { channel: 'whatsapp', source: null, externalSource: null, campaign: null, ad: null }, audience: 'existing' },
}

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

function isTurn(value: unknown): value is Turn {
  const turn = value as Turn
  return Boolean(turn) && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' && turn.content.trim().length > 0
}

function scenarioOf(body: Body): TestScenario {
  if (body.scenario === 'ad' || body.scenario === 'existing' || body.scenario === 'new') return body.scenario
  return body.origin === 'ad' ? 'ad' : 'new'
}

/** What the panel shows of a tool call: the lookup's dates, nothing else. */
function describe(use: ReceptionistToolUse): { name: string; detail: string | null; ok: boolean } {
  if (use.name === 'find_free_times') {
    const from = typeof use.input.from_date === 'string' ? use.input.from_date : null
    const to = typeof use.input.to_date === 'string' ? use.input.to_date : null
    const type = typeof use.input.appointment_type === 'string' ? use.input.appointment_type : null
    return { name: use.name, detail: [from && to ? `${from} → ${to}` : from, type].filter(Boolean).join(' · ') || null, ok: use.ok }
  }
  return { name: use.name, detail: null, ok: use.ok }
}

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireReceptionist(event)
  const body = (await readBody<Body>(event).catch(() => null)) ?? ({} as Body)

  const turns = Array.isArray(body.messages) ? body.messages.filter(isTurn).slice(-MAX_TURNS) : []
  if (turns.length === 0 || turns[turns.length - 1]!.role !== 'user') {
    throw createError({ statusCode: 400, statusMessage: 'Send the conversation so far, ending with the patient message' })
  }

  const apiKey = useRuntimeConfig().anthropicApiKey
  // Not configured is a normal state, not a failure -- same handling as the
  // support widget. The panel says so rather than showing an error.
  if (!apiKey) return { available: false as const, reply: '' }

  const config = await loadReceptionistConfig(supabase, teamMember.account_id)
  const scenario = SCENARIOS[scenarioOf(body)]
  // The same narrowing the drafts get: an owner pretending to come from the
  // ad is offered the ad's first visit, anyone else the plain one, and a
  // returning patient never a first visit.
  const { types, adOnly } = typesForAudience(await loadOfferedTypes(supabase, teamMember.account_id, config), scenario.audience)
  const bookable = [...types, ...adOnly]
  // And the same free times, read with the service role for the reason given
  // in loadReceptionistCalendar.
  const service = serverSupabaseServiceRole(event)
  const calendar = await loadReceptionistCalendar(service, teamMember.account_id, config, bookable)
  const findFreeTimes = calendar.availability ? freeTimesLookup(service, teamMember.account_id, config, bookable, calendar.timeZone) : null

  try {
    const { text: reply, refused, handedOver, toolUses } = await runReceptionistModel(await createAnthropicClient(apiKey), {
      model: MODEL,
      maxTokens: MAX_TOKENS,
      system: buildSystemPrompt(config, { testMode: true, offeredTypes: types, adOnlyTypes: adOnly, audience: scenario.audience, calendar, leadOrigin: scenario.origin, searchTool: Boolean(findFreeTimes), sendsItself: true }),
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
      findFreeTimes,
      // Offered as when it answers on its own; here it only reports.
      handOver: true,
      internalNotes: internalNotes(config),
      logLabel: `Try ${config.personaName} (account ${teamMember.account_id})`,
    })
    const trace = toolUses.map(describe)
    if (refused) return { available: true as const, reply: '', refused: true, handedOver, trace }
    // The owner sees that it would stay quiet, rather than the marker
    // itself; the panel words it in their language.
    if (isNoReply(reply)) return { available: true as const, reply: '', refused: false, noReply: true, handedOver, trace }
    return { available: true as const, reply, refused: false, handedOver, trace }
  } catch (err) {
    console.error('[growth/receptionist/test-chat] Anthropic request failed:', (err as Error)?.message ?? err)
    // The reason, not "try again": a rejected key or an empty account fails
    // identically on every retry, and the owner is the one who can tell us.
    throw createError({ statusCode: 502, statusMessage: modelFailureMessage(err) })
  }
})
