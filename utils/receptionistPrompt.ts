// A receptionist briefing comes in two parts, so the expensive one is paid
// for once rather than on every reply.
//
// Measured on 12-14 Oct 2026, before this split: about 12,000 input tokens
// per reply, nothing cached, and input was 95% of the bill. Most of those
// tokens are the same for every conversation at a clinic -- the persona, the
// rules, the clinic's knowledge cards -- but the clock sat near the top of
// the prompt, so the start of every request was different and nothing could
// be reused. Caching is a prefix match: one changed byte invalidates
// everything after it.
//
// So the builders (buildSystemPrompt, buildPatientReplyPrompt) return the
// part that only changes when the clinic edits its settings separately from
// the part about this person and this moment, and runReceptionistModel
// marks the first for caching. Anything that varies by person, by time or by
// what is free in the calendar belongs in `conversation`; putting it in
// `clinic` does not break a reply, it silently makes every reply pay full
// price again.
export interface ReceptionistPrompt {
  /** The same for every conversation at this clinic, in this mode (draft or sent as it is). */
  clinic: string
  /** This person and this moment: the clock, who they are, their visits, the free times. */
  conversation: string
}

/** The whole briefing as one text, as the model reads it. */
export function receptionistPromptText(prompt: ReceptionistPrompt): string {
  return `${prompt.clinic}\n\n${prompt.conversation}`
}
