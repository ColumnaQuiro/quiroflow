// A WhatsApp message template as a clinic writes it in QuiroFlow, before Meta
// has seen it -- and the rules Meta applies when it does.
//
// Shared by the create dialog, which checks as the clinic types, and
// POST /api/whatsapp/templates, which checks again before spending a call to
// Meta. Every rule here is one Meta enforces by refusing the whole template,
// usually with an error that names a field the clinic never saw ("Invalid
// parameter", subcode 2388043) -- so catching it here is the difference
// between "the footer is too long" and a failed submission nobody can read.

export type TemplateCategory = 'UTILITY' | 'MARKETING'
/**
 * What sits above the text: nothing, a line of text (which may carry one
 * {{1}}), a file Meta shows as a picture, a video or a PDF, or a map pin.
 */
export type TemplateHeaderKind = 'none' | 'text' | 'image' | 'video' | 'document' | 'location'
/** The headers that are a file: each send attaches one, and Meta reviews the template with a sample. */
export type MediaHeaderKind = 'image' | 'video' | 'document'
export const MEDIA_HEADERS: MediaHeaderKind[] = ['image', 'video', 'document']
export const isMediaHeader = (kind: string | null | undefined): kind is MediaHeaderKind => MEDIA_HEADERS.includes(kind as MediaHeaderKind)

export interface TemplateDraft {
  name: string
  language: string
  category: TemplateCategory
  header: TemplateHeaderKind
  /** The heading, when `header` is 'text'. At most one variable, and it is {{1}}. */
  headerText?: string
  /** The sample for the heading's {{1}}, which Meta reviews it with. */
  headerExample?: string
  /** What fills the heading's {{1}} on each send. The patient's first name when unset. */
  headerSource?: ValueSource | null
  /** Where a 'location' header points. Meta takes the place on each send, so this is what QuiroFlow sends. */
  location?: TemplateLocation | null
  body: string
  /** One sample per {{n}} in the body, in order. Meta reviews the template with these filled in. */
  examples: string[]
  footer: string
  /** The buttons under the message, in the order the patient sees them. */
  buttons?: TemplateButton[]
  /**
   * Before every kind of button existed, the only one: a form button. Still
   * read, so a draft posted by an older page means what it meant -- and
   * folded into `buttons` by normaliseDraft before anything checks it.
   */
  formButton?: FormButton | null
}

export interface FormButton {
  /** What the button says: "Rellenar formulario". */
  text: string
  /** The doc_templates row the button opens a copy of. */
  docTemplateId: string
}

/**
 * What fills a blank on each send: a fixed text, the person's first name, or
 * their phone number (digits, for a booking link that pre-fills it).
 */
export type ValueSource = { source: 'text'; text: string } | { source: 'first_name' } | { source: 'phone' }

export interface TemplateLocation {
  latitude: number
  longitude: number
  name: string
  address: string
}

/**
 * One button, as Meta has them (Template components > Buttons):
 *
 * - quick_reply: a tap answers with the button's text.
 * - url: opens `url`. `dynamic` ends it in {{1}}, filled on every send by
 *   `suffix`; Meta reviews it with `example` in that place.
 * - phone: calls `phone`.
 * - copy_code: copies a code. Meta labels the button itself; `code` is both
 *   the sample it reviews and the code QuiroFlow sends.
 * - form: QuiroFlow's own kind of url button, `<app>/doc/{{1}}`, filled with
 *   the patient's own copy of `docTemplateId` (whatsapp_template_forms).
 *
 * Meta also has OTP (authentication templates only), FLOW (WhatsApp Flows),
 * catalogue (MPM/SPM) and voice-call buttons. Each needs a product QuiroFlow
 * does not have, so a template carrying one is left to WhatsApp Manager
 * (templateEditBlocker) -- and still sends, since nothing here touches it.
 */
export type TemplateButton =
  | { kind: 'quick_reply'; text: string }
  | { kind: 'url'; text: string; url: string; dynamic?: boolean; example?: string; suffix?: ValueSource | null }
  | { kind: 'phone'; text: string; phone: string }
  | { kind: 'copy_code'; code: string }
  | { kind: 'form'; text: string; docTemplateId: string }
export type TemplateButtonKind = TemplateButton['kind']

/**
 * What QuiroFlow sends to fill a template made here, kept beside it
 * (whatsapp_template_send_values): Meta stores the template, never what goes
 * in its blanks. `buttons` is indexed by Meta's button index.
 */
export interface TemplateSendValues {
  header?: ValueSource | null
  location?: TemplateLocation | null
  buttons?: ({ suffix?: ValueSource; code?: string; payload?: string } | null)[]
}

export interface Bilingual {
  en: string
  es: string
}

/** The languages offered when creating one, as Meta's codes. Spanish first: it is what nearly every clinic writes in. */
export const TEMPLATE_LANGUAGES: { code: string; label: Bilingual }[] = [
  { code: 'es', label: { en: 'Spanish', es: 'Español' } },
  { code: 'ca', label: { en: 'Catalan', es: 'Catalán' } },
  { code: 'en', label: { en: 'English', es: 'Inglés' } },
  { code: 'fr', label: { en: 'French', es: 'Francés' } },
  { code: 'de', label: { en: 'German', es: 'Alemán' } },
  { code: 'it', label: { en: 'Italian', es: 'Italiano' } },
  { code: 'pt_PT', label: { en: 'Portuguese', es: 'Portugués' } },
]

