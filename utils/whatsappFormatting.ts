// WhatsApp's text formatting, for the template creator: putting the markers
// in (and taking them out again) around what the clinic selected, and reading
// a message back the way the patient's phone will draw it, for the preview.
//
// The markers are plain characters in the text Meta stores; it is WhatsApp on
// the phone that draws them. So a template body takes the same formatting as
// any message: *bold*, _italic_, ~strikethrough~, ```monospace```, `inline
// code`, and lines that start "- " (a list), "1. " (a numbered list) or "> "
// (a quote). The heading takes none of it -- Meta: "Do not use Markdown
// special characters in this component" -- and templateDraftProblems refuses
// it there.

export type WhatsAppStyle = 'bold' | 'italic' | 'strike' | 'mono' | 'code'
export type WhatsAppLineKind = 'bullet' | 'numbered' | 'quote'

export const WHATSAPP_MARKERS: Record<WhatsAppStyle, string> = { bold: '*', italic: '_', strike: '~', mono: '```', code: '`' }

/** A text and the selection to leave in it. */
export interface WhatsAppEdit {
  text: string
  start: number
  end: number
}

/** A stretch of a line drawn with the same styles. */
export interface WhatsAppRun {
  text: string
  styles: WhatsAppStyle[]
}

/** One line of a message as WhatsApp draws it. `marker` is what a list shows before it ("•", "2."). */
export interface WhatsAppLine {
  kind: 'text' | WhatsAppLineKind
  marker: string
  runs: WhatsAppRun[]
}

// A marker that sits against a letter or a digit is not a marker: snake_case
// and 2*3 stay as they are.
const WORD = /[\p{L}\p{N}]/u
const SPACE = /\s/

/** Whether `marker` is at `i` on its own, not part of a longer run of the same character (` inside ```). */
function markerAt(text: string, i: number, marker: string): boolean {
  if (i < 0 || !text.startsWith(marker, i)) return false
  const c = marker[0]
  return text[i - 1] !== c && text[i + marker.length] !== c
}

/** [start, end) of each line the range covers, without its surrounding spaces; lines with nothing on them left out. */
function lineSegments(text: string, start: number, end: number): [number, number][] {
  const out: [number, number][] = []
  let from = start
  while (from <= end) {
    const nl = text.indexOf('\n', from)
    const to = nl === -1 || nl > end ? end : nl
    let s = from
    let e = to
    while (s < e && SPACE.test(text[s]!)) s++
    while (e > s && SPACE.test(text[e - 1]!)) e--
    if (e > s) out.push([s, e])
    if (to === end) break
    from = to + 1
  }
  return out
}

/** Whether [s, e) is itself `marker` + something + `marker`. */
const wrappedWithin = (text: string, s: number, e: number, m: string) =>
  e - s > 2 * m.length && markerAt(text, s, m) && markerAt(text, e - m.length, m)

/**
 * Puts the style's markers around the selection, or takes them away when it
 * already has them (selected with the markers or without). Each line is
 * wrapped on its own, because WhatsApp only draws * _ ~ and ` within a line;
 * ``` takes the whole selection, line breaks and all.
 *
 * The markers go against the text, not around the spaces at its edges:
 * WhatsApp does not draw "* hola *" as bold.
 *
 * With nothing selected, puts an empty pair in and leaves the cursor inside.
 */
export function toggleWhatsAppStyle(text: string, start: number, end: number, style: WhatsAppStyle): WhatsAppEdit {
  const m = WHATSAPP_MARKERS[style]
  const s = Math.max(0, Math.min(start, end, text.length))
  const e = Math.min(text.length, Math.max(start, end))

  // The markers just outside the selection: "*|hola|*".
  if (e > s && markerAt(text, s - m.length, m) && markerAt(text, e, m)) {
    return {
      text: text.slice(0, s - m.length) + text.slice(s, e) + text.slice(e + m.length),
      start: s - m.length,
      end: e - m.length,
    }
  }

  const lines = lineSegments(text, s, e)
  if (lines.length === 0) {
    return { text: text.slice(0, e) + m + m + text.slice(e), start: e + m.length, end: e + m.length }
  }
  const segments: [number, number][] = style === 'mono' ? [[lines[0]![0], lines.at(-1)![1]]] : lines

  const unwrap = segments.every(([a, b]) => wrappedWithin(text, a, b, m))
  let out = ''
  let cursor = 0
  let newStart = 0
  let newEnd = 0
  // The selection that comes back covers the text itself, not the markers.
  segments.forEach(([a, b], i) => {
    out += text.slice(cursor, a)
    if (!unwrap) out += m
    if (i === 0) newStart = out.length
    out += unwrap ? text.slice(a + m.length, b - m.length) : text.slice(a, b)
    newEnd = out.length
    if (!unwrap) out += m
    cursor = b
  })
  out += text.slice(cursor)
  return { text: out, start: newStart, end: newEnd }
}

const LINE_PREFIX: Record<WhatsAppLineKind, RegExp> = {
  bullet: /^[*-] /,
  numbered: /^\d+\. /,
  quote: /^> ?/,
}
const ANY_PREFIX = /^(?:[*-] |\d+\. |> ?)/

