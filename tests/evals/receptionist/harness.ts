// Runs one conversation through the receptionist as it runs in production --
// the same prompt builders, the same model loop with its checks in code
// (runReceptionistModel) -- with the tools replaced by stand-ins that answer
// from the fixture's diary instead of the database, and remember what they
// were asked.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt, type ReceptionistConfig } from '~/server/utils/receptionist'
import { runReceptionistModel, type ReceptionistRun } from '~/server/utils/receptionistModel'
import { buildPatientReplyPrompt, type PatientReplyFacts } from '~/utils/patientReplyPrompt'
import { availabilityLists, receptionistSlotGroups, type ReceptionistAvailability, type SlotType } from '~/utils/receptionistSlots'
import { findTypeByName, typesAfterFirstVisit, typesForAudience, typesForMinor, typesForSomeoneTheyBring, typesForReferral, type ReceptionistAudience } from '~/utils/receptionistTypes'
import { internalNotes } from '~/utils/receptionistGuard'
import { standingClockTimes, AUTOMATED_MARK, COLLEAGUE_MARK } from '~/utils/receptionistHistory'
import { chosenOfferedTime, chosenTimeNote } from '~/utils/receptionistFollowThrough'
import { clinicDateOf, startOfLocalDate, wallClockToUtc } from '~/utils/clinicClock'
import type { LeadOrigin } from '~/utils/receptionistLeadOrigin'
import { ALL_TYPES, BOOKED, CLINIC, CLINIC_DETAILS, KNOWLEDGE, NOW, PACKAGES, PRACTITIONERS, TIME_ZONE } from './fixtures'

/** The model production uses (receptionistDraft.ts, patientReplyDraft.ts). */
export const MODEL = process.env.EVAL_MODEL || 'claude-sonnet-5'

/**
 * The key: ANTHROPIC_API_KEY, or the one kept for evals in
 * ~/.quiroflow-eval-anthropic-key. Never the production key -- these calls
 * are tests, and their cost should not show as the clinics'.
 */
export function evalApiKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    return readFileSync(join(homedir(), '.quiroflow-eval-anthropic-key'), 'utf8').trim() || null
  } catch {
    return null
  }
}

export interface Turn {
  /** 'them': the patient or lead. 'us': the receptionist. 'colleague': a person at the clinic. 'system': a reminder or automation. */
  from: 'them' | 'us' | 'colleague' | 'system'
  text: string
}

export interface Scenario {
  kind: 'lead' | 'patient'
  conversation: Turn[]
  /** Leads: where they came from. */
  leadOrigin?: LeadOrigin
  /** Patients: their visits still booked, as "YYYY-MM-DD HH:MM" on the clinic's clock, with a type. */
  booked?: { at: string; type: SlotType }[]
  /** Patients: whether they have been before (visits completed). */
  returning?: boolean
}

export interface EvalResult {
  text: string
  refused: boolean
  handedOver: string | null
  tools: { name: string; input: Record<string, unknown>; ok: boolean }[]
  run: ReceptionistRun
}

const config: ReceptionistConfig = {
  enabled: true,
  personaName: 'Alba',
  languages: ['es', 'en'],
  tone: 'warm_brief',
  neverSays: 'No diagnosis, no treatment promises.',
  knowledge: KNOWLEDGE.map((card, i) => ({ id: `k${i}`, ...card })),
  qualificationQuestions: [],
  escalationRules: [],
  bookingWindowDays: 14,
  minimumNoticeMinutes: 120,
  slotsPerReply: 2,
  bookableAppointmentTypeIds: [],
  afterHours: true,
  missedCallTextBack: false,
  answerDuringHours: true,
  noReplyPhrases: [],
  monthlyReplyLimit: null,
  reactivationAppointmentTypeId: null,
  updatedAt: null,
}

function availability(types: SlotType[], from?: Date, days = config.bookingWindowDays, practitionerIds: string[] | null = null): ReceptionistAvailability | null {
  return receptionistSlotGroups({
    now: NOW,
    clinics: [CLINIC],
    practitioners: PRACTITIONERS.filter((p) => !practitionerIds || practitionerIds.includes(p.id)).map((p) => ({ id: p.id, businessHours: p.businessHours, clinicIds: p.clinicIds })),
    types,
    appointments: BOOKED,
    blocks: [],
    bookingWindowDays: days,
    minimumNoticeMinutes: config.minimumNoticeMinutes,
    from,
  })
}

/** "YYYY-MM-DD HH:MM" on the clinic's clock, as the tools name a visit. */
const stamp = (iso: string) => `${clinicDateOf(new Date(iso), TIME_ZONE)} ${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TIME_ZONE })}`