/**
 * What Meta accepts as a template header file, and how large. These are
 * Meta's limits except for documents and video, which are held to the 15 MB
 * the send path already allows (header-media.post.ts): a template whose sample
 * Meta accepted but whose real file the send path refuses would be approved
 * and unusable.
 */
export const HEADER_FILES: Record<MediaHeaderKind, { mimeTypes: string[]; accept: string; maxBytes: number }> = {
  image: { mimeTypes: ['image/jpeg', 'image/png'], accept: 'image/jpeg,image/png', maxBytes: 5 * 1024 * 1024 },
  video: { mimeTypes: ['video/mp4'], accept: 'video/mp4', maxBytes: 15 * 1024 * 1024 },
  document: { mimeTypes: ['application/pdf'], accept: 'application/pdf,.pdf', maxBytes: 15 * 1024 * 1024 },
}

export const BODY_MAX = 1024
export const FOOTER_MAX = 60
/** Meta's limit for a text heading. */
export const HEADER_TEXT_MAX = 60
/** Meta's limit for the words on a button. */
export const BUTTON_TEXT_MAX = 25
/** Meta's limit for a button's link, its {{1}} included. */
export const BUTTON_URL_MAX = 2000
/** Meta's limit for a call button's number. */
export const BUTTON_PHONE_MAX = 20
/** Meta's limit for the code a copy-code button copies. */
export const COPY_CODE_MAX = 20
/** How many buttons Meta allows in one template, and of each kind. */
export const BUTTONS_MAX = 10
export const BUTTON_KIND_MAX: Record<'url' | 'phone' | 'copy_code' | 'quick_reply', number> = { url: 2, phone: 1, copy_code: 1, quick_reply: 10 }

/** The path a form button's link ends in: the public page that opens a patient's copy of a form. */
export const FORM_BUTTON_PATH = '/doc/'

