// An education article's body as blocks (learn_articles.content,
// 20261128083000_learn_articles_rich_content.sql) -- the shape the editor in
// Settings › Education writes, Notion-style: paragraphs, headings, lists,
// quotes, callouts, dividers and images, with bold, italic, underline,
// strikethrough, inline code and links inside the text.
//
// Stored as data, never as HTML, and drawn by components/learn/Blocks.vue
// element by element. `content` is written by any member with the setting
// through the Data API, so everything read from it goes through
// normalizeLearnContent first: unknown blocks are dropped, a link is only
// http(s), mailto or tel, an image only a path in learn-media.
//
// Also the article's other languages (learn_articles.translations, as
// doc_templates.translations).
//
// Pure: shared by the web, the mobile app and the server. No DOM.

export interface LearnRun {
  text: string
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
  href?: string
}

export const LEARN_TEXT_BLOCKS = ['paragraph', 'heading', 'subheading', 'bullet', 'number', 'quote', 'callout'] as const
export type LearnTextBlockType = (typeof LEARN_TEXT_BLOCKS)[number]

export type LearnTextBlock = { id: string; type: LearnTextBlockType; runs: LearnRun[] }
export type LearnImageBlock = { id: string; type: 'image'; path: string; caption?: string }
export type LearnDividerBlock = { id: string; type: 'divider' }
export type LearnBlock = LearnTextBlock | LearnImageBlock | LearnDividerBlock

export function isLearnTextBlock(b: LearnBlock): b is LearnTextBlock {
  return (LEARN_TEXT_BLOCKS as readonly string[]).includes(b.type)
}

const MAX_BLOCKS = 400
const MAX_RUN_TEXT = 5000
const MAX_RUNS = 200

/** A fresh block id: short, random, unique within an article. */
export function newLearnBlockId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

/** A link a reader may follow: http(s), mailto or tel, else nothing. */
export function learnSafeHref(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined
  const v = href.trim()
  if (!v || v.length > 2000) return undefined
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v
  // "www.example.com" typed without its scheme.
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(v)) return `https://${v}`
  return undefined
}

/** A learn-media image path: "<account uuid>/<name>.<image ext>". */
export function isLearnImagePath(path: unknown): path is string {
  return typeof path === 'string' && /^[0-9a-f-]{36}\/[\w.-]{1,120}\.(jpe?g|png|webp|gif)$/i.test(path)
}

function normalizeRuns(value: unknown): LearnRun[] {
  if (!Array.isArray(value)) return []
  const runs: LearnRun[] = []
  for (const r of value.slice(0, MAX_RUNS)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.text !== 'string' || !o.text) continue
    const run: LearnRun = { text: o.text.slice(0, MAX_RUN_TEXT) }
    if (o.bold) run.bold = true
    if (o.italic) run.italic = true
    if (o.underline) run.underline = true
    if (o.strike) run.strike = true
    if (o.code) run.code = true
    const href = learnSafeHref(o.href)
    if (href) run.href = href
    runs.push(run)
  }
  return mergeLearnRuns(runs)
}

/** Whatever is in a content column, as blocks that are safe to draw. */
export function normalizeLearnContent(value: unknown): LearnBlock[] {
  if (!Array.isArray(value)) return []
  const out: LearnBlock[] = []
  const ids = new Set<string>()
  for (const b of value.slice(0, MAX_BLOCKS)) {
    if (!b || typeof b !== 'object') continue
    const o = b as Record<string, unknown>
    let id = typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : newLearnBlockId()
    while (ids.has(id)) id = newLearnBlockId()
    if ((LEARN_TEXT_BLOCKS as readonly string[]).includes(o.type as string)) {
      ids.add(id)
      out.push({ id, type: o.type as LearnTextBlockType, runs: normalizeRuns(o.runs) })
    } else if (o.type === 'image' && isLearnImagePath(o.path)) {
      ids.add(id)
      const caption = typeof o.caption === 'string' ? o.caption.slice(0, 500) : ''
      out.push(caption ? { id, type: 'image', path: o.path, caption } : { id, type: 'image', path: o.path })
    } else if (o.type === 'divider') {
      ids.add(id)
      out.push({ id, type: 'divider' })
    }
  }
  return out
}

const sameFormat = (a: LearnRun, b: LearnRun) => !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.strike === !!b.strike && !!a.code === !!b.code && a.href === b.href

/** Runs with neighbours of the same format joined, and empty ones gone. */
export function mergeLearnRuns(runs: LearnRun[]): LearnRun[] {
  const out: LearnRun[] = []
  for (const r of runs) {
    if (!r.text) continue
    const last = out[out.length - 1]
    if (last && sameFormat(last, r)) last.text += r.text
    else out.push({ ...r })
  }
  return out
}