export async function runScenario(scenario: Scenario, apiKey: string, injected?: Anthropic): Promise<EvalResult> {
  const audience: ReceptionistAudience = scenario.kind === 'patient' && scenario.returning ? 'existing' : scenario.leadOrigin?.source === 'Meta Ads' ? 'new_from_ad' : 'new'
  const { types, adOnly, regular } = typesForAudience(ALL_TYPES, audience)
  const booked = (scenario.booked ?? []).map((visit) => ({ ...visit, startsAt: new Date(wallClockToUtc(visit.at.slice(0, 10), visit.at.slice(11), TIME_ZONE)).toISOString() }))
  const bookable = [...new Map([...types, ...adOnly, ...booked.map((b) => b.type)].map((t) => [t.id, t])).values()] as SlotType[]
  // A returning patient is seen by their own chiropractor, Marta.
  const own = scenario.returning ? ['p-marta'] : null
  const calendar = { now: NOW, timeZone: TIME_ZONE, availability: availability(bookable, undefined, config.bookingWindowDays, own), withWhom: own ? ['Marta Ríos'] : null }
  const team = PRACTITIONERS.map((p) => p.name)
  const minors = { forNewChild: typesForMinor(ALL_TYPES, false), forReturningChild: typesForMinor(ALL_TYPES, true), children: [] }
  const bringsSomeone = { types: typesForSomeoneTheyBring(ALL_TYPES, Boolean(scenario.returning)), referred: Boolean(scenario.returning), canGive: false }
  const laterPrices = { sessions: typesAfterFirstVisit(ALL_TYPES), packages: PACKAGES }
  const bookedVisits = booked.map((b) => ({ startsAt: b.startsAt, typeName: b.type.name }))

  let system = scenario.kind === 'lead'
    ? buildSystemPrompt(config, { testMode: false, offeredTypes: types, adOnlyTypes: adOnly, regularFirstVisit: regular, audience, calendar, leadOrigin: scenario.leadOrigin ?? null, searchTool: true, bookedVisits, draft: { personName: null }, knownDetails: { name: false, email: false, phone: true }, sendsItself: true, canBook: true, canWaitlist: true, minors, bringsSomeone, referral: audience === 'existing' ? undefined : { types: typesForReferral(ALL_TYPES) }, laterPrices, clinicDetails: CLINIC_DETAILS, team })
    : buildPatientReplyPrompt({ personaName: config.personaName, toneLine: 'Courteous and brief. Two or three sentences at most.', languages: config.languages, knowledge: config.knowledge, escalationRules: config.escalationRules, neverSays: config.neverSays, slotsPerReply: config.slotsPerReply, bookingWindowDays: config.bookingWindowDays }, {
        facts: patientFacts(scenario, booked),
        offeredTypes: types,
        adOnlyTypes: adOnly,
        regularFirstVisit: regular,
        audience,
        calendar,
        searchTool: true,
        bookedVisits,
        sendsItself: true,
        canBook: true,
        canWaitlist: true,
        canStopFollowUps: true,
        minors,
        family: { forNew: bringsSomeone.types, forReturning: types, members: [] },
        bringsSomeone,
        laterPrices,
        clinicDetails: CLINIC_DETAILS,
        team,
      })

  // As production does it: an answer that can only mean one of the times
  // just offered is said so in the prompt (receptionistDraft.ts).
  const lastUs = scenario.conversation.map((t) => t.from).lastIndexOf('us')
  if (lastUs >= 0) {
    const answer = scenario.conversation.slice(lastUs + 1).filter((t) => t.from === 'them').map((t) => t.text).join(' ')
    const chosen = chosenOfferedTime(scenario.conversation[lastUs]!.text, answer)
    if (chosen) system = { ...system, conversation: `${system.conversation}\n\n${chosenTimeNote(chosen, true)}` }
  }

  // The conversation as the model reads it (historyLine's marks), with each
  // side's consecutive messages joined into one turn.
  const messages: Anthropic.MessageParam[] = []
  for (const turn of scenario.conversation) {
    const role = turn.from === 'them' ? 'user' : 'assistant'
    const content = turn.from === 'colleague' ? `${COLLEAGUE_MARK}\n${turn.text}` : turn.from === 'system' ? `${AUTOMATED_MARK}\n${turn.text}` : turn.text
    const last = messages[messages.length - 1]
    if (last && last.role === role) last.content = `${last.content as string}\n${content}`
    else messages.push({ role, content })
  }
  while (messages[0]?.role !== 'user') messages.shift()

  const stillBooked = [...booked]
  const offeredTypes = [...types, ...adOnly]
  const freeAt = (type: SlotType, date: string, time: string) => {
    const day = availability([type], startOfLocalDate(date, TIME_ZONE), 1, own)
    return Boolean(day?.groups.some((g) => g.days.some((d) => d.date === date && d.times.includes(time))))
  }

  // The API itself, whatever ANTHROPIC_BASE_URL the shell carries: a proxy
  // or gateway in front of it refuses this key (the trap
  // createAnthropicClient avoids in production).
  const client = injected ?? new Anthropic({ apiKey, baseURL: process.env.EVAL_ANTHROPIC_BASE_URL || 'https://api.anthropic.com' })
  const run = await runReceptionistModel(client, {
    model: MODEL,
    maxTokens: 1024,
    system,
    messages,
    handOver: true,
    findFreeTimes: async (input) => {
      const value = input as { from_date?: string; to_date?: string; appointment_type?: string }
      if (!value.from_date) return { content: 'from_date is required.', isError: true }
      const days = value.to_date ? Math.round((Date.parse(value.to_date) - Date.parse(value.from_date)) / 86_400_000) + 1 : 1
      const chosen = value.appointment_type ? [findTypeByName(bookable, value.appointment_type)].filter((t): t is SlotType => Boolean(t)) : bookable
      if (!chosen.length) return { content: `Use one of: ${bookable.map((t) => t.name).join(', ')}.`, isError: true }
      const found = availability(chosen, startOfLocalDate(value.from_date, TIME_ZONE), Math.min(Math.max(days, 1), 14), own)
      return { content: found ? availabilityLists(found, `from ${value.from_date}`).join('\n\n') : 'Nothing free.', isError: false }
    },
    book: async (input) => {
      const value = input as { appointment_type?: string; date?: string; time?: string; move_visit_on?: string }
      const moving = value.move_visit_on ? stillBooked.find((b) => stamp(b.startsAt) === value.move_visit_on) : null
      if (value.move_visit_on && !moving) return { content: `They have no booked visit at ${value.move_visit_on}. Their visits: ${stillBooked.map((b) => stamp(b.startsAt)).join(', ') || 'none'}.`, isError: true }
      const type = moving ? moving.type : findTypeByName(offeredTypes, value.appointment_type)
      if (!type) return { content: `Name the type exactly as one of: ${offeredTypes.map((t) => t.name).join(', ')}. Call the tool again now with the one that fits what they asked for. A wrong name is not a reason to hand over, and do not say it is booked yet.`, isError: true }
      if (!value.date || !value.time || !freeAt(type, value.date, value.time)) return { content: `${value.time} on ${value.date} is not free for ${type.name}. Offer another free time; do not say it is booked.`, isError: true }
      return { content: `${moving ? 'Moved' : 'Booked'}: ${type.name}, ${value.date} ${value.time}, with ${own ? 'Marta Ríos' : 'Laura Vidal'}. Tell them, with the day and time in words.`, isError: false }
    },
    cancel: async (input) => {
      const value = input as { visit_on?: string }
      const visit = stillBooked.find((b) => stamp(b.startsAt) === value.visit_on)
      if (!visit) return { content: `They have no booked visit at ${value.visit_on}. Their visits: ${stillBooked.map((b) => stamp(b.startsAt)).join(', ') || 'none'}. Do not say anything is cancelled.`, isError: true }
      stillBooked.splice(stillBooked.indexOf(visit), 1)
      return { content: `Cancelled: ${visit.type.name}, ${value.visit_on}. Tell them it is cancelled, with the day and time in words.`, isError: false }
    },
    waitlist: async () => ({ content: 'On the waiting list. Tell them the clinic will let them know if a time frees up; do not promise one.', isError: false }),
    stopFollowUps: async () => ({ content: 'Done: no more follow-ups. Say goodbye in one short sentence.', isError: false }),
    maxTimesPerReply: config.slotsPerReply,
    standingTimes: standingClockTimes(booked, TIME_ZONE),
    internalNotes: internalNotes(config),
    teamNames: team,
    logLabel: 'eval',
  })

  return { text: run.text, refused: run.refused, handedOver: run.handedOver, tools: run.toolUses, run }
}

function patientFacts(scenario: Scenario, booked: { startsAt: string; type: SlotType }[]): PatientReplyFacts {
  return {
    firstName: 'Paula',
    upcoming: booked.map((b) => ({ startsAt: b.startsAt, typeName: b.type.name, practitionerName: 'Marta Ríos' })),
    cancelledAhead: [],
    lastVisitAt: scenario.returning ? '2026-11-09T17:00:00Z' : null,
    lastVisitType: scenario.returning ? 'Ajuste Quiropractico' : null,
    plan: null,
    bono: null,
    outstandingCents: null,
    history: null,
  }
}

/** The clock times ("H:MM") a reply mentions. */
export function timesIn(text: string): string[] {
  return [...text.matchAll(/\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/g)].map((m) => `${Number(m[1])}:${m[2]}`)
}
