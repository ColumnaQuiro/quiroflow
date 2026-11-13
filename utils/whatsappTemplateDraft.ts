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
/** What sits above the text: nothing, or a file Meta shows as a picture, a video or a PDF. */
export type TemplateHeaderKind = 'none' | 'image' | 'video' | 'document'

export interface TemplateDraft {
  name: string
  language: string
  category: TemplateCategory
  header: TemplateHeaderKind
  body: string
  /** One sample per {{n}} in the body, in order. Meta reviews the template with these filled in. */
  examples: string[]
  footer: string
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
export const HEADER_FILES: Record<Exclude<TemplateHeaderKind, 'none'>, { mimeTypes: string[]; accept: string; maxBytes: number }> = {
  image: { mimeTypes: ['image/jpeg', 'image/png'], accept: 'image/jpeg,image/png', maxBytes: 5 * 1024 * 1024 },
  video: { mimeTypes: ['video/mp4'], accept: 'video/mp4', maxBytes: 15 * 1024 * 1024 },
  document: { mimeTypes: ['application/pdf'], accept: 'application/pdf,.pdf', maxBytes: 15 * 1024 * 1024 },
}

export const BODY_MAX = 1024
export const FOOTER_MAX = 60
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

/** Everything wrong with a draft, in the order a person would fix it. Empty when Meta should accept it. */
export function templateDraftProblems(draft: TemplateDraft): Bilingual[] {
  const problems: Bilingual[] = []

  if (!draft.name) problems.push({ en: 'Give the template a name.', es: 'Ponle un nombre a la plantilla.' })
  else if (!/^[a-z0-9_]+$/.test(draft.name)) {
    problems.push({ en: 'The name can only have lowercase letters, numbers and underscores.', es: 'El nombre solo puede llevar minúsculas, números y guiones bajos.' })
  } else if (draft.name.length > NAME_MAX) problems.push({ en: 'The name is too long.', es: 'El nombre es demasiado largo.' })

  if (!TEMPLATE_LANGUAGES.some((l) => l.code === draft.language)) problems.push({ en: 'Choose a language.', es: 'Elige un idioma.' })
  if (draft.category !== 'UTILITY' && draft.category !== 'MARKETING') problems.push({ en: 'Choose a category.', es: 'Elige una categoría.' })
  if (!['none', 'image', 'video', 'document'].includes(draft.header)) problems.push({ en: 'Choose what goes at the top.', es: 'Elige qué va arriba.' })

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

  return problems
}

/** Why this file cannot go at the top of a template of this kind, or null when it can. */
export function headerFileProblem(kind: TemplateHeaderKind, file: { type: string; size: number } | null): Bilingual | null {
  if (kind === 'none') return null
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

/**
 * The components Meta's POST /{waba}/message_templates takes. `headerHandle`
 * is what the resumable upload returned for the sample file; Meta wants the
 * sample at creation and reviews the template with it, but it is only a
 * sample -- each send attaches its own file.
 */
export function templateComponents(draft: TemplateDraft, headerHandle: string | null): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = []
  if (draft.header !== 'none' && headerHandle) {
    components.push({ type: 'HEADER', format: draft.header.toUpperCase(), example: { header_handle: [headerHandle] } })
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
  return components
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