export function learnRunsText(runs: LearnRun[]): string {
  return runs.map((r) => r.text).join('')
}

/** Plain text, as a paragraph block per blank-line-separated paragraph. */
export function learnContentFromBody(body: string | null | undefined): LearnBlock[] {
  return (body ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ id: newLearnBlockId(), type: 'paragraph' as const, runs: [{ text: p }] }))
}

/**
 * The article's words as plain text: learn_articles.body, which app versions
 * already installed read, and what an email or a search sees. A blank line
 * between blocks; a list item on its own line under the one before.
 */
export function learnContentPlainText(blocks: LearnBlock[]): string {
  const parts: string[] = []
  let n = 0
  let prevList = false
  for (const b of blocks) {
    if (!isLearnTextBlock(b)) {
      if (b.type === 'image' && b.caption?.trim()) parts.push(b.caption.trim())
      prevList = false
      n = 0
      continue
    }
    const text = learnRunsText(b.runs).trim()
    if (b.type !== 'number') n = 0
    if (!text) {
      prevList = false
      continue
    }
    const line = b.type === 'bullet' ? `• ${text}` : b.type === 'number' ? `${++n}. ${text}` : text
    const isList = b.type === 'bullet' || b.type === 'number'
    if (isList && prevList && parts.length) parts[parts.length - 1] += `\n${line}`
    else parts.push(line)
    prevList = isList
  }
  return parts.join('\n\n')
}

/** Minutes to read it, at an unhurried 180 words a minute; null for none. */
export function estimateLearnMinutes(blocks: LearnBlock[]): number | null {
  const words = learnContentPlainText(blocks).split(/\s+/).filter(Boolean).length
  if (!words) return null
  return Math.min(60, Math.max(1, Math.round(words / 180)))
}

/** The learn-media paths the blocks show. */
export function learnContentImagePaths(blocks: LearnBlock[]): string[] {
  return blocks.filter((b): b is LearnImageBlock => b.type === 'image').map((b) => b.path)
}

/** Whether the blocks hold anything a reader would see. */
export function learnContentIsEmpty(blocks: LearnBlock[]): boolean {
  return !blocks.some((b) => !isLearnTextBlock(b) || learnRunsText(b.runs).trim())
}

// ---- inline HTML <-> runs (one block's contenteditable)
//
// The editor reads a block's innerHTML back into runs on every keystroke and
// writes runs into it as HTML. Both directions know only the formats above,
// so pasting or a browser's own markup can never add anything else.

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

const SKIP_CONTENT = new Set(['script', 'style', 'head', 'title', 'template', 'noscript'])
const INNER_BLOCKS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'])
function attrOf(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m?.[2] ?? m?.[3] ?? m?.[4] ?? ''
}