/** The link Meta stores on a form button, with the {{1}} each send fills. */
export function formButtonUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${FORM_BUTTON_PATH}{{1}}`
}

/** Whether a button Meta lists is a form button: a URL ending in /doc/{{1}}. */
export function isFormButton(button: { type?: string; url?: string | null }): boolean {
  return button.type === 'URL' && /\/doc\/\{\{1\}\}$/.test(button.url ?? '')
}
export const NAME_MAX = 512

/**
 * A template name from whatever the clinic typed as its title: Meta takes
 * lowercase letters, digits and underscores only, so "Guía post-ajuste" is
 * guia_post_ajuste.
 */
export function templateNameFrom(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, NAME_MAX)
}

/** The distinct {{n}} numbers in a body, in the order they first appear. */
export function bodyVariables(body: string): number[] {
  const seen: number[] = []
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const n = Number(m[1])
    if (!seen.includes(n)) seen.push(n)
  }
  return seen
}

/** How many samples the body needs: one per variable, numbered 1..n. */
export function exampleCount(body: string): number {
  const vars = bodyVariables(body)
  return vars.length ? Math.max(...vars) : 0
}

/** Whether a text heading has its one {{1}}. */
export const headerHasVariable = (text: string | null | undefined) => /\{\{\s*1\s*\}\}/.test(text ?? '')

/**
 * The draft's buttons, with a form button from an older page folded in. Every
 * check and every payload below reads buttons through this, so the two ways
 * of saying "a form button" can never disagree.
 */
export function draftButtons(draft: Pick<TemplateDraft, 'buttons' | 'formButton'>): TemplateButton[] {
  if (Array.isArray(draft.buttons)) return draft.buttons
  return draft.formButton ? [{ kind: 'form', text: draft.formButton.text, docTemplateId: draft.formButton.docTemplateId }] : []
}

/** The form a draft's form button opens, or null when it has none. Only one is allowed. */
export function draftFormId(draft: Pick<TemplateDraft, 'buttons' | 'formButton'>): string | null {
  const form = draftButtons(draft).find((b) => b.kind === 'form')
  return form && form.kind === 'form' ? form.docTemplateId || null : null
}

/** How Meta counts a button against its limits: a form button is a URL button. */
const metaKind = (b: TemplateButton): 'url' | 'phone' | 'copy_code' | 'quick_reply' => (b.kind === 'form' ? 'url' : b.kind)

/** Whether a link is one Meta will open: http(s), a host with a dot, no spaces. */
export function isButtonUrl(url: string): boolean {
  return /^https?:\/\/[^\s/?#]+\.[^\s/?#]+\S*$/i.test(url.trim())
}

/** The link Meta stores for a url button: the fixed part, then {{1}} when the end changes per send. */
export function buttonUrl(b: { url: string; dynamic?: boolean }): string {
  return b.dynamic ? `${b.url.trim()}{{1}}` : b.url.trim()
}

const VARIABLE = /\{\{|\}\}/

function sourceProblem(source: ValueSource | null | undefined, what: Bilingual): Bilingual | null {
  if (source?.source === 'text' && !source.text.trim()) return { en: `Write the fixed text for ${what.en}.`, es: `Escribe el texto fijo para ${what.es}.` }
  return null
}

/**
 * Everything wrong with a draft, in the order a person would fix it. Empty when Meta should accept it.
 *
 * `editing` skips the name and the language: Meta does not let an edit change
 * either, so they are whatever the template already has -- which for one made
 * in WhatsApp Manager can be a language this dialog never offers ("en_US").
 */
export function templateDraftProblems(draft: TemplateDraft, { editing = false }: { editing?: boolean } = {}): Bilingual[] {
  const problems: Bilingual[] = []

  if (!editing) {
    if (!draft.name) problems.push({ en: 'Give the template a name.', es: 'Ponle un nombre a la plantilla.' })
    else if (!/^[a-z0-9_]+$/.test(draft.name)) {
      problems.push({ en: 'The name can only have lowercase letters, numbers and underscores.', es: 'El nombre solo puede llevar minúsculas, números y guiones bajos.' })
    } else if (draft.name.length > NAME_MAX) problems.push({ en: 'The name is too long.', es: 'El nombre es demasiado largo.' })

    if (!TEMPLATE_LANGUAGES.some((l) => l.code === draft.language)) problems.push({ en: 'Choose a language.', es: 'Elige un idioma.' })
  }
  if (draft.category !== 'UTILITY' && draft.category !== 'MARKETING') problems.push({ en: 'Choose a category.', es: 'Elige una categoría.' })
  if (!['none', 'text', 'image', 'video', 'document', 'location'].includes(draft.header)) problems.push({ en: 'Choose what goes at the top.', es: 'Elige qué va arriba.' })

  if (draft.header === 'text') {
    const text = (draft.headerText ?? '').trim()
    if (!text) problems.push({ en: 'Write the heading.', es: 'Escribe el título.' })
    else {
      if (text.length > HEADER_TEXT_MAX) {
        problems.push({ en: `The heading is ${text.length} characters; WhatsApp allows ${HEADER_TEXT_MAX}.`, es: `El título tiene ${text.length} caracteres; WhatsApp permite ${HEADER_TEXT_MAX}.` })
      }
      const vars = [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1])
      if (vars.length > 1 || vars.some((v) => v !== '1')) {
        problems.push({ en: 'The heading can have one variable, and it has to be {{1}}.', es: 'El título puede llevar una variable, y tiene que ser {{1}}.' })
      } else if (vars.length === 1) {
        if (!(draft.headerExample ?? '').trim()) {
          problems.push({ en: "Give an example for the heading's {{1}} so Meta can review it.", es: 'Pon un ejemplo para el {{1}} del título para que Meta pueda revisarla.' })
        }
        const p = sourceProblem(draft.headerSource, { en: 'the heading', es: 'el título' })
        if (p) problems.push(p)
      }
      // Meta: "Do not use Markdown special characters in this component", and a heading is one line.
      if (/[\n*_~`]/.test(text)) problems.push({ en: 'The heading is one line, without * _ ~ or `.', es: 'El título es una sola línea, sin * _ ~ ni `.' })
    }
  }

  if (draft.header === 'location') {
    const loc = draft.location
    const lat = Number(loc?.latitude)
    const lng = Number(loc?.longitude)
    if (!loc || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
      problems.push({ en: 'Give the location its latitude and longitude.', es: 'Pon la latitud y la longitud de la ubicación.' })
    }
  }

  const body = draft.body.trim()
  if (!body) problems.push({ en: 'Write the message.', es: 'Escribe el mensaje.' })
  else {
    if (body.length > BODY_MAX) {
      problems.push({ en: `The message is ${body.length} characters; WhatsApp allows ${BODY_MAX}.`, es: `El mensaje tiene ${body.length} caracteres; WhatsApp permite ${BODY_MAX}.` })
    }
    const vars = bodyVariables(body)
    const sorted = [...vars].sort((a, b) => a - b)
    if (sorted.some((n, i) => n !== i + 1)) {
      problems.push({
        en: 'Number the variables in order from {{1}}, with none missing.',
        es: 'Numera las variables en orden desde {{1}}, sin saltarte ninguna.',
      })
    }
    // Meta refuses a body that opens or closes on a variable ("Variables can't
    // be at the start or end of the template").
    if (/^\{\{\s*\d+\s*\}\}/.test(body) || /\{\{\s*\d+\s*\}\}[.!?…]?$/.test(body)) {
      problems.push({
        en: 'The message cannot start or end with a variable. Add some words before or after it.',
        es: 'El mensaje no puede empezar ni terminar con una variable. Añade alguna palabra antes o después.',
      })
    }
    const needed = exampleCount(body)
    for (let i = 0; i < needed; i++) {
      if (!(draft.examples[i] ?? '').trim()) {
        problems.push({ en: `Give an example for {{${i + 1}}} so Meta can review it.`, es: `Pon un ejemplo para {{${i + 1}}} para que Meta pueda revisarla.` })
      }
    }
  }

  const footer = draft.footer.trim()
  if (footer.length > FOOTER_MAX) {
    problems.push({ en: `The footer is ${footer.length} characters; WhatsApp allows ${FOOTER_MAX}.`, es: `El pie tiene ${footer.length} caracteres; WhatsApp permite ${FOOTER_MAX}.` })
  }
  if (/\{\{\s*\d+\s*\}\}/.test(footer)) problems.push({ en: 'The footer cannot have variables.', es: 'El pie no puede llevar variables.' })

  problems.push(...buttonProblems(draftButtons(draft)))
  return problems
}

