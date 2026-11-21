// What a template message needs filled before Meta will send it, worked out
// from the template as Meta has it -- shared by every place QuiroFlow sends
// one: automations (and the campaigns, recalls and lead sequences that run
// through them), appointment confirmations and reminders, the staff alerts,
// the Inbox and the public API.
//
// Each of those builds the parts it knows about -- the body's variables, a
// header file a step attached, a form button's link -- and hands the rest
// here. Meta refuses the whole send ("(#131008) Required parameter is
// missing") when a template has a part that takes a value and none is sent:
// a heading with {{1}}, a file, a place, a link ending in {{1}}, a code to
// copy. So whatever the caller did not fill, this fills from what QuiroFlow
// kept when the template was made (TemplateSendValues), or from Meta's own
// samples, and says what it could not.
//
// What the caller sent is never changed, and nothing is added for a part the
// caller already filled -- so a template that sends today sends exactly the
// same components after this: it already had every required part.
//
// A plain module (no Nuxt auto-imports) so the unit tests can pin the payloads.

import { phoneForUrlButton } from './whatsappUrlButton'
import type { TemplateLocation, TemplateSendValues, ValueSource } from './whatsappTemplateDraft'

/** A template as Meta's GET /{waba}/message_templates lists it: only the parts a send reads. */
export interface MetaTemplateDefinition {
  name?: string
  language?: string
  components?: {
    type: string
    format?: string
    text?: string
    example?: { header_text?: string[]; body_text?: string[][]; header_handle?: string[] }
    buttons?: { type: string; text?: string; url?: string; example?: string[] | string; phone_number?: string }[]
  }[]
}

export type SendComponent = Record<string, any>

export interface TemplateSendInputs {
  /** Who it goes to, for a blank that takes their name. */
  firstName?: string | null
  /** The number it goes to, digits or E.164, for a blank that takes it. */
  phone?: string | null
  /** What QuiroFlow kept for this template when it was made here. */
  values?: TemplateSendValues | null
  /** The file to attach when the template has one at the top and the caller attached none: the one it was made with. */
  headerMedia?: { link: string; filename?: string | null } | null
  /** The place for a location header the caller left empty, when not the one kept with the template. */
  location?: TemplateLocation | null
}

export interface CompletedTemplate {
  components: SendComponent[]
  /** What could not be filled, so Meta would refuse the send; empty when it should accept it. */
  missing: string[]
}

/** A blank's value from where it comes from. A name or text in a link is URL-encoded, as Meta requires. */
export function valueFromSource(source: ValueSource | null | undefined, inputs: TemplateSendInputs, opts: { inUrl?: boolean; url?: string; example?: string } = {}): string {
  const phone = (inputs.phone ?? '').replace(/\D/g, '')
  if (source?.source === 'phone') return opts.inUrl ? phoneForUrlButton(phone, opts.url, opts.example) : phone
  const text = (source?.source === 'text' ? source.text : (inputs.firstName ?? '')).trim()
  return opts.inUrl ? encodeURIComponent(text) : text
}

const componentOf = (template: MetaTemplateDefinition | null | undefined, type: string) => template?.components?.find((c) => c.type?.toUpperCase() === type)
const buttonsOf = (template: MetaTemplateDefinition | null | undefined) => componentOf(template, 'BUTTONS')?.buttons ?? []
const firstExample = (example: string[] | string | undefined) => (Array.isArray(example) ? example[0] : example) ?? ''
const VARIABLE = /\{\{\s*\d+\s*\}\}/

/** Whether the caller already sent a part for this button. */
const hasButton = (components: SendComponent[], index: number) => components.some((c) => c.type === 'button' && String(c.index) === String(index))

/**
 * The components to send: the caller's, plus whatever the template still
 * needs, in the order Meta wants them -- header, body, then buttons by index.
 */
