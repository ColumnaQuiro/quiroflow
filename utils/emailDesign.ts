// An email built from blocks (header, heading, text, image, button, columns,
// divider, spacer, footer) and the one function that turns it into the HTML
// a patient receives. The editor's preview, "Send test" and the real send
// all call emailDesignHtml, so what the builder shows is what goes out.
//
// The output is the table-based HTML mail clients actually render (the same
// shape MJML produces): a 600px presentation table, every style inline,
// web-safe fonts, a bulletproof button with a VML fallback for Outlook on
// Windows, and "fluid hybrid" columns -- inline-blocks that sit side by side
// at 600px and wrap one under the other on a phone with no media query at
// all, so a client that strips <style> still stacks them.
//
// Merge fields are left in as {{key}}: the caller merges them afterwards,
// with the values escaped, exactly as it does for an email written in the
// plain editor. Pure, and shared by the pages and the server.

import { DEFAULT_BOOKING_BUTTON_TEXT, unsubscribeFooterHtml, type UnsubscribeLinks } from './automationEmail'

// ------------------------------------------------------------------ the model

export type EmailFont = 'system' | 'helvetica' | 'georgia' | 'verdana'

export interface EmailTheme {
  /** Buttons, links and the header's accent. */
  brandColor: string
  buttonTextColor: string
  /** Behind the card. */
  backgroundColor: string
  /** The card itself. */
  contentColor: string
  textColor: string
  headingColor: string
  font: EmailFont
}

/** Where a button or a linked image goes: a merge-field link, or an address of the clinic's own. */
export type EmailLink =
  | { kind: 'booking' }
  | { kind: 'review' }
  | { kind: 'satisfaction' }
  | { kind: 'pay' }
  | { kind: 'url'; url: string }

export type Align = 'left' | 'center'

export type EmailBlock =
  | { id: string; type: 'header'; align: Align }
  | { id: string; type: 'heading'; text: string; align: Align }
  | { id: string; type: 'text'; html: string }
  | { id: string; type: 'image'; src: string; alt: string; link: EmailLink | null }
  | { id: string; type: 'button'; text: string; link: EmailLink; align: Align | 'full' }
  | { id: string; type: 'columns'; columns: [EmailColumn, EmailColumn] }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; height: number }
  | { id: string; type: 'footer'; html: string }

export interface EmailColumn {
  image: { src: string; alt: string } | null
  html: string
}

export type EmailBlockType = EmailBlock['type']

export interface EmailDesign {
  version: 1
  /** The line inbox apps show after the subject. */
  preheader?: string
  /** This email's own departures from the clinic's branding. */
  theme?: Partial<EmailTheme>
  blocks: EmailBlock[]
}

// ------------------------------------------------------------------ defaults

/** The look of an email before the clinic sets its own branding: QuiroFlow's plain card. */
export const DEFAULT_EMAIL_THEME: EmailTheme = {
  brandColor: '#4F46E5',
  buttonTextColor: '#FFFFFF',
  backgroundColor: '#F4F4F6',
  contentColor: '#FFFFFF',
  textColor: '#4A4A57',
  headingColor: '#1F2029',
  font: 'system',
}

