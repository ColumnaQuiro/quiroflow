import { fillMergeTokens } from './docFields'

// A letter's body (letter_templates.body, patient_letters.body) is HTML from
// a contenteditable, reduced to the little a letter needs: paragraphs, line
// breaks, bold/italic/underline and one level of bulleted or numbered list.
//
// Everything goes through parseLetterHtml, which knows only those, so the
// same string is safe to put back into the editor (sanitizeLetterHtml: a
// body is written by any member through the Data API, and innerHTML would
// otherwise run whatever another member stored) and is what the PDF is drawn
// from (letterBlocks, server/utils/letterData.ts). No DOM: it runs on the
// server too.

export interface LetterRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export type LetterBlock = { kind: 'p'; runs: LetterRun[] } | { kind: 'li'; ordered: boolean; index: number; runs: LetterRun[] }

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li'])
const SKIP_CONTENT = new Set(['script', 'style', 'head', 'title', 'template'])

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return ''
      return n === 0xa0 ? ' ' : String.fromCodePoint(n)
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole
  })
}

export function parseLetterHtml(html: string): LetterBlock[] {
  const blocks: LetterBlock[] = []
  const format = { bold: 0, italic: 0, underline: 0 }
  const lists: { ordered: boolean; count: number }[] = []
  let skipping = 0
  let current: { runs: LetterRun[]; explicit: boolean; li: boolean } | null = null

  function flush() {
    if (!current) return
    const runs = current.runs
    // A contenteditable ends a block with a <br> it does not mean.
    while (runs.length && runs[runs.length - 1]!.text === '\n') runs.pop()
    const blank = runs.every((r) => !r.text.trim())
    if (current.li) {
      const list = lists[lists.length - 1]
      const ordered = list?.ordered ?? false
      const index = list ? ++list.count : 1
      blocks.push({ kind: 'li', ordered, index, runs: blank ? [] : runs })
    } else if (!blank || current.explicit) {
      // An empty paragraph the writer made is a blank line they wanted.
      blocks.push({ kind: 'p', runs: blank ? [] : runs })
    }
    current = null
  }
  function addRun(text: string) {
    if (!current) current = { runs: [], explicit: false, li: false }
    const run: LetterRun = { text }
    if (format.bold) run.bold = true
    if (format.italic) run.italic = true
    if (format.underline) run.underline = true
    const last = current.runs[current.runs.length - 1]
    if (last && last.text !== '\n' && text !== '\n' && !!last.bold === !!run.bold && !!last.italic === !!run.italic && !!last.underline === !!run.underline) last.text += text
    else current.runs.push(run)
  }

  const token = /<!--[\s\S]*?-->|<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|([^<]+)|(<)/g
  let m: RegExpExecArray | null
  while ((m = token.exec(html))) {
    const [, closing, rawTag, text, lone] = m
    if (text !== undefined || lone !== undefined) {
      if (skipping) continue
      const decoded = decodeEntities(text ?? lone!).replace(/[\s\u00a0]+/g, ' ')
      // Whitespace at the start of a block is indentation of the source.
      if (!decoded.trim() && (!current || !current.runs.length)) continue
      addRun(decoded)
      continue
    }
    if (!rawTag) continue
    const tag = rawTag.toLowerCase()
    const open = !closing
    if (SKIP_CONTENT.has(tag)) {
      skipping = Math.max(0, skipping + (open ? 1 : -1))
      continue
    }
    if (skipping) continue
    if (tag === 'br') {
      if (open) addRun('\n')
    } else if (tag === 'b' || tag === 'strong') {
      format.bold = Math.max(0, format.bold + (open ? 1 : -1))
    } else if (tag === 'i' || tag === 'em') {
      format.italic = Math.max(0, format.italic + (open ? 1 : -1))
    } else if (tag === 'u') {
      format.underline = Math.max(0, format.underline + (open ? 1 : -1))
    } else if (tag === 'ul' || tag === 'ol') {
      flush()
      if (open) lists.push({ ordered: tag === 'ol', count: 0 })
      else lists.pop()
    } else if (BLOCK_TAGS.has(tag)) {
      flush()
      if (open) current = { runs: [], explicit: true, li: tag === 'li' }
    }
  }
  flush()

  // Trim each block's outer spaces, which HTML would not have shown.
  for (const block of blocks) {
    const first = block.runs[0]
    if (first) first.text = first.text.replace(/^ +/, '')
    const last = block.runs[block.runs.length - 1]
    if (last) last.text = last.text.replace(/ +$/, '')
    block.runs = block.runs.filter((r) => r.text)
  }
  return blocks
}

export function escapeLetterText(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>')
}

function runsHtml(runs: LetterRun[]) {
  if (!runs.length) return '<br>'
  return runs
    .map((r) => {
      let html = escapeLetterText(r.text)
      if (r.underline) html = `<u>${html}</u>`
      if (r.italic) html = `<i>${html}</i>`
      if (r.bold) html = `<b>${html}</b>`
      return html
    })
    .join('')
}

export function serializeLetterBlocks(blocks: LetterBlock[]): string {
  let html = ''
  let openList: 'ul' | 'ol' | null = null
  for (const block of blocks) {
    const list = block.kind === 'li' ? (block.ordered ? 'ol' : 'ul') : null
    if (openList && openList !== list) {
      html += `</${openList}>`
      openList = null
    }
    if (list && !openList) {
      html += `<${list}>`
      openList = list
    }
    html += block.kind === 'li' ? `<li>${runsHtml(block.runs)}</li>` : `<p>${runsHtml(block.runs)}</p>`
  }
  if (openList) html += `</${openList}>`
  return html
}

export function sanitizeLetterHtml(html: string): string {
  return serializeLetterBlocks(parseLetterHtml(html))
}

// A template's body with the patient's and clinic's values in it: the draft
// a letter starts as.
export function fillLetterBody(html: string, vars: Record<string, string>): string {
  return sanitizeLetterHtml(fillMergeTokens(sanitizeLetterHtml(html), vars, escapeLetterText))
}

// Which merge fields a body uses.
export function letterTokens(html: string): string[] {
  return [...new Set([...html.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))]
}

export function letterFileName(title: string, date: string) {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'carta'}-${date.slice(0, 10)}.pdf`
}
