import type Anthropic from '@anthropic-ai/sdk'
import { NO_REPLY } from './receptionistAutoReply'
import { baseBehaviourSection, escalationSection } from './receptionistBaseRules'
import { clinicDetailsSection, teamSection, type PromptClinic } from './receptionistClinic'
import { CARD_ANSWERS_LINE, historyMarkersSection, INFORMAL_ADDRESS_LINE, LATER_ANSWER_LINE, NO_INVENTION_LINE, NOT_CHIROPRACTIC_SYMPTOM_LINE, PART_OF_DAY_ANSWER_LINE, REPLY_DETAILS_LINE, replyLanguageLine, SENT_FILES_LINE, STATED_LIMITS_LINE } from './receptionistHistory'

// A receptionist briefing comes in three parts, so the expensive one is paid
// for once rather than on every reply.
//
// Measured on 12-14 Oct 2026, before the first split: about 12,000 input
// tokens per reply, nothing cached, and input was 95% of the bill. Most of
// those tokens are the same for every conversation at a clinic -- the
// persona, the rules, the clinic's knowledge cards -- but the clock sat near
// the top of the prompt, so the start of every request was different and
// nothing could be reused. Caching is a prefix match: one changed byte
// invalidates everything after it.
//
// So the builders (buildSystemPrompt, buildPatientReplyPrompt) return the
// part that only changes when the clinic edits its settings separately from
// the part about this person and this moment, and runReceptionistModel
// marks the first for caching. Anything that varies by person, by time or by
// what is free in the calendar belongs in `conversation`; putting it in
// `clinic` does not break a reply, it silently makes every reply pay full
// price again.
//
// `clinic` is also the same for leads and patients (21 Nov 2026). Each was
// its own cache entry until then, and an hour-long entry that only leads, or
// only patients, read expires far more often than one both read: 76 of the 83
// replies that rewrote it between 10 and 21 Nov came over an hour after the
// last reply of the same kind, often minutes after one of the other kind. A
// write is ~16,000 tokens at twice the input price -- about $0.06 each, half
// the receptionist's bill. What differs between a lead and a patient is the
// short `role` after it, cached at its own breakpoint, so a lead after a
// patient pays a few hundred tokens rather than the whole clinic again.
export interface ReceptionistPrompt {
  /** The same for every conversation at this clinic, lead or patient, in this mode (draft or sent as it is). */
  clinic: string
  /** Who is writing -- a lead or one of the clinic's patients -- and how the reply goes out: the same for every lead (or every patient) at this clinic. */
  role: string
  /** This person and this moment: the clock, who they are, their visits, the free times. */
  conversation: string
}

/** The whole briefing as one text, as the model reads it. */
export function receptionistPromptText(prompt: ReceptionistPrompt): string {
  return [prompt.clinic, prompt.role, prompt.conversation].filter(Boolean).join('\n\n')
}

/**
 * The clinic part, for both builders. One function, so that a lead's and a
 * patient's are the same bytes and share one cache entry: a reworded line in
 * one builder and not the other would silently split them again.
 */