/** One block's inline HTML as runs. Block-level tags inside it become line breaks. */
export function learnRunsFromHtml(html: string): LearnRun[] {
  const runs: LearnRun[] = []
  const stack: { tag: string; set: Partial<LearnRun> }[] = []
  let skipping = 0
  let sawText = false
  const push = (text: string) => {
    const run: LearnRun = { text }
    for (const s of stack) Object.assign(run, s.set)
    runs.push(run)
  }
  const token = /<!--[\s\S]*?-->|<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|([^<]+)|(<)/g
  let m: RegExpExecArray | null
  while ((m = token.exec(html))) {
    const [whole, closing, rawTag, text, lone] = m
    if (text !== undefined || lone !== undefined) {
      if (skipping) continue
      const decoded = decodeEntities(text ?? lone!).replace(/[\t\r\n\u00a0 ]+/g, ' ')
      if (decoded) {
        push(decoded)
        sawText = true
      }
      continue
    }
    if (!rawTag) continue
    const tag = rawTag.toLowerCase()
    if (SKIP_CONTENT.has(tag)) {
      skipping = Math.max(0, skipping + (closing ? -1 : 1))
      continue
    }
    if (skipping) continue
    if (tag === 'br') {
      if (!closing) push('\n')
      continue
    }
    if (INNER_BLOCKS.has(tag)) {
      // A block inside the block (a browser wraps a new line in <div>): a line break between them.
      if (!closing && sawText && runs[runs.length - 1]?.text !== '\n') push('\n')
      continue
    }
    if (closing) {
      const i = stack.map((s) => s.tag).lastIndexOf(tag)
      if (i >= 0) stack.splice(i, 1)
      continue
    }
    if (/\/\s*>$/.test(whole)) continue
    const set: Partial<LearnRun> = {}
    if (tag === 'b' || tag === 'strong') set.bold = true
    else if (tag === 'i' || tag === 'em') set.italic = true
    else if (tag === 'u' || tag === 'ins') set.underline = true
    else if (tag === 's' || tag === 'strike' || tag === 'del') set.strike = true
    else if (tag === 'code') set.code = true
    else if (tag === 'a') {
      const href = learnSafeHref(decodeEntities(attrOf(whole, 'href')))
      if (href) set.href = href
    }
    // Formats a browser or a paste expresses as a style.
    const style = attrOf(whole, 'style').toLowerCase()
    if (style) {
      if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) set.bold = true
      if (/font-style\s*:\s*italic/.test(style)) set.italic = true
      if (/text-decoration[^;]*underline/.test(style)) set.underline = true
      if (/text-decoration[^;]*line-through/.test(style)) set.strike = true
    }
    stack.push({ tag, set })
  }
  // A contenteditable ends a block with a <br> it does not mean.
  while (runs.length && runs[runs.length - 1]!.text === '\n') runs.pop()
  return mergeLearnRuns(runs)
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Runs as the inline HTML the editor's contenteditable shows. */
export function learnRunsToHtml(runs: LearnRun[]): string {
  return runs
    .map((r) => {
      let html = escapeHtml(r.text).replace(/\n/g, '<br>')
      if (r.code) html = `<code>${html}</code>`
      if (r.strike) html = `<s>${html}</s>`
      if (r.underline) html = `<u>${html}</u>`
      if (r.italic) html = `<i>${html}</i>`
      if (r.bold) html = `<b>${html}</b>`
      if (r.href) html = `<a href="${escapeHtml(r.href)}">${html}</a>`
      return html
    })
    .join('')
}

function trimRuns(runs: LearnRun[]): LearnRun[] {
  const out = runs.map((r) => ({ ...r }))
  if (out[0]) out[0].text = out[0].text.replace(/^[\s\n]+/, '')
  const last = out[out.length - 1]
  if (last) last.text = last.text.replace(/[\s\n]+$/, '')
  return out.filter((r) => r.text)
}

// ---- pasting several blocks at once

const BLOCK_OF_TAG: Record<string, LearnTextBlockType> = { h1: 'heading', h2: 'heading', h3: 'subheading', h4: 'subheading', h5: 'subheading', h6: 'subheading', blockquote: 'quote', p: 'paragraph', div: 'paragraph' }

/**
 * Pasted HTML (from a web page, a document, Notion...) as blocks: headings,
 * lists, quotes, paragraphs and rules. Images are left out -- they would be
 * someone else's URL; the clinic adds its own.
 */
export function learnBlocksFromHtml(html: string): LearnBlock[] {
  const out: LearnBlock[] = []
  const lists: ('bullet' | 'number')[] = []
  const types: LearnTextBlockType[] = []
  let buf = ''
  let skipping = 0
  const currentType = (): LearnTextBlockType => types[types.length - 1] ?? 'paragraph'
  const flush = () => {
    const runs = trimRuns(learnRunsFromHtml(buf))
    if (learnRunsText(runs).trim()) out.push({ id: newLearnBlockId(), type: currentType(), runs })
    buf = ''
  }
  const token = /<!--[\s\S]*?-->|<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+|</g
  let m: RegExpExecArray | null
  while ((m = token.exec(html))) {
    const [whole, closing, rawTag] = m
    const tag = rawTag?.toLowerCase()
    if (tag && SKIP_CONTENT.has(tag)) {
      skipping = Math.max(0, skipping + (closing ? -1 : 1))
      continue
    }
    if (skipping) continue
    if (tag === 'ul' || tag === 'ol') {
      flush()
      if (closing) {
        lists.pop()
        // An <li> left unclosed, as HTML allows, ends with its list.
        while (types.length && (types[types.length - 1] === 'bullet' || types[types.length - 1] === 'number')) types.pop()
      } else lists.push(tag === 'ol' ? 'number' : 'bullet')
      continue
    }
    if (tag === 'hr') {
      flush()
      out.push({ id: newLearnBlockId(), type: 'divider' })
      continue
    }
    if (tag === 'li' || (tag && BLOCK_OF_TAG[tag])) {
      flush()
      if (closing) types.pop()
      else types.push(tag === 'li' ? (lists[lists.length - 1] ?? 'bullet') : tag === 'p' || tag === 'div' ? (types[types.length - 1] ?? 'paragraph') : BLOCK_OF_TAG[tag]!)
      continue
    }
    buf += whole
  }
  flush()
  return out
}