export const EMAIL_FONTS: { value: EmailFont; label: string; stack: string }[] = [
  { value: 'system', label: 'System', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" },
  { value: 'helvetica', label: 'Helvetica / Arial', stack: 'Helvetica, Arial, sans-serif' },
  { value: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { value: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
]

const HEX = /^#[0-9a-f]{6}$/i
/** The clinic's branding under this email's own changes, each colour checked so a bad value can never reach a style attribute. */
export function resolveEmailTheme(...layers: (Partial<EmailTheme> | null | undefined)[]): EmailTheme {
  const out: EmailTheme = { ...DEFAULT_EMAIL_THEME }
  for (const layer of layers) {
    if (!layer) continue
    for (const key of Object.keys(DEFAULT_EMAIL_THEME) as (keyof EmailTheme)[]) {
      const v = layer[key]
      if (key === 'font') {
        if (EMAIL_FONTS.some((f) => f.value === v)) out.font = v as EmailFont
      } else if (typeof v === 'string' && HEX.test(v)) {
        out[key] = v
      }
    }
  }
  return out
}

export const EMAIL_BLOCK_TYPES: EmailBlockType[] = ['header', 'heading', 'text', 'image', 'button', 'columns', 'divider', 'spacer', 'footer']

let seq = 0
export function blockId(): string {
  seq = (seq + 1) % 1e6
  return `b${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** A new block of a type, with words in the clinic's language. */
export function newEmailBlock(type: EmailBlockType, lang: 'es' | 'en' = 'es'): EmailBlock {
  const es = lang === 'es'
  const id = blockId()
  switch (type) {
    case 'header':
      return { id, type, align: 'center' }
    case 'heading':
      return { id, type, text: es ? 'Hola {{first_name}}' : 'Hello {{first_name}}', align: 'left' }
    case 'text':
      return { id, type, html: es ? '<p>Escribe aquí tu mensaje.</p>' : '<p>Write your message here.</p>' }
    case 'image':
      return { id, type, src: '', alt: '', link: null }
    case 'button':
      return { id, type, text: es ? DEFAULT_BOOKING_BUTTON_TEXT : 'Book your next visit', link: { kind: 'booking' }, align: 'center' }
    case 'columns':
      return { id, type, columns: [{ image: null, html: es ? '<p>Columna izquierda</p>' : '<p>Left column</p>' }, { image: null, html: es ? '<p>Columna derecha</p>' : '<p>Right column</p>' }] }
    case 'divider':
      return { id, type }
    case 'spacer':
      return { id, type, height: 24 }
    case 'footer':
      return { id, type, html: '<p>{{clinic_name}}<br>{{clinic_address}}<br>{{clinic_phone}}</p>' }
  }
}

/** What a new email starts as: the clinic's header, a greeting, a message, a booking button and the footer. */
export function starterEmailDesign(lang: 'es' | 'en' = 'es'): EmailDesign {
  return { version: 1, blocks: [newEmailBlock('header', lang), newEmailBlock('heading', lang), newEmailBlock('text', lang), newEmailBlock('button', lang), newEmailBlock('footer', lang)] }
}

/**
 * An email written in the plain editor, as blocks: its logo switch becomes a
 * header, its body a text block, its booking button a button. The body is
 * carried over untouched.
 */
export function legacyEmailDesign(config: { body?: string; include_logo?: boolean; booking_button?: boolean; booking_button_text?: string | null }): EmailDesign {
  const blocks: EmailBlock[] = []
  if (config.include_logo) blocks.push({ id: blockId(), type: 'header', align: 'center' })
  blocks.push({ id: blockId(), type: 'text', html: config.body ?? '' })
  if (config.booking_button) blocks.push({ id: blockId(), type: 'button', text: config.booking_button_text?.trim() || DEFAULT_BOOKING_BUTTON_TEXT, link: { kind: 'booking' }, align: 'center' })
  return { version: 1, blocks }
}

/** A stored value as a design, or null: anything malformed is refused rather than half-rendered. */
export function asEmailDesign(value: unknown): EmailDesign | null {
  if (!value || typeof value !== 'object') return null
  const d = value as EmailDesign
  if (d.version !== 1 || !Array.isArray(d.blocks)) return null
  if (!d.blocks.every((b) => b && typeof b === 'object' && EMAIL_BLOCK_TYPES.includes(b.type) && typeof b.id === 'string')) return null
  return d
}

// ------------------------------------------------------------------ links

/** The merge field each link kind stands for; merged per patient like any other. */
const LINK_TOKENS: Record<Exclude<EmailLink['kind'], 'url'>, string> = {
  booking: '{{booking_link}}',
  review: '{{google_review_link}}',
  satisfaction: '{{satisfaction_link}}',
  pay: '{{invoice_pay_link}}',
}

export const EMAIL_LINK_KINDS: { value: EmailLink['kind']; label: readonly [string, string] }[] = [
  { value: 'booking', label: ['Online booking', 'Reserva online'] },
  { value: 'review', label: ['Google review', 'Reseña de Google'] },
  { value: 'satisfaction', label: ['Rate the visit', 'Valorar la visita'] },
  { value: 'pay', label: ['Pay the invoice', 'Pagar la factura'] },
  { value: 'url', label: ['A web address', 'Una dirección web'] },
]

// An address typed without a scheme would resolve against the mail client's
// own host. Anything that is not http(s), mailto or tel goes nowhere at all:
// a javascript: link in an email is never what someone meant.
export function safeUrl(url: string): string {
  const u = url.trim()
  if (!u) return ''
  if (/^\{\{\w+\}\}$/.test(u)) return u
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return ''
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u)) return `mailto:${u}`
  return `https://${u}`
}

export function linkHref(link: EmailLink | null | undefined): string {
  if (!link) return ''
  return link.kind === 'url' ? safeUrl(link.url ?? '') : LINK_TOKENS[link.kind]
}

/** Every merge field an email uses, wherever it is: text, buttons, links, preheader. */
export function emailDesignTokens(design: EmailDesign): Set<string> {
  const keys = new Set<string>()
  const scan = (s: string | undefined | null) => {
    for (const m of (s ?? '').matchAll(/\{\{(\w+)\}\}/g)) keys.add(m[1]!)
  }
  scan(design.preheader)
  for (const b of design.blocks) {
    if (b.type === 'heading') scan(b.text)
    else if (b.type === 'text' || b.type === 'footer') scan(b.html)
    else if (b.type === 'button') {
      scan(b.text)
      scan(linkHref(b.link))
    } else if (b.type === 'image') scan(linkHref(b.link))
    else if (b.type === 'columns') b.columns.forEach((c) => scan(c.html))
  }
  return keys
}

/** Whether the email says anything at all: a text, a heading, an image or a button. */
export function emailDesignHasContent(design: EmailDesign): boolean {
  const words = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0 || /<img/i.test(html)
  return design.blocks.some((b) =>
    (b.type === 'text' && words(b.html)) ||
    (b.type === 'heading' && b.text.trim()) ||
    (b.type === 'image' && b.src) ||
    (b.type === 'button' && b.text.trim()) ||
    (b.type === 'columns' && b.columns.some((c) => words(c.html) || c.image?.src)),
  )
}

/** One line of what the email says, for the canvas and the list. */
export function emailDesignExcerpt(design: EmailDesign): string {
  for (const b of design.blocks) {
    const text = b.type === 'heading' ? b.text : b.type === 'text' ? b.html.replace(/<[^>]*>/g, ' ') : ''
    const line = text.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    if (line) return line
  }
  return ''
}

// ------------------------------------------------------------------ rendering

export interface EmailRenderContext {
  clinicName?: string | null
  logoUrl?: string | null
  /** The clinic's branding (accounts.email_branding); the design's own theme goes over it. */
  branding?: Partial<EmailTheme> | null
  unsubscribe?: UnsubscribeLinks | null
  /** HTML put first inside the card, such as the note a tutor gets. */
  prefixHtml?: string
  /** The editor's canvas: each block's row carries data-block="<id>" so a click can find it. */
  markBlocks?: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const WIDTH = 600
const PAD = 32

// The rich-text editor's small tag set (p, div, br, b, i, u, a, img, ul, ol,
// li), given the inline styles a mail client will not supply. Inline because
// Gmail and Outlook ignore most of a <style> block.
function styleTextHtml(html: string, theme: EmailTheme, fontStack: string): string {
  const base = `margin:0 0 12px;font-family:${fontStack};font-size:15px;line-height:1.6;color:${theme.textColor};`
  return html
    .replace(/<p\b(?![^>]*\sstyle=)([^>]*)>/gi, `<p$1 style="${base}">`)
    .replace(/<div\b(?![^>]*\sstyle=)([^>]*)>/gi, `<div$1 style="${base}">`)
    .replace(/<(ul|ol)\b(?![^>]*\sstyle=)([^>]*)>/gi, `<$1$2 style="margin:0 0 12px;padding-left:22px;">`)
    .replace(/<li\b(?![^>]*\sstyle=)([^>]*)>/gi, `<li$1 style="${base}margin:0 0 4px;">`)
    .replace(/<a\b(?![^>]*\sstyle=)([^>]*)>/gi, `<a$1 style="color:${theme.brandColor};text-decoration:underline;">`)
    .replace(/<img\b(?![^>]*\sstyle=)([^>]*)>/gi, `<img$1 style="max-width:100%;height:auto;border:0;">`)
}

function row(inner: string, padding = `0 ${PAD}px`) {
  return `<tr><td class="qf-pad" style="padding:${padding};">${inner}</td></tr>`
}

function button(text: string, href: string, align: Align | 'full', theme: EmailTheme, fontStack: string) {
  const label = esc(text.trim() || DEFAULT_BOOKING_BUTTON_TEXT)
  const full = align === 'full'
  // VML needs a fixed width; wide enough for the words at 15px bold.
  const vmlWidth = full ? WIDTH - PAD * 2 : Math.min(WIDTH - PAD * 2, Math.max(160, Math.round(text.trim().length * 8.6) + 56))
  const a = `<a href="${esc(href)}" target="_blank" style="display:${full ? 'block' : 'inline-block'};background:${theme.brandColor};color:${theme.buttonTextColor};font-family:${fontStack};font-size:15px;font-weight:600;line-height:20px;text-decoration:none;text-align:center;padding:12px 24px;border-radius:8px;mso-padding-alt:0;">${label}</a>`
  const vml = `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(href)}" style="height:44px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="18%" stroke="f" fillcolor="${theme.brandColor}"><w:anchorlock/><center style="color:${theme.buttonTextColor};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->`
  return `<div style="text-align:${full ? 'center' : align};">${vml}<!--[if !mso]><!-->${a}<!--<![endif]--></div>`
}

function image(src: string, alt: string, href: string, width: number) {
  const img = `<img src="${esc(safeUrl(src))}" alt="${esc(alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;border-radius:6px;" />`
  return href ? `<a href="${esc(href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img
}

function blockHtml(b: EmailBlock, theme: EmailTheme, fontStack: string, ctx: EmailRenderContext): string {
  const inner = WIDTH - PAD * 2
  switch (b.type) {
    case 'header': {
      const name = ctx.clinicName?.trim() || ''
      const content = ctx.logoUrl
        ? `<img src="${esc(ctx.logoUrl)}" alt="${esc(name)}" height="56" style="display:inline-block;max-height:56px;max-width:220px;height:auto;border:0;" />`
        : `<span style="font-family:${fontStack};font-size:18px;font-weight:700;color:${theme.headingColor};">${esc(name)}</span>`
      return row(`<div style="text-align:${b.align};">${content}</div>`, `28px ${PAD}px 12px`)
    }
    case 'heading':
      return row(`<h1 style="margin:0;font-family:${fontStack};font-size:22px;line-height:1.3;font-weight:700;color:${theme.headingColor};text-align:${b.align};">${esc(b.text)}</h1>`, `12px ${PAD}px 8px`)
    case 'text':
      return row(styleTextHtml(b.html, theme, fontStack), `8px ${PAD}px 4px`)
    case 'image':
      if (!b.src) return ''
      return row(image(b.src, b.alt, linkHref(b.link), inner), `8px ${PAD}px`)
    case 'button':
      return row(button(b.text, linkHref(b.link), b.align, theme, fontStack), `12px ${PAD}px 16px`)
    case 'divider':
      return row(`<div style="height:1px;line-height:1px;font-size:1px;background:${mix(theme.textColor, theme.contentColor)};">&nbsp;</div>`, `12px ${PAD}px`)
    case 'spacer': {
      const h = Math.max(4, Math.min(96, Math.round(Number(b.height) || 24)))
      return `<tr><td style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</td></tr>`
    }
    case 'columns': {
      const gap = 16
      const colWidth = (inner - gap) / 2
      const col = (c: EmailColumn) =>
        `<div class="qf-col" style="display:inline-block;width:100%;max-width:${colWidth}px;vertical-align:top;font-size:15px;">` +
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:0 0 12px;">` +
        (c.image?.src ? `<div style="margin:0 0 10px;">${image(c.image.src, c.image.alt, '', colWidth)}</div>` : '') +
        styleTextHtml(c.html, theme, fontStack) +
        `</td></tr></table></div>`
      return row(
        `<div style="font-size:0;text-align:left;">` +
          `<!--[if mso]><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="${colWidth}" valign="top"><![endif]-->` +
          col(b.columns[0]) +
          `<!--[if mso]></td><td width="${gap}"></td><td width="${colWidth}" valign="top"><![endif]-->` +
          `<div class="qf-gap" style="display:inline-block;width:${gap}px;font-size:1px;">&nbsp;</div>` +
          col(b.columns[1]) +
          `<!--[if mso]></td></tr></table><![endif]-->` +
          `</div>`,
        `8px ${PAD}px`,
      )
    }
    case 'footer':
      return row(styleTextHtml(b.html, { ...theme, textColor: mix(theme.textColor, theme.contentColor, 0.65) }, fontStack).replace(/font-size:15px/g, 'font-size:12.5px'), `16px ${PAD}px 24px`)
  }
}

// A colour part-way from `a` towards `b`: the divider and the footer's text,
// derived from the theme rather than asked for separately.
function mix(a: string, b: string, keep = 0.18): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return '#' + x.map((v, i) => Math.round(v * keep + y[i]! * (1 - keep)).toString(16).padStart(2, '0')).join('')
}

/** The whole email, as a document: what Resend is given, and what the preview frames. */
export function emailDesignHtml(design: EmailDesign, ctx: EmailRenderContext = {}): string {
  const theme = resolveEmailTheme(ctx.branding, design.theme)
  const fontStack = EMAIL_FONTS.find((f) => f.value === theme.font)!.stack
  const preheader = design.preheader?.trim()
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${theme.backgroundColor};">${esc(design.preheader.trim())}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`
    : ''
  const prefix = ctx.prefixHtml ? row(ctx.prefixHtml, `20px ${PAD}px 0`) : ''
  const body = design.blocks
    .map((b) => {
      const html = blockHtml(b, theme, fontStack, ctx)
      // An image with no picture yet renders nothing; the editor still needs something to click.
      if (ctx.markBlocks && !html) return `<tr data-block="${esc(b.id)}"><td class="qf-pad" style="padding:8px ${PAD}px;"><div style="padding:28px 0;text-align:center;border:1px dashed #C9CAD3;border-radius:6px;font-family:${fontStack};font-size:13px;color:#8A8A96;">${b.type === 'image' ? '+ Imagen' : ''}</div></td></tr>`
      return ctx.markBlocks ? html.replace(/^<tr/, `<tr data-block="${esc(b.id)}"`) : html
    })
    .join('')
  const footer = ctx.unsubscribe ? unsubscribeFooterHtml(ctx.unsubscribe.page, ctx.clinicName) : ''
  return `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  img { -ms-interpolation-mode:bicubic; }
  @media (max-width:620px) {
    .qf-card { width:100% !important; }
    .qf-pad { padding-left:20px !important; padding-right:20px !important; }
    .qf-col { max-width:100% !important; }
    .qf-gap { display:none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${theme.backgroundColor};">
${preheader}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${theme.backgroundColor};">
<tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="${WIDTH}" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="qf-card" width="${WIDTH}" cellspacing="0" cellpadding="0" border="0" style="width:${WIDTH}px;max-width:100%;background:${theme.contentColor};border-radius:12px;">
${prefix}${body}
</table>
<!--[if mso]></td></tr></table><![endif]-->
${footer}
</td></tr>
</table>
</body>
</html>`
}
