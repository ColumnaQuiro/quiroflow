import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { findChiropractor, loadReceptionistCalendar, type OfferedType, type ReceptionistConfig } from '~/server/utils/receptionist'
import { availabilityLists, FREE_TIMES_MAX_DAYS, FREE_TIMES_MAX_TIMES, parseFreeTimesInput, type ReceptionistAvailability } from '~/utils/receptionistSlots'
import { clinicDateOf, startOfLocalDate } from '~/utils/clinicClock'
import { briefingLeak } from '~/utils/receptionistGuard'
import { isNoReply, replyActed } from '~/utils/receptionistAutoReply'
import { FIXED_IN_CODE, fixStyle, styleNote, styleProblems } from '~/utils/receptionistStyle'
import { receptionistSystemBlocks, withTailBreakpoint, type ReceptionistPrompt } from '~/utils/receptionistPrompt'
import { ADD_TO_WAITLIST, ASK_WHY_CANCELLED, BOOK_APPOINTMENT, CANCEL_APPOINTMENT, GIVE_VISIT_TO, OFFER_TIMES, RECORD_CANCELLATION_REASON, STOP_EARLIER_TIME_OFFERS, STOP_FOLLOW_UPS, WRITE_BACK_ON, type OfferDraft, type OfferHints } from '~/server/utils/receptionistBooking'
import type { OfferedSlot, SlotLanguage } from '~/utils/receptionistConversion'
import { confirmationInWords, confirmationIsPlain, offerInWords, wordsMatchOffer, type BookedDetails } from '~/utils/receptionistOffers'
import { findTypeByName } from '~/utils/receptionistTypes'
import { cleanReply, clockTimes, misstatedVisitNote, misstatedVisitTime, offeredTimeCount, tooManyTimesNote, unbookedClaim, unbookedClaimNote } from '~/utils/receptionistHistory'
import { colleaguePromise, colleaguePromiseReason, handoverReasonSaysNothing, UNEXPLAINED_HANDOVER_REASON } from '~/utils/receptionistFollowThrough'
import { contradictingTimes, fullClaimNote, noFreeTimeClaim, type FreeTimesSource } from '~/utils/receptionistFullClaims'
import { languageNote, languageProblem, theirLanguage } from '~/utils/receptionistLanguageCheck'
import { shiftDate } from '~/utils/automationTriggerMatch'

// How the receptionist talks to the model, for all three of its callers --
// lead drafts, patient drafts and "Try Alba" -- so they cannot drift apart.
//
// The prompt lists the free times for the next bookingWindowDays (14 by
// default): enough for most patients, who want this week or the next. A
// patient asking about December used to get "my colleague will confirm",
// because nothing past the list existed for the model. find_free_times lets
// it look up any dates up to a year ahead, on demand -- the calendar is not
// pasted whole into every reply, which would make every reply pay for it.

/** Tool rounds before the model has to answer with what it has. */
const MAX_TOOL_ROUNDS = 4

/**
 * The models the receptionist may run on, the default first. Which one is
 * NUXT_RECEPTIONIST_MODEL's, so moving between them is an environment change
 * and so is going back. Anything else falls back to the default rather than
 * sending a model id nobody has tried with these prompts.
 *
 * Sonnet 5 is the default. Haiku 5.5 is about a twentieth of the price and,
 * on 21 Nov 2026, did as well on tests/evals/receptionist (5 runs of each of
 * 18 cases) -- better on English and on handing over a worsening symptom.
 * On 14 Oct it did worse on 24 real replies; the three ways it failed are
 * eval cases now, and it passed them.
 */
export const RECEPTIONIST_MODELS = ['claude-sonnet-5', 'claude-haiku-5-5'] as const

/** The model the receptionist runs on now (RECEPTIONIST_MODELS). */
export function receptionistModelName(): string {
  const configured = String(useRuntimeConfig().receptionistModel ?? '').trim()
  return (RECEPTIONIST_MODELS as readonly string[]).includes(configured) ? configured : RECEPTIONIST_MODELS[0]
}

/**
 * The model a reply is tried on once more when the first came back with
 * nothing to send (runReceptionistModel): the default, when the receptionist
 * runs on the cheaper one. Null when it already runs on the default.
 *
 * Haiku costs about $0.003 a reply and Sonnet about $0.05 (21-23 Nov 2026).
 * A reply with nothing to send was 2 in 57 on Haiku, each one a patient
 * passed to a person at night; one more try at Sonnet's price on those is
 * a tenth of a cent a reply, averaged.
 */
export function receptionistFallbackModel(): string | null {
  return receptionistModelName() === RECEPTIONIST_MODELS[0] ? null : RECEPTIONIST_MODELS[0]
}