/**
 * Pasted plain text as blocks: a blank line separates paragraphs, "- " or
 * "• " starts a bullet, "1. " a numbered item, "# " a heading.
 */
export function learnBlocksFromText(text: string): LearnTextBlock[] {
  const out: LearnTextBlock[] = []
  let para: string[] = []
  const flushPara = () => {
    const t = para.join('\n').trim()
    if (t) out.push({ id: newLearnBlockId(), type: 'paragraph', runs: [{ text: t }] })
    para = []
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushPara()
      continue
    }
    const bullet = line.match(/^\s*[-*•·–]\s+(.*)$/)
    const number = line.match(/^\s*\d{1,3}[.)]\s+(.*)$/)
    const heading = line.match(/^\s*(#{1,3})\s+(.*)$/)
    if (bullet || number || heading) {
      flushPara()
      if (heading) out.push({ id: newLearnBlockId(), type: heading[1]!.length === 1 ? 'heading' : 'subheading', runs: [{ text: heading[2]!.trim() }] })
      else out.push({ id: newLearnBlockId(), type: bullet ? 'bullet' : 'number', runs: [{ text: (bullet ?? number)![1]!.trim() }] })
      continue
    }
    para.push(line.trim())
  }
  flushPara()
  return out
}

// ---- other languages (learn_articles.translations)

/** The languages an article can be translated into, besides the clinic's own (Spanish). */
export const LEARN_LANGUAGES = ['en', 'fr', 'ca'] as const
export type LearnLanguage = (typeof LEARN_LANGUAGES)[number]

export interface LearnTranslation {
  title: string
  summary: string
  content: LearnBlock[]
}
export type LearnTranslations = Partial<Record<LearnLanguage, LearnTranslation>>

/** A translations column, made safe to read whatever it holds. */
export function normalizeLearnTranslations(value: unknown): LearnTranslations {
  const out: LearnTranslations = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const code of LEARN_LANGUAGES) {
    const t = (value as Record<string, unknown>)[code]
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue
    const o = t as Record<string, unknown>
    out[code] = {
      title: typeof o.title === 'string' ? o.title.trim() : '',
      summary: typeof o.summary === 'string' ? o.summary.trim() : '',
      content: normalizeLearnContent(o.content),
    }
  }
  return out
}

/** The languages an article has a translation in, in LEARN_LANGUAGES order. */
export function learnLanguagesOf(value: unknown): LearnLanguage[] {
  const t = normalizeLearnTranslations(value)
  return LEARN_LANGUAGES.filter((code) => !!t[code])
}

/**
 * The translated titles, for a list that needs only those and not every
 * language's whole text: select it beside `title` and read it back with
 * learnTitleIn.
 */
export const LEARN_TITLES_SELECT = 'title_en:translations->en->>title, title_fr:translations->fr->>title, title_ca:translations->ca->>title'

/** An article's title in a patient's language, from a row selected with LEARN_TITLES_SELECT. */
export function learnTitleIn(row: { title: string; title_en?: string | null; title_fr?: string | null; title_ca?: string | null }, language: string | null | undefined): string {
  const code = learnLanguageOf(language)
  const translated = code ? row[`title_${code}`]?.trim() : ''
  return translated || row.title
}

/** A patient's preferred_language as one an article can be in, or null. */
export function learnLanguageOf(code: string | null | undefined): LearnLanguage | null {
  return (LEARN_LANGUAGES as readonly string[]).includes(code ?? '') ? (code as LearnLanguage) : null
}

export interface LearnArticleText {
  title: string
  summary: string | null
  content: LearnBlock[]
  /** The language shown: null when it is the original. */
  language: LearnLanguage | null
}

/**
 * An article as a patient whose language is `language` reads it: the
 * translation when there is one, part by part -- a translation with no
 * title yet keeps the original's -- else the original. An original written
 * before blocks existed is read from its plain-text body.
 */
export function learnInLanguage(
  article: { title: string; summary?: string | null; body?: string | null; content?: unknown; translations?: unknown },
  language: string | null | undefined,
): LearnArticleText {
  const content = normalizeLearnContent(article.content)
  const original: LearnArticleText = {
    title: article.title,
    summary: article.summary ?? null,
    content: content.length ? content : learnContentFromBody(article.body),
    language: null,
  }
  const code = learnLanguageOf(language)
  const t = code ? normalizeLearnTranslations(article.translations)[code] : undefined
  if (!code || !t) return original
  return {
    title: t.title || original.title,
    summary: t.summary || original.summary,
    content: learnContentIsEmpty(t.content) ? original.content : t.content,
    language: code,
  }
}
