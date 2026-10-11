import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { loadReceptionistCalendar, type OfferedType, type ReceptionistConfig } from '~/server/utils/receptionist'
import { availabilityLists, FREE_TIMES_MAX_DAYS, FREE_TIMES_MAX_TIMES, parseFreeTimesInput } from '~/utils/receptionistSlots'
import { clinicDateOf, startOfLocalDate } from '~/utils/clinicClock'

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
    })
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
 * Throws the SDK's errors, for the caller to word (modelFailureMessage).
 */
export async function runReceptionistModel(
  client: Anthropic,
  opts: { model: string; maxTokens: number; system: string; messages: Anthropic.MessageParam[]; findFreeTimes?: FreeTimesLookup | null },
): Promise<{ text: string; refused: boolean }> {
  const messages: Anthropic.MessageParam[] = [...opts.messages]
  for (let round = 0; ; round++) {
    const message = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      // Low effort: a short conversational reply, and somebody is waiting.
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: opts.system,
      messages,
      ...(opts.findFreeTimes ? { tools: [FIND_FREE_TIMES], tool_choice: round < MAX_TOOL_ROUNDS ? { type: 'auto' as const } : { type: 'none' as const } } : {}),
    })

    // Refusals arrive as HTTP 200, so the content has to be checked rather
    // than assumed.
    if (message.stop_reason === 'refusal') return { text: '', refused: true }

    const uses = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
    if (message.stop_reason !== 'tool_use' || uses.length === 0 || !opts.findFreeTimes) {
      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim()
      return { text, refused: false }
    }

    // The whole turn goes back, thinking blocks included and unchanged, and
    // every result in one message.
    messages.push({ role: 'assistant', content: message.content })
    const lookup = opts.findFreeTimes
    const results = await Promise.all(
      uses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        const result =
          use.name === 'find_free_times'
            ? await lookup(use.input).catch((err) => {
                console.error('[receptionist] find_free_times failed:', (err as Error)?.message ?? err)
                return { content: 'The calendar could not be read. Do not offer a time: say your colleague will confirm an exact time shortly.', isError: true }
              })
            : { content: `There is no tool called ${use.name}.`, isError: true }
        return { type: 'tool_result', tool_use_id: use.id, content: result.content, is_error: result.isError }
      }),
    )
    messages.push({ role: 'user', content: results })
  }
}