const FIND_FREE_TIMES: Anthropic.Tool = {
  name: 'find_free_times',
  description:
    "Looks up the clinic's free appointment start times for specific dates, on the clinic's clock. Use it whenever the patient asks about a day the Booking list in your instructions does not cover. " +
    `Returns the free times per appointment type you can offer this person. At most ${FREE_TIMES_MAX_DAYS} days per call; for a wider range, look at the part the patient cares about first.`,
  input_schema: {
    type: 'object',
    properties: {
      from_date: { type: 'string', description: 'First date to look at, as YYYY-MM-DD.' },
      to_date: { type: 'string', description: `Last date, as YYYY-MM-DD, at most ${FREE_TIMES_MAX_DAYS - 1} days after from_date. Leave out to look at one day.` },
      appointment_type: { type: 'string', description: 'One of the appointment types you can offer, by its exact name. Leave out for all of them.' },
      for_name: {
        type: 'string',
        description: "When the visit is for one of their children, or an adult in their family listed in your instructions, rather than for them: that person's name. Their times are then with that person's own practitioner. Leave out for the person writing.",
      },
      any_chiropractor: {
        type: 'boolean',
        description: 'true to look at the whole team instead of their own chiropractor -- only when they are in a hurry and their own has nothing in the days they asked for. Leave out otherwise.',
      },
      chiropractor: {
        type: 'string',
        description: 'When they asked for one chiropractor by name ("con Natacha"): that name. The times are then only that chiropractor\'s; book them with the same chiropractor. Leave out otherwise.',
      },
    },
    required: ['from_date'],
    additionalProperties: false,
  },
}

/** What one reply came to, and what writing it took. */
export interface ReceptionistRun {
  text: string
  refused: boolean
  handedOver: string | null
  toolUses: ReceptionistToolUse[]
  /** The checks in code that fired, in order (receptionist_reply_traces.checks). */
  checks: string[]
  /** Choices to send with the text: the reasons for cancelling (after ask_why_cancelled), or the times it offers (after offer_times, in `offeredSlots`). */
  choices: 'cancellation_reason' | 'times' | null
  /** The times offer_times was last called with, when the reply books nothing. */
  offeredSlots: OfferedSlot[]
  /** Those times as an offer the code can book from, to keep once the reply is sent (receptionist_offers). */
  offer?: OfferDraft | null
  /** What book_appointment booked or moved in this reply. */
  booked?: BookedDetails | null
  /** The model that wrote it, when it was not the one asked for (the fallback). */
  model?: string
  /** Written and booked by code, with no model asked (acceptOfferedTime). */
  inCode?: boolean
  /** cacheWriteTokens is both kinds of write; cacheWrite1hTokens the hour-long ones (clinic and role), which cost 2x input rather than 1.25x. */
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWrite1hTokens: number; rounds: number }
}

/** One tool call the model made while writing a reply. */
export interface ReceptionistToolUse {
  name: string
  input: Record<string, unknown>
  ok: boolean
}

/**
 * find_free_times. `source` is what an answer listed, for reading a reply's
 * "nothing free" back against it (receptionistFullClaims.ts).
 */
export type FreeTimesLookup = (input: unknown) => Promise<{ content: string; isError: boolean; source?: FreeTimesSource }>

/**
 * The free times a prompt lists, as a FreeTimesSource: from the clinic's
 * today through the booking window, for `freeTimes` on the reply.
 */
export function promptFreeTimes(calendar: { now: Date; timeZone: string; availability: ReceptionistAvailability | null }, bookingWindowDays: number): FreeTimesSource | null {
  if (!calendar.availability) return null
  const from = clinicDateOf(calendar.now, calendar.timeZone)
  const to = clinicDateOf(new Date(calendar.now.getTime() + bookingWindowDays * 86400000 - 1), calendar.timeZone)
  return { from, to, groups: calendar.availability.groups.map((group) => ({ days: group.days, truncatedAfter: group.truncatedAfter })) }
}

/**
 * Whose times find_free_times reads when for_name is given: a child or an
 * adult in the writer's family, by name -- their own practitioner and the
 * types they may have -- or what to say when the name is nobody's.
 */
export type FreeTimesForWhom = (name: string) => { practitionerIds: string[] | null; types: OfferedType[] } | { error: string }

/**
 * find_free_times for one person: the types they may be offered, read with
 * `calendarClient`, which must be the service role for the reason
 * loadReceptionistCalendar gives.
 */
