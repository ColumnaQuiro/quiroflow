import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { loadReceptionistCalendar, type OfferedType, type ReceptionistConfig } from '~/server/utils/receptionist'
import { availabilityLists, FREE_TIMES_MAX_DAYS, FREE_TIMES_MAX_TIMES, parseFreeTimesInput } from '~/utils/receptionistSlots'
import { clinicDateOf, startOfLocalDate } from '~/utils/clinicClock'
import { briefingLeak } from '~/utils/receptionistGuard'
import { ADD_TO_WAITLIST, BOOK_APPOINTMENT } from '~/server/utils/receptionistBooking'
import { cleanReply, offeredTimeCount, tooManyTimesNote } from '~/utils/receptionistHistory'

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
const MAX_TOOL_ROUNDS = 3

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
    },
    required: ['from_date'],
    additionalProperties: false,
  },
}

export type FreeTimesLookup = (input: unknown) => Promise<{ content: string; isError: boolean }>

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
): FreeTimesLookup {
  return async (input) => {
    const now = new Date()
    const query = parseFreeTimesInput(input, clinicDateOf(now, timeZone))
    if ('error' in query) return { content: query.error, isError: true }

    const chosen = query.typeName ? types.filter((type) => type.name.toLowerCase() === query.typeName!.toLowerCase()) : types
    if (chosen.length === 0) {
      return { content: `"${query.typeName}" is not a type you can offer. Use one of: ${types.map((type) => type.name).join(', ')}.`, isError: true }
    }

    const calendar = await loadReceptionistCalendar(calendarClient, accountId, config, chosen, now, {
      from: startOfLocalDate(query.from, timeZone),
      days: query.days,
      maxTimesPerList: FREE_TIMES_MAX_TIMES,
    }, practitionerIds)
    if (!calendar.availability) {
      return { content: 'The calendar could not be read. Do not offer a time: ask which days suit them and say your colleague will confirm an exact time shortly.', isError: true }
    }
    const span = `the ${query.days} day${query.days === 1 ? '' : 's'} from ${query.from}`
    return {
      content: [`Free start times for ${span}, in the clinic's local time. A day not listed has nothing free.`, ...availabilityLists(calendar.availability, `in ${span}`)].join('\n\n'),
      isError: false,
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
export async function runReceptionistModel(
  client: Anthropic,
  opts: {
    model: string
    maxTokens: number
    system: string
    messages: Anthropic.MessageParam[]
    findFreeTimes?: FreeTimesLookup | null
    /**
     * Offer hand_over_to_colleague: on when the reply is sent without a
     * person reading it first, so that what a draft's reader would have
     * caught -- an escalation rule, something it cannot do -- reaches a
     * person anyway. Its reason comes back as `handedOver`.
     */
    handOver?: boolean
    /**
     * Offer book_appointment (receptionistBooking.ts): only when the reply is
     * sent without review, so a calendar change is never made behind a draft
     * a person has not read yet.
     */
    book?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /** Offer add_to_waitlist (receptionistBooking.ts): same terms as `book`. */
    waitlist?: ((input: unknown) => Promise<{ content: string; isError: boolean }>) | null
    /**
     * The clinic's limit on times offered in one reply. A reply over it is
     * written again once (offeredTimeCount): told "at most 2", it offered one
     * person five.
     */
    maxTimesPerReply?: number
    /** The clinic's text that is not for patients (internalNotes). */
    internalNotes: string[]
    /** Names the conversation in the log when a draft is withheld; never its content. */
    logLabel: string
  },
): Promise<{ text: string; refused: boolean; handedOver: string | null }> {
  const messages: Anthropic.MessageParam[] = [...opts.messages]
  const tools: Anthropic.Tool[] = [
    ...(opts.findFreeTimes ? [FIND_FREE_TIMES] : []),
    ...(opts.handOver ? [HAND_OVER] : []),
    ...(opts.book ? [BOOK_APPOINTMENT] : []),
    ...(opts.waitlist ? [ADD_TO_WAITLIST] : []),
  ]
  let handedOver: string | null = null
  // A booking's confirmation names its time (and a move, the old one too):
  // not an offer, so not counted.
  let booked = false
  let rewritten = false
  for (let round = 0; ; round++) {
    const message = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      // Low effort: a short conversational reply, and somebody is waiting.
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: opts.system,
      messages,
      ...(tools.length ? { tools, tool_choice: round < MAX_TOOL_ROUNDS ? { type: 'auto' as const } : { type: 'none' as const } } : {}),
    })

    // Refusals arrive as HTTP 200, so the content has to be checked rather
    // than assumed.
    if (message.stop_reason === 'refusal') return { text: '', refused: true, handedOver }

    const uses = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
    if (message.stop_reason !== 'tool_use' || uses.length === 0 || tools.length === 0) {
      const text = cleanReply(
        message.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      )
      const offered = opts.maxTimesPerReply && !booked && !rewritten ? offeredTimeCount(text) : 0
      if (opts.maxTimesPerReply && offered > opts.maxTimesPerReply) {
        rewritten = true
        messages.push({ role: 'assistant', content: message.content })
        messages.push({ role: 'user', content: tooManyTimesNote(offered, opts.maxTimesPerReply) })
        continue
      }
      const leak = text ? briefingLeak(text, opts.internalNotes) : null
      if (leak) {
        console.warn(`[receptionist] withheld a draft for ${opts.logLabel}: it ${leak}`)
        return { text: '', refused: true, handedOver }
      }
      return { text, refused: false, handedOver }
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
        if (use.name === 'book_appointment' && opts.book) {
          result = await opts.book(use.input).catch((err) => {
            console.error('[receptionist] book_appointment failed:', (err as Error)?.message ?? err)
            return { content: 'The booking could not be made. Do not say it is booked: call hand_over_to_colleague with the day, time and type they accepted.', isError: true }
          })
          if (!result.isError) booked = true
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
        } else if (use.name === 'hand_over_to_colleague' && opts.handOver) {
          const reason = String((use.input as { reason?: unknown })?.reason ?? '').trim().slice(0, 300)
          handedOver = reason || 'No reason given'
          result = { content: 'Done: your colleagues have been told, and you will not answer in this conversation until one of them has. Now write your last message: tell them your colleague will pick this up shortly. Do not promise a time.', isError: false }
        } else {
          result = { content: `There is no tool called ${use.name}.`, isError: true }
        }
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
      reason: { type: 'string', description: 'For your colleagues, in one short sentence in the clinic\'s language: what they need and why you handed it over.' },
    },
    required: ['reason'],
    additionalProperties: false,
  },
}