/** What Meta would refuse in a set of buttons: how many, which kinds together, and each one's fields. */
export function buttonProblems(buttons: TemplateButton[]): Bilingual[] {
  const problems: Bilingual[] = []
  if (buttons.length > BUTTONS_MAX) problems.push({ en: `WhatsApp allows ${BUTTONS_MAX} buttons at most.`, es: `WhatsApp permite ${BUTTONS_MAX} botones como mucho.` })

  const count = (k: keyof typeof BUTTON_KIND_MAX) => buttons.filter((b) => metaKind(b) === k).length
  if (count('url') > BUTTON_KIND_MAX.url) {
    problems.push({ en: 'WhatsApp allows two link buttons at most (a form button is one).', es: 'WhatsApp permite dos botones de enlace como mucho (un botón de formulario cuenta como uno).' })
  }
  if (count('phone') > BUTTON_KIND_MAX.phone) problems.push({ en: 'WhatsApp allows one call button.', es: 'WhatsApp permite un solo botón de llamada.' })
  if (count('copy_code') > BUTTON_KIND_MAX.copy_code) problems.push({ en: 'WhatsApp allows one copy-code button.', es: 'WhatsApp permite un solo botón de copiar código.' })
  if (buttons.filter((b) => b.kind === 'form').length > 1) problems.push({ en: 'A template can open one form.', es: 'Una plantilla puede abrir un solo formulario.' })

  // Quick replies go together, before or after the rest: Meta refuses
  // "Quick reply, URL, Quick reply" as an invalid combination.
  const runs = buttons.map((b) => b.kind === 'quick_reply').filter((q, i, all) => i === 0 || q !== all[i - 1]).length
  if (runs > 2) {
    problems.push({ en: 'Put the quick replies together, before or after the other buttons.', es: 'Pon las respuestas rápidas juntas, antes o después de los demás botones.' })
  }

  buttons.forEach((b, i) => {
    const n = { en: `Button ${i + 1}`, es: `Botón ${i + 1}` }
    if (b.kind !== 'copy_code') {
      const text = b.text.trim()
      if (!text) problems.push({ en: `${n.en}: write what it says.`, es: `${n.es}: escribe qué pone.` })
      else if (text.length > BUTTON_TEXT_MAX) {
        problems.push({ en: `${n.en}: the text is ${text.length} characters; WhatsApp allows ${BUTTON_TEXT_MAX}.`, es: `${n.es}: el texto tiene ${text.length} caracteres; WhatsApp permite ${BUTTON_TEXT_MAX}.` })
      }
      if (VARIABLE.test(text)) problems.push({ en: `${n.en}: the text cannot have variables.`, es: `${n.es}: el texto no puede llevar variables.` })
    }
    if (b.kind === 'url') {
      const url = b.url.trim()
      if (!url) problems.push({ en: `${n.en}: write the link.`, es: `${n.es}: escribe el enlace.` })
      else if (VARIABLE.test(url)) {
        problems.push({
          en: `${n.en}: write the link without {{1}}; choose "Changes with each send" for the end that changes.`,
          es: `${n.es}: escribe el enlace sin {{1}}; elige «Cambia en cada envío» para la parte que cambia.`,
        })
      } else if (!isButtonUrl(url)) problems.push({ en: `${n.en}: the link has to start with https:// and have no spaces.`, es: `${n.es}: el enlace tiene que empezar por https:// y no llevar espacios.` })
      else if (buttonUrl(b).length > BUTTON_URL_MAX) problems.push({ en: `${n.en}: the link is too long.`, es: `${n.es}: el enlace es demasiado largo.` })
      if (b.dynamic) {
        const example = (b.example ?? '').trim()
        if (!example) problems.push({ en: `${n.en}: give an example of the end of the link so Meta can review it.`, es: `${n.es}: pon un ejemplo del final del enlace para que Meta pueda revisarla.` })
        else if (/\s/.test(example)) problems.push({ en: `${n.en}: the example cannot have spaces.`, es: `${n.es}: el ejemplo no puede llevar espacios.` })
        const p = sourceProblem(b.suffix, { en: `button ${i + 1}'s link`, es: `el enlace del botón ${i + 1}` })
        if (p) problems.push(p)
      }
    }
    if (b.kind === 'phone') {
      const phone = b.phone.replace(/[\s-]/g, '')
      if (!phone) problems.push({ en: `${n.en}: write the phone number.`, es: `${n.es}: escribe el teléfono.` })
      else if (!/^\+?\d{6,}$/.test(phone)) {
        problems.push({ en: `${n.en}: write the number with its country code, like +34 600 000 000.`, es: `${n.es}: escribe el número con el prefijo del país, como +34 600 000 000.` })
      } else if (phone.length > BUTTON_PHONE_MAX) problems.push({ en: `${n.en}: the number is too long.`, es: `${n.es}: el número es demasiado largo.` })
    }
    if (b.kind === 'copy_code') {
      const code = b.code.trim()
      if (!code) problems.push({ en: `${n.en}: write the code it copies.`, es: `${n.es}: escribe el código que copia.` })
      else if (code.length > COPY_CODE_MAX) {
        problems.push({ en: `${n.en}: the code is ${code.length} characters; WhatsApp allows ${COPY_CODE_MAX}.`, es: `${n.es}: el código tiene ${code.length} caracteres; WhatsApp permite ${COPY_CODE_MAX}.` })
      } else if (/\s/.test(code)) problems.push({ en: `${n.en}: the code cannot have spaces.`, es: `${n.es}: el código no puede llevar espacios.` })
    }
    if (b.kind === 'form' && !b.docTemplateId) problems.push({ en: 'Choose the form the button opens.', es: 'Elige el formulario que abre el botón.' })
  })
  return problems
}