export function freeTimesLookup(
  calendarClient: SupabaseClient<Database>,
  accountId: string,
  config: ReceptionistConfig,
  types: OfferedType[],
  timeZone: string,
  // The same narrowing as the prompt's list: a returning patient's own
  // practitioner(s), or null for anyone.
  practitionerIds: string[] | null = null,
  // for_name: someone in their family instead of the person writing.
  forWhom: FreeTimesForWhom | null = null,
  // The conversation the times are offered in (loadReceptionistCalendar's offeredTo).
  offeredTo?: string | null,
): FreeTimesLookup {
  return async (input) => {
    const now = new Date()
    const query = parseFreeTimesInput(input, clinicDateOf(now, timeZone))
    if ('error' in query) return { content: query.error, isError: true }

    const forName = typeof (input as { for_name?: unknown } | null)?.for_name === 'string' ? ((input as { for_name: string }).for_name).replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    // Their own chiropractor's diary, unless they are in a hurry and the
    // whole team's is asked for (BASE_BEHAVIOUR, 6 Nov 2026).
    const anyone = (input as { any_chiropractor?: unknown } | null)?.any_chiropractor === true
    let whose = { practitionerIds: anyone ? null : practitionerIds, types }
    if (forName) {
      const found = forWhom ? forWhom(forName) : { error: 'You cannot look up times for someone else here. Ask which days suit them and say your colleague will confirm.' }
      if ('error' in found) return { content: found.error, isError: true }
      whose = found
    }

    const named = query.typeName ? findTypeByName(whose.types, query.typeName) : null
    let chosen = query.typeName ? (named ? [named] : []) : whose.types
    if (chosen.length === 0) {
      return { content: `"${query.typeName}" is not a type you can offer${forName ? ` ${forName}` : ''}. Use one of: ${whose.types.map((type) => type.name).join(', ')}.`, isError: true }
    }

    // One chiropractor they asked for by name: only her times, and only the
    // types she does (20 Nov 2026, matchChiropractor).
    const asked = typeof (input as { chiropractor?: unknown } | null)?.chiropractor === 'string' ? ((input as { chiropractor: string }).chiropractor).replace(/\s+/g, ' ').trim().slice(0, 80) : ''
    let withWhom: string | null = null
    if (asked && !forName) {
      const found = await findChiropractor(calendarClient, accountId, asked)
      if ('error' in found) return { content: found.error, isError: true }
      const hers = chosen.filter((type) => !type.practitionerIds?.length || type.practitionerIds.includes(found.id))
      if (!hers.length) return { content: `${found.fullName} does not do ${chosen.map((type) => type.name).join(' or ')}. Tell them, and ask whether another chiropractor would do.`, isError: true }
      chosen = hers
      whose = { ...whose, practitionerIds: [found.id] }
      withWhom = found.fullName
    }

    const calendar = await loadReceptionistCalendar(calendarClient, accountId, config, chosen, now, {
      from: startOfLocalDate(query.from, timeZone),
      days: query.days,
      maxTimesPerList: FREE_TIMES_MAX_TIMES,
    }, whose.practitionerIds, offeredTo)
    if (!calendar.availability) {
      return { content: 'The calendar could not be read. Do not offer a time: ask which days suit them and say your colleague will confirm an exact time shortly.', isError: true }
    }
    const span = `the ${query.days} day${query.days === 1 ? '' : 's'} from ${query.from}`
    return {
      content: [`Free start times${forName ? ` for ${forName}` : ''}${withWhom ? ` with ${withWhom} only` : ''} for ${span}, in the clinic's local time. A day not listed has nothing free.${withWhom ? ` Book any of them with chiropractor "${withWhom}".` : ''}`, ...availabilityLists(calendar.availability, `in ${span}`)].join('\n\n'),
      isError: false,
      source: {
        from: query.from,
        to: shiftDate(query.from, query.days - 1),
        groups: calendar.availability.groups.map((group) => ({ days: group.days, truncatedAfter: group.truncatedAfter })),
        scoped: Boolean(forName || withWhom),
      },
    }
  }
}

/**
 * One reply: the model, plus as many find_free_times rounds as it needs, up
 * to MAX_TOOL_ROUNDS -- after which it is told to answer without the tool
 * rather than left looping.
 *
 * The finished text is checked before it is returned (briefingLeak): one
 * that quotes the clinic's internal notes, or describes the briefing, comes
 * back as refused -- not shown, not stored, and on the lead tick handed to a
 * person -- whatever the prompt managed to prevent.
 *
 * Throws the SDK's errors, for the caller to word (modelFailureMessage).
 */
/** The words of a turn, without its thinking and tool calls. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

const EMPTY_REPLY_NOTE = 'Your reply had no text, so nothing would reach them. Write the message to send them now, in Spanish unless they write in another language: if you offered times with offer_times, name those same times in words and ask which they prefer. Do not call offer_times again for them.'

/**
 * Sends a turn back with a note. A turn with nothing but thinking in it is
 * not repeated (an assistant turn needs words or a tool call): the note joins
 * the last message of theirs instead, which may hold tool results.
 */
function pushNote(messages: Anthropic.MessageParam[], content: Anthropic.ContentBlock[], note: string): void {
  if (content.some((block) => block.type === 'text' || block.type === 'tool_use')) {
    messages.push({ role: 'assistant', content })
    messages.push({ role: 'user', content: note })
    return
  }
  const last = messages[messages.length - 1]
  if (last?.role === 'user') {
    const blocks = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : [...last.content]
    messages[messages.length - 1] = { role: 'user', content: [...blocks, { type: 'text', text: note }] }
  } else {
    messages.push({ role: 'user', content: note })
  }
}

/** The words of a message, its images and documents left out. */
function messageText(content: Anthropic.MessageParam['content']): string {
  if (typeof content === 'string') return content
  return content.map((block) => (block.type === 'text' ? block.text : '')).filter(Boolean).join('\n')
}

export type ReceptionistRunOptions = Parameters<typeof runOnce>[1]

/**
 * One reply (runOnce), tried once more on `fallbackModel` when it came back
 * with nothing to send. Only when the first try did nothing a second could
 * repeat: no visit booked or cancelled, nobody handed over.
 */
export async function runReceptionistModel(client: Anthropic, opts: ReceptionistRunOptions): Promise<ReceptionistRun> {
  const first = await runOnce(client, opts)
  const fallback = opts.fallbackModel
  if (!fallback || fallback === opts.model || !first.refused || first.handedOver || replyActed(first.toolUses)) return first
  try {
    const second = await runOnce(client, { ...opts, model: fallback })
    return {
      ...second,
      model: fallback,
      checks: [...first.checks, 'retried_on_fallback_model', ...second.checks],
      toolUses: [...first.toolUses, ...second.toolUses],
      usage: {
        inputTokens: first.usage.inputTokens + second.usage.inputTokens,
        outputTokens: first.usage.outputTokens + second.usage.outputTokens,
        cacheReadTokens: first.usage.cacheReadTokens + second.usage.cacheReadTokens,
        cacheWriteTokens: first.usage.cacheWriteTokens + second.usage.cacheWriteTokens,
        cacheWrite1hTokens: first.usage.cacheWrite1hTokens + second.usage.cacheWrite1hTokens,
        rounds: first.usage.rounds + second.usage.rounds,
      },
    }
  } catch (err) {
    console.error(`[receptionist] the retry on ${fallback} failed for ${opts.logLabel}:`, (err as Error)?.message ?? err)
    return first
  }
}