export function clinicPromptPart(opts: {
  personaName: string
  toneLine: string
  languages: string[]
  clinicDetails: PromptClinic[]
  team: string[]
  knowledge: { title: string; lines: string[] }[]
  /** What stands in for the knowledge when the clinic has written none ('' for nothing). */
  noKnowledge: string
  escalationRules: { rule: string; action: string }[]
  neverSays: string | null | undefined
  sendsItself: boolean
}): string {
  const knowledge = opts.knowledge
    .map((card) => `## ${card.title}\n${card.lines.map((line) => `- ${line}`).join('\n')}`)
    .join('\n\n')
  return [
    `You are ${opts.personaName}, the receptionist for a chiropractic clinic.`,
    `Tone: ${opts.toneLine}`,
    // "Un compañero" is how a call centre talks about whoever is next in the
    // queue; a receptionist hands you to someone she works with.
    `When something goes to a member of staff, speak of them as your own colleague: in Spanish "mi compañera" or "mi compañero" (for example "Se lo paso a mi compañera, la quiropráctica"), in English "my colleague". Never "un compañero", "un miembro del equipo" or "a colleague".`,
    // Dates come to the model as "Monday 2026-10-20", which it otherwise
    // copies out as "20/10" -- correct, and the least human way to say it.
    `Write dates in words, in the patient's language, with the weekday: "el lunes 20 de octubre", "Monday 20 October". Never "20/10" or "2026-10-20".`,
    replyLanguageLine(opts.languages),
    clinicDetailsSection(opts.clinicDetails),
    teamSection(opts.team),
    baseBehaviourSection(),
    knowledge ? `# What you know about this clinic\n\n${knowledge}` : opts.noKnowledge,
    // Not every message wants an answer: a "Confirmar" tapped on the reminder,
    // a thanks. A re-confirmation nobody asked for is noise in their WhatsApp.
    `If their latest message needs no answer at all -- a thank-you, an "ok", a confirmation of a visit they already have, an emoji -- write exactly ${NO_REPLY} and nothing else. Nothing is then sent.`,
    historyMarkersSection(opts.sendsItself),
    INFORMAL_ADDRESS_LINE,
    NO_INVENTION_LINE,
    PART_OF_DAY_ANSWER_LINE,
    SENT_FILES_LINE,
    LATER_ANSWER_LINE,
    REPLY_DETAILS_LINE,
    STATED_LIMITS_LINE,
    CARD_ANSWERS_LINE,
    NOT_CHIROPRACTIC_SYMPTOM_LINE,
    escalationSection(opts.escalationRules, opts.sendsItself),
    opts.neverSays ? `# Never\n\n${opts.neverSays}` : '',
  ].filter(Boolean).join('\n\n')
}

/** The heading the role part opens with, so its first lines are not read as more of "Never". */
export const ROLE_HEADING = '# Who is writing to you'

/**
 * The system prompt as sent: the clinic and the role each cached for an hour,
 * at their own breakpoints, and this conversation after them, not cached.
 *
 * An hour, not the 5-minute default: a clinic's replies are minutes apart in
 * the day but rarely five, and a read refreshes the hour.
 */
export function receptionistSystemBlocks(prompt: ReceptionistPrompt): Anthropic.TextBlockParam[] {
  return [
    { type: 'text' as const, text: prompt.clinic, cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } },
    ...(prompt.role ? [{ type: 'text' as const, text: prompt.role, cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } }] : []),
    { type: 'text' as const, text: prompt.conversation },
  ].filter((block) => block.text)
}

/**
 * The messages as sent on one round of a reply, with a 5-minute breakpoint on
 * the last block, so that the next round -- after find_free_times, a booking,
 * a rewrite -- reads what this one sent instead of paying for it again.
 *
 * It costs a quarter more on the conversation in every reply's first round
 * and saves nine tenths of it in every later one, so it pays once more than
 * about one reply in four takes a second round. On 14 Oct one in six did and
 * it was taken out; between 10 and 21 Nov it was 112 extra rounds in 210
 * replies, and about $0.003 a reply saved.
 *
 * A copy: the breakpoint is on the newest block only, never left on an
 * earlier round's (four per request at most, and three are already used).
 * Text given as a plain string becomes the one text block it stands for,
 * on every message, so the prefix reads the same from round to round.
 */
export function withTailBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map((message, i) => {
    const blocks: Anthropic.ContentBlockParam[] = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : [...message.content]
    if (i === messages.length - 1 && blocks.length) {
      const last = blocks[blocks.length - 1]!
      blocks[blocks.length - 1] = { ...last, cache_control: { type: 'ephemeral', ttl: '5m' } } as Anthropic.ContentBlockParam
    }
    return { ...message, content: blocks }
  })
}