/** Why this file cannot go at the top of a template of this kind, or null when it can. */
export function headerFileProblem(kind: TemplateHeaderKind, file: { type: string; size: number } | null): Bilingual | null {
  if (!isMediaHeader(kind)) return null
  if (!file) {
    return kind === 'document'
      ? { en: 'Attach the PDF.', es: 'Adjunta el PDF.' }
      : kind === 'image'
        ? { en: 'Attach the image.', es: 'Adjunta la imagen.' }
        : { en: 'Attach the video.', es: 'Adjunta el vídeo.' }
  }
  const rule = HEADER_FILES[kind]
  if (!rule.mimeTypes.includes(file.type)) {
    return kind === 'document'
      ? { en: 'It has to be a PDF.', es: 'Tiene que ser un PDF.' }
      : kind === 'image'
        ? { en: 'It has to be a JPG or PNG image.', es: 'Tiene que ser una imagen JPG o PNG.' }
        : { en: 'It has to be an MP4 video.', es: 'Tiene que ser un vídeo MP4.' }
  }
  if (file.size > rule.maxBytes) {
    const mb = rule.maxBytes / (1024 * 1024)
    return { en: `The file is larger than ${mb} MB, which WhatsApp will not accept.`, es: `El archivo pesa más de ${mb} MB, y WhatsApp no lo acepta.` }
  }
  return null
}

const str = (v: unknown, max = 4000) => String(v ?? '').slice(0, max)

function sourceFrom(raw: any): ValueSource | null {
  if (raw?.source === 'text') return { source: 'text', text: str(raw.text, 2000) }
  if (raw?.source === 'first_name' || raw?.source === 'phone') return { source: raw.source }
  return null
}

function buttonFrom(raw: any): TemplateButton | null {
  switch (raw?.kind) {
    case 'quick_reply':
      return { kind: 'quick_reply', text: str(raw.text, 200) }
    case 'url':
      return { kind: 'url', text: str(raw.text, 200), url: str(raw.url, 2100), dynamic: raw.dynamic === true, example: str(raw.example, 2000), suffix: sourceFrom(raw.suffix) }
    case 'phone':
      return { kind: 'phone', text: str(raw.text, 200), phone: str(raw.phone, 40) }
    case 'copy_code':
      return { kind: 'copy_code', code: str(raw.code, 200) }
    case 'form':
      return { kind: 'form', text: str(raw.text, 200), docTemplateId: str(raw.docTemplateId, 64) }
    default:
      return null
  }
}

/**
 * A draft from whatever was posted: every field coerced to what a draft may
 * hold, unknown button kinds dropped, and an older page's `formButton` folded
 * into `buttons` -- so the checks after this see a draft, whatever arrived.
 */
export function normaliseDraft(parsed: any): TemplateDraft {
  const p = parsed && typeof parsed === 'object' ? parsed : {}
  const header = (['text', 'image', 'video', 'document', 'location'] as const).find((k) => k === p.header) ?? 'none'
  const loc = p.location && typeof p.location === 'object' ? p.location : null
  const buttons = Array.isArray(p.buttons)
    ? p.buttons.slice(0, BUTTONS_MAX + 1).map(buttonFrom).filter((b: TemplateButton | null): b is TemplateButton => !!b)
    : draftButtons({ formButton: p.formButton && typeof p.formButton === 'object' ? { text: str(p.formButton.text, 200), docTemplateId: str(p.formButton.docTemplateId, 64) } : null })
  return {
    name: str(p.name, NAME_MAX + 1).trim(),
    language: str(p.language, 20),
    category: p.category === 'MARKETING' ? 'MARKETING' : 'UTILITY',
    header,
    headerText: header === 'text' ? str(p.headerText, 200) : '',
    headerExample: header === 'text' ? str(p.headerExample, 200) : '',
    headerSource: header === 'text' ? sourceFrom(p.headerSource) : null,
    location:
      header === 'location' && loc
        ? { latitude: Number(loc.latitude), longitude: Number(loc.longitude), name: str(loc.name, 300), address: str(loc.address, 500) }
        : null,
    body: str(p.body, BODY_MAX * 2),
    examples: Array.isArray(p.examples) ? p.examples.slice(0, 100).map((e: unknown) => str(e, 1000)) : [],
    footer: str(p.footer, 500),
    buttons,
  }
}