export function completeTemplateComponents(template: MetaTemplateDefinition | null | undefined, components: SendComponent[], inputs: TemplateSendInputs = {}): CompletedTemplate {
  if (!template?.components?.length) return { components, missing: [] }
  const added: SendComponent[] = []
  const missing: string[] = []
  const values = inputs.values ?? null

  const header = componentOf(template, 'HEADER')
  const format = header?.format?.toUpperCase()
  if (header && !components.some((c) => c.type === 'header')) {
    if (format === 'TEXT' && VARIABLE.test(header.text ?? '')) {
      // The name, unless the template was made to take something else: a
      // heading with a variable is nearly always "Hola {{1}}".
      const text = valueFromSource(values?.header ?? null, inputs) || (header.example?.header_text?.[0] ?? '').trim()
      if (text) added.push({ type: 'header', parameters: [{ type: 'text', text }] })
      else missing.push('header text')
    } else if (format === 'IMAGE' || format === 'VIDEO' || format === 'DOCUMENT') {
      const key = format.toLowerCase()
      const media = inputs.headerMedia
      if (media?.link) {
        added.push({ type: 'header', parameters: [{ type: key, [key]: { link: media.link, ...(key === 'document' && media.filename ? { filename: media.filename } : {}) } }] })
      } else missing.push(`header ${key}`)
    } else if (format === 'LOCATION') {
      const loc = inputs.location ?? values?.location ?? null
      if (loc && Number.isFinite(Number(loc.latitude)) && Number.isFinite(Number(loc.longitude))) {
        added.push({
          type: 'header',
          parameters: [{ type: 'location', location: { latitude: String(loc.latitude), longitude: String(loc.longitude), name: loc.name ?? '', address: loc.address ?? '' } }],
        })
      } else missing.push('header location')
    }
  }

  buttonsOf(template).forEach((b, index) => {
    if (hasButton(components, index)) return
    const type = b.type?.toUpperCase()
    const kept = values?.buttons?.[index] ?? null
    if (type === 'URL' && VARIABLE.test(b.url ?? '')) {
      const example = firstExample(b.example)
      const fixed = (b.url ?? '').split(VARIABLE)[0] ?? ''
      // What QuiroFlow was told goes there; otherwise the end of Meta's own
      // sample, which at least leads where the clinic pointed it.
      const text = kept?.suffix ? valueFromSource(kept.suffix, inputs, { inUrl: true, url: b.url, example }) : example.startsWith(fixed) ? example.slice(fixed.length) : ''
      if (text) added.push({ type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text }] })
      else missing.push(`button ${index} url`)
    } else if (type === 'COPY_CODE') {
      const code = (kept?.code ?? firstExample(b.example)).trim()
      if (code) added.push({ type: 'button', sub_type: 'copy_code', index: String(index), parameters: [{ type: 'coupon_code', coupon_code: code }] })
      else missing.push(`button ${index} code`)
    } else if (type === 'QUICK_REPLY' && kept?.payload) {
      // Optional at Meta, so sent only for a template made here.
      added.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload: kept.payload }] })
    }
  })

  if (!added.length) return { components, missing }
  const rank = (c: SendComponent) => (c.type === 'header' ? 0 : c.type === 'body' ? 1 : 2)
  // Stable: the caller's own order survives within each kind.
  const ordered = [...components, ...added]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || (rank(a.c) === 2 ? Number(a.c.index) - Number(b.c.index) : 0) || a.i - b.i)
    .map(({ c }) => c)
  return { components: ordered, missing }
}

/** The file a template wants at the top, or null when it has none. */
export function templateMediaFormat(template: MetaTemplateDefinition | null | undefined): 'image' | 'video' | 'document' | null {
  const format = componentOf(template, 'HEADER')?.format?.toUpperCase()
  return format === 'IMAGE' || format === 'VIDEO' || format === 'DOCUMENT' ? (format.toLowerCase() as 'image' | 'video' | 'document') : null
}

/** The index of a template's form button (a URL ending in /doc/{{1}}), or -1. */
export function formButtonIndex(template: MetaTemplateDefinition | null | undefined): number {
  return buttonsOf(template).findIndex((b) => b.type?.toUpperCase() === 'URL' && /\/doc\/\{\{1\}\}$/.test(b.url ?? ''))
}
