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

  const found = new Map<NoteSection, string[]>()
  const leftovers: string[] = []
  // The section the paragraphs being read belong to. A blank line separates
  // the sections, but a section can hold blank lines of its own -- a
  // Subjective typed as three paragraphs is written as one section with two
  // blank lines inside it. Splitting on the blank line alone kept only the
  // first paragraph and pushed the rest out as loose text, which the clinical
  // tab draws after the last section: a patient's history read as if it
  // were the Plan (reported 6 Oct 2026). So a paragraph that does not open
  // with a label continues the section above it; only text before the first
  // label is preamble.
  let current: NoteSection | null = null

  for (const chunk of body.split('\n\n')) {
    const idx = chunk.indexOf(':')
    const label = idx === -1 ? null : chunk.slice(0, idx).trim()
    if (label && (NOTE_SECTIONS as readonly string[]).includes(label)) {
      current = label as NoteSection
      found.set(current, [chunk.slice(idx + 1).trim()])
    } else if (!chunk.trim()) {
      continue
    } else if (current) {
      found.get(current)!.push(chunk.trim())
    } else {
      leftovers.push(chunk.trim())
    }
  }

  const texts = new Map<NoteSection, string>()
  for (const [label, paragraphs] of found) {
    const text = paragraphs.filter(Boolean).join('\n\n')
    if (text) texts.set(label, text)
  }

  return {
    sections: NOTE_SECTIONS.filter((s) => texts.has(s)).map((label) => ({ label, text: texts.get(label)! })),
    preamble: leftovers.join('\n\n'),
    structured: texts.size > 0,
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