/** One button as Meta's POST /{waba}/message_templates takes it. */
function metaButton(b: TemplateButton, origin: string): Record<string, unknown> {
  switch (b.kind) {
    case 'quick_reply':
      return { type: 'QUICK_REPLY', text: b.text.trim() }
    case 'phone':
      return { type: 'PHONE_NUMBER', text: b.text.trim(), phone_number: b.phone.replace(/[\s-]/g, '') }
    case 'copy_code':
      return { type: 'COPY_CODE', example: b.code.trim() }
    case 'url': {
      const url = buttonUrl(b)
      // A dynamic link is reviewed with a sample of the whole URL.
      return b.dynamic ? { type: 'URL', text: b.text.trim(), url, example: [url.replace('{{1}}', (b.example ?? '').trim())] } : { type: 'URL', text: b.text.trim(), url }
    }
    case 'form': {
      const url = formButtonUrl(origin)
      return { type: 'URL', text: b.text.trim(), url, example: [url.replace('{{1}}', 'ejemplo')] }
    }
  }
}

/**
 * The components Meta's POST /{waba}/message_templates takes. `headerHandle`
 * is what the resumable upload returned for the sample file; Meta wants the
 * sample at creation and reviews the template with it, but it is only a
 * sample -- each send attaches its own file.
 *
 * `origin` is the app a form button links to. Meta keeps that link for good,
 * so it has to be where patients open forms -- the origin the clinic is
 * using QuiroFlow from when it creates the template.
 */
export function templateComponents(draft: TemplateDraft, headerHandle: string | null, origin = ''): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = []
  if (isMediaHeader(draft.header) && headerHandle) {
    components.push({ type: 'HEADER', format: draft.header.toUpperCase(), example: { header_handle: [headerHandle] } })
  } else if (draft.header === 'text') {
    const text = (draft.headerText ?? '').trim()
    components.push({ type: 'HEADER', format: 'TEXT', text, ...(headerHasVariable(text) ? { example: { header_text: [(draft.headerExample ?? '').trim()] } } : {}) })
  } else if (draft.header === 'location') {
    // Nothing else: the place itself goes with each send.
    components.push({ type: 'HEADER', format: 'LOCATION' })
  }
  const body = draft.body.trim()
  const needed = exampleCount(body)
  components.push({
    type: 'BODY',
    text: body,
    ...(needed > 0 ? { example: { body_text: [draft.examples.slice(0, needed).map((e) => e.trim())] } } : {}),
  })
  const footer = draft.footer.trim()
  if (footer) components.push({ type: 'FOOTER', text: footer })
  const buttons = draftButtons(draft)
  if (buttons.length) components.push({ type: 'BUTTONS', buttons: buttons.map((b) => metaButton(b, origin)) })
  return components
}

/**
 * What QuiroFlow keeps to fill the template on each send: the heading's
 * source, the place, and per button what its blank takes. A quick reply's
 * payload is its own text -- what Meta reports back when none is sent -- so
 * a tap reads the same either way, and the webhook (which reads the text) is
 * unaffected. Null when the template needs nothing filled.
 */
export function sendValuesFromDraft(draft: TemplateDraft): TemplateSendValues | null {
  const values: TemplateSendValues = {}
  if (draft.header === 'text' && headerHasVariable(draft.headerText) && draft.headerSource) values.header = draft.headerSource
  if (draft.header === 'location' && draft.location) {
    const { latitude, longitude, name, address } = draft.location
    values.location = { latitude: Number(latitude), longitude: Number(longitude), name: String(name ?? '').trim(), address: String(address ?? '').trim() }
  }
  const buttons = draftButtons(draft).map((b) => {
    if (b.kind === 'url' && b.dynamic && b.suffix) return { suffix: b.suffix }
    if (b.kind === 'copy_code') return { code: b.code.trim() }
    if (b.kind === 'quick_reply') return { payload: b.text.trim() }
    return null
  })
  if (buttons.some(Boolean)) values.buttons = buttons
  return Object.keys(values).length ? values : null
}

/**
 * Where a template's file is kept in the whatsapp-media bucket, so the
 * automation that later uses the template can attach it without asking for it
 * again. The name and language are in the path because that is the pair a
 * template is known by, and a timestamp because a refused submission removes
 * its file again -- which must never be the file an earlier, approved template
 * of the same name is still using. Template names and language codes have no
 * dots, so the first three dots split them off the file name reliably.
 */
