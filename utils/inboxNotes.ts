// Internal Inbox notes (inbox_notes): where they sit among the messages, and
// how their @mentions are written and read back. Pure, with no `~` imports:
// the staff app auto-imports this directory too.

export interface InboxNote {
  id: string
  conversation_key: string
  author_id: string | null
  body: string
  mentions: string[]
  created_at: string
}

/** The notes after `from` (exclusive) and up to `to` (inclusive); either end may be open. */
export function notesBetween(notes: InboxNote[], from: string | null, to: string | null): InboxNote[] {
  const a = from ? Date.parse(from) : -Infinity
  const b = to ? Date.parse(to) : Infinity
  return notes.filter((n) => {
    const at = Date.parse(n.created_at)
    return at > a && at <= b
  })
}

/** The colleagues still named in the text, as "@Full Name": a mention deleted from the text is not sent. */
export function mentionedIn(body: string, team: { id: string; full_name: string }[]): string[] {
  // Read the way they are drawn, longest name first: "@Ana Gil" is not also "@Ana".
  const named = new Set(mentionParts(body, team.map((m) => m.full_name)).filter((p) => p.mention).map((p) => p.text.slice(1)))
  return team.filter((m) => named.has(m.full_name)).map((m) => m.id)
}

/** The text split into plain runs and @mentions of the people it names, longest names first. */
export function mentionParts(body: string, names: string[]): { text: string; mention: boolean }[] {
  const sorted = [...new Set(names.filter(Boolean))].sort((x, y) => y.length - x.length)
  const out: { text: string; mention: boolean }[] = []
  let rest = body
  while (rest) {
    let best: { at: number; name: string } | null = null
    for (const name of sorted) {
      const at = rest.indexOf(`@${name}`)
      if (at !== -1 && (!best || at < best.at)) best = { at, name }
    }
    if (!best) {
      out.push({ text: rest, mention: false })
      break
    }
    if (best.at > 0) out.push({ text: rest.slice(0, best.at), mention: false })
    out.push({ text: `@${best.name}`, mention: true })
    rest = rest.slice(best.at + best.name.length + 1)
  }
  return out
}

/** The word being typed after an "@", if the caret is in one: what to suggest colleagues for. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/\n/.test(query) || query.length > 30) return null
  return { start: at, query }
}