async function runOnce(
  client: Anthropic,
  opts: {
    model: string
    maxTokens: number
    system: ReceptionistPrompt
    messages: Anthropic.MessageParam[]
    findFreeTimes?: FreeTimesLookup | null
    /**
     * The free times the prompt lists (promptFreeTimes). A reply calling a
     * day, a week or a part of the day full while they, or a find_free_times
     * answer in this reply, have a time in it is written again once and
     * refused the second time (receptionistFullClaims.ts).
     */
    freeTimes?: FreeTimesSource | null
    /**
     * Offer hand_over_to_colleague: on when the reply is sent without a
     * person reading it first, so that what a draft's reader would have
     * caught -- an escalation rule, something it cannot do -- reaches a
     * person anyway. Its reason comes back as `handedOver`.
     */
    handOver?: boolean
    /**
     * A handover decided before the model was asked, with its reason (a
     * form answer describing a worsening symptom: formSymptomToHandOver).
     * The reply goes with it whether or not the model called
     * hand_over_to_colleague, and book_appointment is refused meanwhile.
     * Only with `handOver`: a draft is read by a person anyway.
     */
    mustHandOver?: string | null
    /**
     * Offer book_appointment (receptionistBooking.ts): only when the reply is
     * sent without review, so a calendar change is never made behind a draft
     * a person has not read yet.
     */
    book?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /** Offer add_to_waitlist (receptionistBooking.ts): same terms as `book`. */
    waitlist?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /** Offer cancel_appointment (receptionistBooking.ts): same terms as `book`. */
    cancel?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /** Offer give_visit_to (receptionistBooking.ts): same terms as `book`. */
    give?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /** Offer stop_follow_ups (receptionistBooking.ts): a patient answered on their own only. */
    stopFollowUps?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /** Offer ask_why_cancelled (receptionistBooking.ts): same terms as `cancel`. A success sends the reasons with the reply (`choices`). */
    askWhyCancelled?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /** Offer record_cancellation_reason (receptionistBooking.ts): same terms as `cancel`. */
    cancellationReason?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /**
     * Offer offer_times (receptionistBooking.ts): same terms as `book`. The
     * handler is built by the caller with `onOffered`, which this passes the
     * times to keep for the send.
     */
    offerTimes?: ((onOffered: (slots: OfferedSlot[], offer?: OfferDraft | null) => void) => (input: unknown, hints?: OfferHints) => Promise<{ content: string; isError: boolean }>) | null
    /** The language code-written words go out in: an offer or a confirmation the model left unsaid. Spanish when not given. */
    language?: SlotLanguage
    /**
     * The time they chose from the last offer, held for them while what the
     * booking needs is asked for (acceptOfferedTime 'held'): offering other
     * times instead is refused.
     */
    heldTime?: OfferedSlot | null
    /**
     * Tried once more on this model when the reply comes back with nothing
     * to send -- refused, withheld by a check, or empty -- and nothing was
     * done that a second try could do twice (receptionistFallbackModel).
     */
    fallbackModel?: string | null
    /**
     * A visit the code booked or moved before the model was asked
     * (acceptOfferedTime), whose confirmation is the model's to word: counted
     * as this reply's own booking by every check.
     */
    alreadyBooked?: { input: Record<string, unknown>; details: BookedDetails } | null
    /** Offer write_back_on (receptionistBooking.ts): same terms as `book`. */
    writeBack?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /** Offer stop_earlier_time_offers (receptionistBooking.ts): a clinic offering earlier first visits, same terms as `book`. */
    stopEarlier?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /**
     * The clinic's limit on times offered in one reply. A reply over it is
     * written again once (offeredTimeCount): told "at most 2", it offered one
     * person five.
     */
    maxTimesPerReply?: number
    /**
     * The clock times ("H:MM", the clinic's) of the visits they already have,
     * which a reply may restate without having booked them. With `book`, a
     * reply that states a booking at any other time nothing in it made is
     * written again once, and refused the second time (unbookedClaim).
     */
    standingTimes?: Set<string>
    /** The clinic's text that is not for patients (internalNotes). */
    internalNotes: string[]
    /** The practitioners' full names (loadTeamNames): a reply calls them by first name (fixStyle). */
    teamNames?: string[]
    /** Names the conversation in the log when a draft is withheld; never its content. */
    logLabel: string
  },
): Promise<ReceptionistRun> {
  const messages: Anthropic.MessageParam[] = [...opts.messages]
  // What the checks in code did to this reply, and what it cost, for its
  // record (receptionist_reply_traces).
  const checks: string[] = []
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, rounds: 0 }
  let choices: ReceptionistRun['choices'] = null
  let offeredSlots: OfferedSlot[] = []
  // Set from offer_times' handler: declared wide, or it reads as never null here.
  let offer = null as OfferDraft | null
  const offerTimes = opts.offerTimes ? opts.offerTimes((slots, resolved) => { offeredSlots = slots; offer = resolved ?? null }) : null
  // Whose times it last looked up (find_free_times), for offer_times to check the same diary.
  let lookedUp: OfferHints = {}
  // What book_appointment booked or moved in this reply.
  let bookedDetails = (opts.alreadyBooked?.details ?? null) as BookedDetails | null
  const language: SlotLanguage = opts.language ?? 'es'
  // Times to tap go only with a reply that still offers them: one that booked
  // or moved a visit has nothing left to choose, and "no reply" sends nothing.
  const run = (text: string, refused: boolean): ReceptionistRun => {
    const sent = refused || !text || isNoReply(text) ? null : choices === 'times' && (bookedVisit || !offeredSlots.length) ? null : choices
    return { text, refused, handedOver, toolUses, checks, usage, choices: sent, offeredSlots: sent === 'times' ? offeredSlots : [], offer: sent === 'times' ? offer : null, booked: bookedDetails }
  }
  // Every tool it called, in order, for the test panel's trace. The inputs
  // are the model's own (a date range, a time), never the clinic's data.
  const toolUses: ReceptionistToolUse[] = []
  // The clinic's part and the role after it are cached for an hour, and each
  // round's messages for five minutes (utils/receptionistPrompt.ts says why).
  // The tools render before them and are cached with them, so they must be
  // the same list for a lead and a patient: the callers offer both the same
  // ones, and a tool one of them cannot use is refused by its handler rather
  // than left out. Drafting has its own list, which makes two entries.
  const system = receptionistSystemBlocks(opts.system)
  const tools: Anthropic.Tool[] = [
    ...(opts.findFreeTimes ? [FIND_FREE_TIMES] : []),
    ...(opts.handOver ? [HAND_OVER] : []),
    ...(opts.book ? [BOOK_APPOINTMENT] : []),
    ...(opts.waitlist ? [ADD_TO_WAITLIST] : []),
    ...(opts.cancel ? [CANCEL_APPOINTMENT] : []),
    ...(opts.askWhyCancelled ? [ASK_WHY_CANCELLED] : []),
    ...(opts.cancellationReason ? [RECORD_CANCELLATION_REASON] : []),
    ...(opts.give ? [GIVE_VISIT_TO] : []),
    ...(opts.stopFollowUps ? [STOP_FOLLOW_UPS] : []),
    ...(opts.stopEarlier ? [STOP_EARLIER_TIME_OFFERS] : []),
    ...(offerTimes ? [OFFER_TIMES] : []),
    ...(opts.writeBack ? [WRITE_BACK_ON] : []),
  ]
  let handedOver: string | null = null
  const mustHandOver = opts.handOver ? opts.mustHandOver?.trim() || null : null
  // A booking's confirmation names its time (and a move, the old one too; a
  // cancellation, the one that was): not an offer, so not counted.
  let booked = Boolean(opts.alreadyBooked)
  // A visit booked or moved in this reply (not one cancelled): nothing is left to tap.
  let bookedVisit = Boolean(opts.alreadyBooked)
  let rewritten = false
  // The times the booking tools confirmed in this reply, and whether a reply
  // stating a booking they did not make has already been sent back once.
  const done = new Set<string>()
  if (opts.alreadyBooked) {
    for (const t of clockTimes(JSON.stringify(opts.alreadyBooked.input))) done.add(t)
    toolUses.push({ name: 'book_appointment', input: opts.alreadyBooked.input, ok: true })
  }
  let claimRewritten = false
  // Whether a reply misstating the time of their own visit was sent back once.
  let timeRewritten = false
  // Whether a reply breaking the house style (styleProblems) was already
  // sent back once to be reworded.
  let styleRewritten = false
  // A finished turn with no words in it. Haiku did this on 22 Nov 2026: it
  // looked up the days a patient gave, called offer_times with two good
  // times, and ended the next turn empty -- the times were already "said" to
  // it. Empty reads as refused, so a move it had done right went to a person
  // at 23:11 on a Sunday. Sent back once to write the reply; if it is empty
  // again, the words it wrote beside its last offer_times call go instead.
  let emptyRewritten = false
  let offerWords = ''
  // What find_free_times answered in this reply, and whether a reply calling
  // free dates full has already been sent back once.
  const lookedUpTimes: FreeTimesSource[] = []
  let fullClaimRewritten = false
  // The language they write in, from their own messages (utils/receptionistLanguageCheck.ts),
  // and whether a reply in another one, or with English words in Spanish, has been sent back once.
  const theirs = theirLanguage(opts.messages.filter((m) => m.role === 'user').map((m) => messageText(m.content)))
  let languageRewritten = false
  for (let round = 0; ; round++) {
    const message = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      // Low effort: a short conversational reply, and somebody is waiting.
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system,
      messages: withTailBreakpoint(messages),
      ...(tools.length ? { tools, tool_choice: round < MAX_TOOL_ROUNDS ? { type: 'auto' as const } : { type: 'none' as const } } : {}),
    })
    usage.rounds++
    usage.inputTokens += message.usage?.input_tokens ?? 0
    usage.outputTokens += message.usage?.output_tokens ?? 0
    usage.cacheReadTokens += message.usage?.cache_read_input_tokens ?? 0
    usage.cacheWriteTokens += message.usage?.cache_creation_input_tokens ?? 0
    usage.cacheWrite1hTokens += message.usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0

    // Refusals arrive as HTTP 200, so the content has to be checked rather
    // than assumed.
    // Cut off at maxTokens: what is there is sent, but the trace says so.
    if (message.stop_reason === 'max_tokens') checks.push('max_tokens')

    if (message.stop_reason === 'refusal') {
      checks.push('model_refused')
      return run('', true)
    }

    const uses = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
    if (message.stop_reason !== 'tool_use' || uses.length === 0 || tools.length === 0) {
      let text = cleanReply(textOf(message.content))
      // No words: what it did says what to send. The times it offered are
      // data, and so is the visit it booked -- the words are written from
      // them, at once, rather than asked for again or the person passed on
      // for want of a sentence.
      const offering = choices === 'times' && offeredSlots.length > 0 && !bookedVisit
      if (!text && offering) {
        text = offerWords && wordsMatchOffer(clockTimes(offerWords), offeredSlots, { standing: opts.standingTimes, max: opts.maxTimesPerReply }) ? offerWords : offerInWords(offer?.slots ?? offeredSlots, language)
        checks.push(text === offerWords ? 'empty_offer_words_used' : 'empty_offer_in_code')
      }
      if (!text && bookedDetails && confirmationIsPlain(bookedDetails)) {
        text = confirmationInWords(bookedDetails, language)
        checks.push('empty_confirmation_in_code')
      }
      // Empty with nothing to write it from: asked for once more.
      if (!text && !emptyRewritten) {
        emptyRewritten = true
        checks.push('empty_rewritten')
        pushNote(messages, message.content, EMPTY_REPLY_NOTE)
        continue
      }
      // The words under which the buttons go have to offer those times: one
      // left out, or more times than the clinic allows, and the words are
      // written from the buttons instead of sent back to be written again.
      if (text && offering && !isNoReply(text) && !wordsMatchOffer(clockTimes(text), offeredSlots, { standing: opts.standingTimes, max: opts.maxTimesPerReply })) {
        text = offerInWords(offer?.slots ?? offeredSlots, language)
        checks.push('offer_words_in_code')
      }
      // Words that go with buttons were checked against them just above.
      const offered = opts.maxTimesPerReply && !booked && !rewritten && !offering ? offeredTimeCount(text) : 0
      if (opts.maxTimesPerReply && offered > opts.maxTimesPerReply) {
        rewritten = true
        checks.push('times_rewritten')
        messages.push({ role: 'assistant', content: message.content })
        messages.push({ role: 'user', content: tooManyTimesNote(offered, opts.maxTimesPerReply) })
        continue
      }
      const claim = opts.book && text ? unbookedClaim(text, done, opts.standingTimes ?? new Set()) : null
      if (claim) {
        // Told it was booked, they come to a visit nobody has. A second
        // attempt goes to a person instead (refused, so handed over).
        if (claimRewritten) {
          console.warn(`[receptionist] withheld a reply for ${opts.logLabel}: it states a booking it did not make`)
          checks.push('claim_withheld')
          return run('', true)
        }
        claimRewritten = true
        checks.push('claim_rewritten')
        messages.push({ role: 'assistant', content: message.content })
        messages.push({ role: 'user', content: unbookedClaimNote(claim, { noVisits: (opts.standingTimes?.size ?? 0) === 0 }) })
        continue
      }
      // Their visit's time is the diary's: a reply giving it another, because
      // they insisted, goes back once and is refused the second time.
      const misstated = opts.standingTimes && text ? misstatedVisitTime(text, done, opts.standingTimes) : null
      if (misstated) {
        if (timeRewritten) {
          console.warn(`[receptionist] withheld a reply for ${opts.logLabel}: it gives a visit a time the diary does not have`)
          checks.push('visit_time_withheld')
          return run('', true)
        }
        timeRewritten = true
        checks.push('visit_time_rewritten')
        messages.push({ role: 'assistant', content: message.content })
        messages.push({ role: 'user', content: misstatedVisitNote(misstated, opts.standingTimes!) })
        continue
      }
      // "No tenemos huecos por la mañana hasta el 14" while the list has a
      // morning in it (24 Nov 2026): back once with the times, refused the
      // second time. Not after a booking, which a second round must not be
      // tempted to repeat. A lookup narrowed to one chiropractor or someone
      // else is what such a sentence is then about, so the prompt's
      // team-wide list does not count against it.
      const fullClaim = opts.freeTimes && text && !booked && !isNoReply(text) ? noFreeTimeClaim(text, opts.freeTimes.from, opts.teamNames) : null
      const sources = lookedUpTimes.some((source) => source.scoped) ? lookedUpTimes : [...lookedUpTimes, ...(opts.freeTimes ? [opts.freeTimes] : [])]
      const contradicted = fullClaim ? contradictingTimes(fullClaim, sources) : null
      if (fullClaim && contradicted) {
        if (fullClaimRewritten) {
          console.warn(`[receptionist] withheld a reply for ${opts.logLabel}: it calls dates full that have free times`)
          checks.push('full_claim_withheld')
          return run('', true)
        }
        fullClaimRewritten = true
        checks.push('full_claim_rewritten')
        messages.push({ role: 'assistant', content: message.content })
        messages.push({ role: 'user', content: fullClaimNote(fullClaim, contradicted) })
        continue
      }
      // Their language, checked in code: "¿Also cancelo…?" in a Spanish
      // reply (22 Nov 2026), or a reply in English to someone writing in
      // Spanish. Back once, not after a booking; if it is still wrong it goes
      // as it is rather than leave them without an answer.
      const wrongLanguage = text && !booked && !languageRewritten && !isNoReply(text) ? languageProblem(text, theirs) : null
      if (wrongLanguage) {
        languageRewritten = true
        checks.push(wrongLanguage.kind === 'wrong_language' ? 'language_rewritten' : 'english_words_rewritten')
        messages.push({ role: 'assistant', content: message.content })
        messages.push({ role: 'user', content: languageNote(wrongLanguage) })
        continue
      }
      // The house style, checked in code (utils/receptionistStyle.ts): what
      // needs rewording goes back once -- not after a booking, which a second
      // round must not be tempted to repeat -- and the rest is mended here.
      const needsWords = text ? styleProblems(text, opts.teamNames).filter((problem) => !FIXED_IN_CODE.includes(problem)) : []
      if (needsWords.length && !styleRewritten && !booked) {
        styleRewritten = true
        checks.push('style_rewritten')
        messages.push({ role: 'assistant', content: message.content })
        messages.push({ role: 'user', content: styleNote(needsWords) })
        continue
      }
      const reply = text && !isNoReply(text) ? fixStyle(text, opts.teamNames) : text
      const leak = reply ? briefingLeak(reply, opts.internalNotes) : null
      if (leak) {
        console.warn(`[receptionist] withheld a draft for ${opts.logLabel}: it ${leak}`)
        checks.push('briefing_withheld')
        return run('', true)
      }
      // A promise that a colleague will do something is kept by telling one:
      // the reply goes with a handover whether or not the model called it.
      const promise = opts.handOver && !handedOver && reply && !isNoReply(reply) ? colleaguePromise(reply) : null
      if (promise) {
        handedOver = colleaguePromiseReason(promise)
        checks.push('promise_handed_over')
      }
      // Decided before the model was asked (mustHandOver): it goes to a
      // person with the reply, whatever the model made of it. Its own reason,
      // when it gave one, is kept; a "no reply" has nothing to go with.
      if (mustHandOver && !handedOver && reply && !isNoReply(reply)) {
        handedOver = mustHandOver
        checks.push('form_handed_over')
      }
      return run(reply, false)
    }

    // What it wrote beside an offer: the reply, should the turn after come back empty.
    if (uses.some((use) => use.name === 'offer_times')) {
      const words = cleanReply(textOf(message.content))
      if (words) offerWords = words
    }
    // The whole turn goes back, thinking blocks included and unchanged, and
    // every result in one message.
    messages.push({ role: 'assistant', content: message.content })
    const lookup = opts.findFreeTimes
    // One after another, not in parallel: two book_appointment calls in one
    // turn must not both pass the "already booked in this reply" check.
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const use of uses) {
      results.push(
        await (async (): Promise<Anthropic.ToolResultBlockParam> => {
        let result: { content: string; isError: boolean }
        if (use.name === 'book_appointment' && opts.book && mustHandOver) {
          result = { content: 'Not booked: what they wrote in the clinic\'s form goes to the chiropractor first. Do not say anything is booked and do not offer times: tell them the chiropractor will write to them.', isError: true }
        } else if (use.name === 'book_appointment' && opts.book) {
          result = await opts.book(use.input).catch((err) => {
            console.error('[receptionist] book_appointment failed:', (err as Error)?.message ?? err)
            return { content: 'The booking could not be made. Do not say it is booked: call hand_over_to_colleague with the day, time and type they accepted.', isError: true }
          })
          if (!result.isError) {
            booked = true
            bookedVisit = true
            bookedDetails = (result as { booked?: BookedDetails }).booked ?? null
          }
        } else if (use.name === 'cancel_appointment' && opts.cancel) {
          result = await opts.cancel(use.input).catch((err) => {
            console.error('[receptionist] cancel_appointment failed:', (err as Error)?.message ?? err)
            return { content: 'The visit could not be cancelled. Do not say it is cancelled: call hand_over_to_colleague saying which visit they want cancelled.', isError: true }
          })
          if (!result.isError) booked = true
        } else if (use.name === 'ask_why_cancelled' && opts.askWhyCancelled) {
          result = await opts.askWhyCancelled(use.input).catch((err) => {
            console.error('[receptionist] ask_why_cancelled failed:', (err as Error)?.message ?? err)
            return { content: 'The reasons cannot be sent. Ask them in one short sentence why they cannot come, without listing reasons.', isError: true }
          })
          if (!result.isError) choices = 'cancellation_reason'
        } else if (use.name === 'offer_times' && offerTimes && opts.heldTime) {
          // They already chose one (13 Nov 2026: asked for a daughter's name
          // instead of booking, the time was lost): not offered away now.
          result = { content: `Not offered: they already chose ${opts.heldTime.date} at ${opts.heldTime.time}, and it is held for them. Book that time, or ask only for what the booking still needs. Offer other times only if they say that one no longer suits them.`, isError: true }
        } else if (use.name === 'offer_times' && offerTimes) {
          result = await offerTimes(use.input, lookedUp).catch((err) => {
            console.error('[receptionist] offer_times failed:', (err as Error)?.message ?? err)
            return { content: 'The buttons cannot be sent. Offer the times in words only.', isError: true }
          })
          if (!result.isError) choices = 'times'
        } else if (use.name === 'write_back_on' && opts.writeBack) {
          result = await opts.writeBack(use.input).catch((err) => {
            console.error('[receptionist] write_back_on failed:', (err as Error)?.message ?? err)
            return { content: 'It could not be arranged. Do not promise to write: tell them they can write whenever they know.', isError: true }
          })
        } else if (use.name === 'record_cancellation_reason' && opts.cancellationReason) {
          result = await opts.cancellationReason(use.input).catch((err) => {
            console.error('[receptionist] record_cancellation_reason failed:', (err as Error)?.message ?? err)
            return { content: 'It could not be recorded. Just answer them.', isError: true }
          })
        } else if (use.name === 'give_visit_to' && opts.give) {
          result = await opts.give(use.input).catch((err) => {
            console.error('[receptionist] give_visit_to failed:', (err as Error)?.message ?? err)
            return { content: 'The visit could not be changed. Do not say it is changed: call hand_over_to_colleague saying whose it is, with their name and mobile.', isError: true }
          })
          if (!result.isError) booked = true
        } else if (use.name === 'stop_follow_ups' && opts.stopFollowUps) {
          result = await opts.stopFollowUps(use.input).catch((err) => {
            console.error('[receptionist] stop_follow_ups failed:', (err as Error)?.message ?? err)
            return { content: 'It could not be done. Call hand_over_to_colleague saying they have left, so a colleague takes them off the follow-ups.', isError: true }
          })
        } else if (use.name === 'stop_earlier_time_offers' && opts.stopEarlier) {
          result = await opts.stopEarlier(use.input).catch((err) => {
            console.error('[receptionist] stop_earlier_time_offers failed:', (err as Error)?.message ?? err)
            return { content: 'It could not be done. Call hand_over_to_colleague saying they do not want to be offered an earlier time.', isError: true }
          })
        } else if (use.name === 'add_to_waitlist' && opts.waitlist) {
          result = await opts.waitlist(use.input).catch((err) => {
            console.error('[receptionist] add_to_waitlist failed:', (err as Error)?.message ?? err)
            return { content: 'They could not be added to the waiting list. Call hand_over_to_colleague saying when they can come.', isError: true }
          })
        } else if (use.name === 'find_free_times' && lookup) {
          result = await lookup(use.input).catch((err) => {
            console.error('[receptionist] find_free_times failed:', (err as Error)?.message ?? err)
            return { content: 'The calendar could not be read. Do not offer a time: say your colleague will confirm an exact time shortly.', isError: true }
          })
          if (!result.isError) {
            const source = (result as { source?: FreeTimesSource }).source
            if (source) lookedUpTimes.push(source)
            const looked = (use.input ?? {}) as { any_chiropractor?: unknown; chiropractor?: unknown; for_name?: unknown }
            lookedUp = { anyChiropractor: looked.any_chiropractor === true, chiropractor: typeof looked.chiropractor === 'string' ? looked.chiropractor : null, forName: typeof looked.for_name === 'string' ? looked.for_name : null }
          }
        } else if (use.name === 'hand_over_to_colleague' && opts.handOver) {
          const reason = String((use.input as { reason?: unknown })?.reason ?? '').trim().slice(0, 300)
          // The handover stands either way: a reason that says nothing is
          // asked for again, never a cause to lose the handover itself.
          if (handoverReasonSaysNothing(reason)) {
            handedOver = handedOver ?? UNEXPLAINED_HANDOVER_REASON
            result = { content: `Your colleagues have been told, but "${reason}" tells them nothing. Call hand_over_to_colleague again with the reason as one full sentence in Spanish: what the person needs and why you handed it over.`, isError: true }
          } else {
            handedOver = reason
            // Handed over for what their form said, not for what they asked:
            // the question still gets its answer in the last message.
            result = mustHandOver
              ? { content: 'Done: the chiropractor has been told, and you will not answer in this conversation until someone at the clinic has. Now write your last message, in two parts: first answer what they asked in their last message (a price they asked for, in euros), then tell them you have passed what they described on to the chiropractor, who will write to them. Do not offer times and do not promise when.', isError: false }
              : { content: 'Done: your colleagues have been told, and you will not answer in this conversation until one of them has. Now write your last message: tell them your colleague will pick this up shortly. Do not promise a time.', isError: false }
          }
        } else {
          result = { content: `There is no tool called ${use.name}.`, isError: true }
        }
        if (!result.isError && (use.name === 'book_appointment' || use.name === 'cancel_appointment' || use.name === 'give_visit_to')) {
          for (const t of clockTimes(JSON.stringify(use.input ?? {}))) done.add(t)
        }
        toolUses.push({ name: use.name, input: (use.input ?? {}) as Record<string, unknown>, ok: !result.isError })
        return { type: 'tool_result', tool_use_id: use.id, content: result.content, is_error: result.isError }
        })(),
      )
    }
    messages.push({ role: 'user', content: results })
  }
}

const HAND_OVER: Anthropic.Tool = {
  name: 'hand_over_to_colleague',
  description:
    'Passes this conversation to a person at the clinic. Call it whenever a rule under "Stop and hand over to a person when" applies, when they want something you cannot do, or when you are not sure what to answer. Your colleagues are notified and you stop answering here until one of them has written. After calling it, tell the person your colleague will pick this up shortly.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'For your colleagues, in one short sentence in Spanish whatever language the conversation is in: what they need and why you handed it over. It is shown to them as written, after "Motivo:".' },
    },
    required: ['reason'],
    additionalProperties: false,
  },
}