export const TEMPLATE_MEDIA_FOLDER = 'templates'

export function templateMediaPath(accountId: string, name: string, language: string, filename: string, at = Date.now()): string {
  return `${accountId}/${TEMPLATE_MEDIA_FOLDER}/${name}.${language}.${at}.${safeFileName(filename)}`
}

export function parseTemplateMediaName(objectName: string): { name: string; language: string; at: number; filename: string } | null {
  const m = objectName.match(/^([a-z0-9_]+)\.([A-Za-z_]+)\.(\d+)\.(.+)$/)
  return m ? { name: m[1]!, language: m[2]!, at: Number(m[3]), filename: m[4]! } : null
}

/** A file name storage accepts and a patient can still read: accents and spaces go, the extension stays. */
export function safeFileName(filename: string): string {
  const cleaned = filename
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9.-]+/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(-80) || 'archivo'
}

/**
 * Meta's rejection reason, said so a clinic knows what to change. Meta answers
 * with a code; an unknown one is shown as it came, which is still the thing
 * support needs.
 */
export function templateRejectionReason(code: string): Bilingual {
  switch (code) {
    case 'INVALID_FORMAT':
      return { en: 'Meta found the format invalid: check the variables and the file.', es: 'Meta ve el formato incorrecto: revisa las variables y el archivo.' }
    case 'TAG_CONTENT_MISMATCH':
      return { en: 'The category does not match the content: a promotional message has to be Marketing.', es: 'La categoría no encaja con el contenido: un mensaje promocional tiene que ser Marketing.' }
    case 'PROMOTIONAL':
      return { en: 'Meta considers it promotional: create it again as Marketing.', es: 'Meta lo considera promocional: créala de nuevo como Marketing.' }
    case 'ABUSIVE_CONTENT':
    case 'SCAM':
      return { en: 'Meta considers the content against its policies.', es: 'Meta considera que el contenido incumple sus políticas.' }
    default:
      return { en: code, es: code }
  }
}

// ---- Editing a template that already exists at Meta --------------------------
//
// Meta's edit (POST /{template-id}) REPLACES every component with the ones
// sent: there is no patching one part. So a template is only editable here
// when this dialog can say everything it has: a heading, a file or a place at
// the top, the message with numbered variables, a footer, and the buttons
// this dialog makes. One with anything else -- named variables, a GIF, a Flow,
// an OTP or catalogue button -- would come back from an edit without it, so
// those are left to WhatsApp Manager rather than quietly cut down.

/** A button as GET /api/whatsapp/templates lists it. */
export interface ExistingButton {
  type: string
  text: string
  url?: string | null
  /** A call button's number. */
  phoneNumber?: string | null
  /** Meta's sample: the whole link of a dynamic URL button, or a copy-code button's code. */
  example?: string | null
}

/** A template as GET /api/whatsapp/templates lists it: the parts an edit needs. */
export interface ExistingTemplate {
  id: string | null
  name: string
  language: string
  category: string
  status: string
  bodyText: string
  /** Meta's samples for the body's {{n}}, in order. */
  bodyExamples?: string[]
  footerText?: string | null
  headerText: string | null
  /** Meta's sample for the heading's {{1}}. */
  headerExample?: string | null
  mediaHeaderFormat: string | null
  buttons: ExistingButton[]
  /** The file it was created with in QuiroFlow, when it was. */
  headerMedia?: { type: string; storage_path: string; filename: string }
  /** The form its form button opens, when it was made with one in QuiroFlow. */
  form?: { docTemplateId: string }
  /** What QuiroFlow fills it with on each send, when it was made here. */
  sendValues?: TemplateSendValues | null
}

/** What POST /api/whatsapp/templates/{id} answers: the file the template now has, and the one it replaced. */
export interface EditedTemplateResult {
  name: string
  language: string
  /** What the template has at the top now. */
  header: TemplateHeaderKind
  headerMedia: { type: string; storage_path: string; filename: string } | null
  previousStoragePath: string | null
}

/** Meta lets these be edited; a PENDING one is mid-review and cannot be. */
export const EDITABLE_STATUSES = ['APPROVED', 'REJECTED', 'PAUSED']

/** Meta allows an approved template one edit a day, ten in thirty days; rejected and paused ones as many as needed. */
export const APPROVED_EDIT_LIMIT: Bilingual = {
  en: 'Meta reviews the change again. An approved template can be changed once a day, up to 10 times a month.',
  es: 'Meta revisa el cambio de nuevo. Una plantilla aprobada se puede cambiar una vez al día, hasta 10 veces al mes.',
}

/** The button types this dialog can say again. */
const EDITABLE_BUTTONS = ['URL', 'PHONE_NUMBER', 'QUICK_REPLY', 'COPY_CODE']
const NAMED_VARIABLE = /\{\{\s*[^\d\s}][^}]*\}\}/