/**
 * Makes the lines the selection touches a bulleted list, a numbered list or a
 * quote -- or plain lines again when every one of them already is. A line
 * that is another kind of list changes kind. Empty lines stay empty and are
 * not counted in the numbering.
 */
export function toggleWhatsAppLines(text: string, start: number, end: number, kind: WhatsAppLineKind): WhatsAppEdit {
  const s = Math.max(0, Math.min(start, end, text.length))
  let e = Math.min(text.length, Math.max(start, end))
  // A selection that ends at the start of a line does not reach into it.
  if (e > s && text[e - 1] === '\n') e--
  const blockStart = text.lastIndexOf('\n', s - 1) + 1
  const nl = text.indexOf('\n', e)
  const blockEnd = nl === -1 ? text.length : nl
  const lines = text.slice(blockStart, blockEnd).split('\n')

  const filled = lines.filter((l) => l.trim())
  const remove = filled.length > 0 && filled.every((l) => LINE_PREFIX[kind].test(l))
  let n = 0
  const next = lines.map((line) => {
    if (remove) return line.replace(LINE_PREFIX[kind], '')
    if (!line.trim() && lines.length > 1) return line
    const bare = line.replace(ANY_PREFIX, '')
    n++
    return (kind === 'bullet' ? '- ' : kind === 'numbered' ? `${n}. ` : '> ') + bare
  })
  const block = next.join('\n')
  const out = text.slice(0, blockStart) + block + text.slice(blockEnd)
  const blockOut = blockStart + block.length
  return start === end ? { text: out, start: blockOut, end: blockOut } : { text: out, start: blockStart, end: blockOut }
}

/** Puts `insert` in place of the selection and the cursor after it. */
export function insertWhatsAppText(text: string, start: number, end: number, insert: string): WhatsAppEdit {
  const s = Math.max(0, Math.min(start, end, text.length))
  const e = Math.min(text.length, Math.max(start, end))
  const at = s + insert.length
  return { text: text.slice(0, s) + insert + text.slice(e), start: at, end: at }
}

const INLINE: Partial<Record<string, WhatsAppStyle>> = { '*': 'bold', _: 'italic', '~': 'strike' }

/** The styled stretch that opens at `i`, if one does: its style, what is inside, and where it ends. */
function styleAt(text: string, i: number): { style: WhatsAppStyle; inner: string; end: number } | null {
  if (text.startsWith('```', i)) {
    const close = text.indexOf('```', i + 3)
    return close > i + 3 ? { style: 'mono', inner: text.slice(i + 3, close), end: close + 3 } : null
  }
  const c = text[i]!
  if (c === '`') {
    const close = text.indexOf('`', i + 1)
    return close > i + 1 ? { style: 'code', inner: text.slice(i + 1, close), end: close + 1 } : null
  }
  const style = INLINE[c]
  if (!style) return null
  const before = text[i - 1]
  const after = text[i + 1]
  if ((before && WORD.test(before)) || !after || SPACE.test(after) || after === c) return null
  for (let j = text.indexOf(c, i + 2); j !== -1; j = text.indexOf(c, j + 1)) {
    const next = text[j + 1]
    if (!SPACE.test(text[j - 1]!) && !(next && WORD.test(next))) return { style, inner: text.slice(i + 1, j), end: j + 1 }
  }
  return null
}

function inlineRuns(text: string, styles: WhatsAppStyle[] = []): WhatsAppRun[] {
  const runs: WhatsAppRun[] = []
  const push = (t: string, st: WhatsAppStyle[]) => {
    if (!t) return
    const last = runs.at(-1)
    if (last && last.styles.join() === st.join()) last.text += t
    else runs.push({ text: t, styles: st })
  }
  let plain = ''
  let i = 0
  while (i < text.length) {
    const found = styleAt(text, i)
    if (!found) {
      plain += text[i]
      i++
      continue
    }
    push(plain, styles)
    plain = ''
    const inside = [...styles, found.style]
    // Nothing is formatted inside code: the markers there are just characters.
    if (found.style === 'mono' || found.style === 'code') push(found.inner, inside)
    else for (const r of inlineRuns(found.inner, inside)) push(r.text, r.styles)
    i = found.end
  }
  push(plain, styles)
  return runs
}

/** A message read line by line the way WhatsApp draws it: lists, quotes, and the styled stretches in each line. */
export function parseWhatsAppText(text: string): WhatsAppLine[] {
  return text.split('\n').map((line) => {
    const bullet = line.match(/^[*-] (.*)$/)
    if (bullet) return { kind: 'bullet', marker: '•', runs: inlineRuns(bullet[1]!) }
    const numbered = line.match(/^(\d+)\. (.*)$/)
    if (numbered) return { kind: 'numbered', marker: `${numbered[1]}.`, runs: inlineRuns(numbered[2]!) }
    const quote = line.match(/^> ?(.*)$/)
    if (quote) return { kind: 'quote', marker: '', runs: inlineRuns(quote[1]!) }
    return { kind: 'text', marker: '', runs: inlineRuns(line) }
  })
}
