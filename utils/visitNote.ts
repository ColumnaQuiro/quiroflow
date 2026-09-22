// What a visit note is made of.
//
// A note is stored as one text column, but it is not free text: the charting
// pane writes it as four labelled sections separated by blank lines --
//
//   Subjective: ...
//
//   Objective: ...
//
//   Action: ...
//
//   Plan: ...
//
// and reads them back the same way. That convention lived privately inside
// ExamAutofill.vue, which meant the only component that could show a note
// with its structure intact was the one that wrote it. Everywhere else got
// a wall of text with the labels still in it.
//
// It is here so the writer and every reader share one definition. The
// sections are the app's own, not textbook SOAP: the third is Action, not
// Assessment, because that is what this charting pane has always called it
// and renaming it in the reader would misreport what the practitioner
// actually filled in.
export const NOTE_SECTIONS = ['Subjective', 'Objective', 'Action', 'Plan'] as const
export type NoteSection = (typeof NOTE_SECTIONS)[number]

export interface ParsedNote {
  /** The labelled sections that were present, in the order above. */
  sections: { label: NoteSection; text: string }[]
  /**
   * Everything that did not parse into a section. A note typed before the
   * convention existed, or pasted in, is all preamble -- and it is shown as
   * itself rather than silently dropped, which is the failure mode of
   * parsing text you did not write.
   */
  preamble: string
  /** Whether this note follows the convention at all. */
  structured: boolean
}

export function parseVisitNote(body: string | null): ParsedNote {
  if (!body?.trim()) return { sections: [], preamble: '', structured: false }

  const found = new Map<NoteSection, string>()
  const leftovers: string[] = []

  for (const chunk of body.split('\n\n')) {
    const idx = chunk.indexOf(':')
    const label = idx === -1 ? null : chunk.slice(0, idx).trim()
    if (label && (NOTE_SECTIONS as readonly string[]).includes(label)) {
      const text = chunk.slice(idx + 1).trim()
      if (text) found.set(label as NoteSection, text)
    } else if (chunk.trim()) {
      leftovers.push(chunk.trim())
    }
  }

  return {
    sections: NOTE_SECTIONS.filter((s) => found.has(s)).map((label) => ({ label, text: found.get(label)! })),
    preamble: leftovers.join('\n\n'),
    structured: found.size > 0,
  }
}

/** The one line shown for a collapsed note, whatever shape it is in. */
export function visitNotePreview(body: string | null, maxLength = 120): string {
  const parsed = parseVisitNote(body)
  // Subjective first: it is what the patient said, which is what someone
  // scanning a list of past visits is looking for.
  const source = parsed.sections[0]?.text ?? parsed.preamble
  const flat = source.replace(/\s+/g, ' ').trim()
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat
}