/** Why this template cannot be edited in QuiroFlow, or null when it can. */
export function templateEditBlocker(t: ExistingTemplate): Bilingual | null {
  if (!t.id) return { en: 'Refresh from Meta to edit it.', es: 'Actualiza desde Meta para editarla.' }
  if (t.status === 'PENDING' || t.status === 'IN_APPEAL') {
    return { en: 'Meta is still reviewing it. It can be changed once Meta answers.', es: 'Meta todavía la está revisando. Se podrá cambiar cuando responda.' }
  }
  if (!EDITABLE_STATUSES.includes(t.status)) return { en: 'Meta has disabled it, so it cannot be changed.', es: 'Meta la ha desactivado, así que no se puede cambiar.' }
  const manager = { en: 'Edit it in WhatsApp Manager.', es: 'Edítala en WhatsApp Manager.' }
  const other = t.buttons.find((b) => !EDITABLE_BUTTONS.includes(b.type))
  if (other) {
    return { en: `It has a ${other.type.toLowerCase().replace(/_/g, ' ')} button, which QuiroFlow cannot edit. ${manager.en}`, es: `Tiene un botón de tipo ${other.type}, que QuiroFlow no sabe editar. ${manager.es}` }
  }
  // A dynamic link whose {{1}} is not at the end, or that has more than one:
  // the dialog only ever makes one at the end, as Meta requires today.
  if (t.buttons.some((b) => b.type === 'URL' && /\{\{/.test(b.url ?? '') && !/^[^{}]*\{\{1\}\}$/.test(b.url ?? ''))) {
    return { en: `A button's link has its variable somewhere QuiroFlow cannot edit. ${manager.en}`, es: `El enlace de un botón lleva la variable donde QuiroFlow no sabe editarla. ${manager.es}` }
  }
  if (t.mediaHeaderFormat && !['IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'].includes(t.mediaHeaderFormat)) {
    return { en: `It has a ${t.mediaHeaderFormat.toLowerCase()} at the top, which QuiroFlow cannot edit. ${manager.en}`, es: `Lleva arriba un ${t.mediaHeaderFormat}, que QuiroFlow no sabe editar. ${manager.es}` }
  }
  // {{name}} rather than {{1}}: a template made with named parameters, which
  // the numbered examples sent below would not match.
  if (NAMED_VARIABLE.test(t.bodyText) || NAMED_VARIABLE.test(t.headerText ?? '')) {
    return { en: `It uses named variables, which QuiroFlow cannot edit yet. ${manager.en}`, es: `Usa variables con nombre, que QuiroFlow aún no sabe editar. ${manager.es}` }
  }
  return null
}

/** What the header of an existing template is, as the dialog chooses it. */
export function templateHeaderKind(t: Pick<ExistingTemplate, 'mediaHeaderFormat'> & { headerText?: string | null }): TemplateHeaderKind {
  const kind = t.mediaHeaderFormat?.toLowerCase()
  if (kind === 'image' || kind === 'video' || kind === 'document' || kind === 'location') return kind
  return t.headerText != null ? 'text' : 'none'
}

/** One of Meta's buttons as the dialog edits it; `values` is what QuiroFlow sends in it. */
export function buttonFromTemplate(b: ExistingButton, values: NonNullable<TemplateSendValues['buttons']>[number] | undefined, formId: string): TemplateButton {
  if (b.type === 'URL' && isFormButton(b)) return { kind: 'form', text: b.text, docTemplateId: formId }
  if (b.type === 'URL') {
    const url = b.url ?? ''
    if (!url.endsWith('{{1}}')) return { kind: 'url', text: b.text, url }
    const base = url.slice(0, -'{{1}}'.length)
    const example = b.example ?? ''
    return { kind: 'url', text: b.text, url: base, dynamic: true, example: example.startsWith(base) ? example.slice(base.length) : example, suffix: values?.suffix ?? null }
  }
  if (b.type === 'PHONE_NUMBER') return { kind: 'phone', text: b.text, phone: b.phoneNumber ?? '' }
  if (b.type === 'COPY_CODE') return { kind: 'copy_code', code: values?.code ?? b.example ?? '' }
  return { kind: 'quick_reply', text: b.text }
}

/** The template as a draft, to edit it from what Meta has now. */
export function draftFromTemplate(t: ExistingTemplate): TemplateDraft {
  const header = templateHeaderKind(t)
  const values = t.sendValues ?? null
  return {
    name: t.name,
    language: t.language,
    category: t.category === 'MARKETING' ? 'MARKETING' : 'UTILITY',
    header,
    headerText: header === 'text' ? (t.headerText ?? '') : '',
    headerExample: header === 'text' ? (t.headerExample ?? '') : '',
    headerSource: values?.header ?? null,
    location: header === 'location' ? (values?.location ?? null) : null,
    body: t.bodyText,
    examples: Array.from({ length: exampleCount(t.bodyText) }, (_, i) => t.bodyExamples?.[i] ?? ''),
    footer: t.footerText ?? '',
    buttons: t.buttons.map((b, i) => buttonFromTemplate(b, values?.buttons?.[i] ?? undefined, t.form?.docTemplateId ?? '')),
  }
}

/** The file type a kept file was stored as, from its name: storage keeps no type the send path trusts. */
export function mimeTypeFromFilename(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'mp4') return 'video/mp4'
  return null
}
