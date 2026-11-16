import type { DocField } from './docFields'

// A form in other languages (doc_templates.translations,
// 20261116144215_doc_template_translations_inline.sql).
//
// A form has ONE set of blocks, written in the clinic's own language. A
// translation carries only the words, per block id: the questions, their
// order and their types are always the original's. So a question added to
// the form is in every language at once -- in the original's words until
// someone translates it, which Settings > Docs counts as still to do.
//
// Pure: shared by the web, the mobile app and the server.

/** The languages a form can be translated into, besides the clinic's own (Spanish). */
export const DOC_LANGUAGES = ['en', 'fr', 'ca'] as const
export type DocLanguage = (typeof DOC_LANGUAGES)[number]

const LANGUAGE_NAMES: Record<string, [en: string, es: string]> = {
  es: ['Spanish', 'Español'],
  en: ['English', 'Inglés'],
  fr: ['French', 'Francés'],
  ca: ['Catalan', 'Catalán'],
}

export function docLanguageName(code: string | null | undefined, t: (en: string, es: string) => string): string {
  const name = code ? LANGUAGE_NAMES[code] : undefined
  return name ? t(name[0], name[1]) : (code ?? '')
}

export interface DocBlockTranslation {
  label?: string
  options?: string[]
}
export interface DocTranslation {
  title?: string
  fields?: Record<string, DocBlockTranslation>
}
export type DocTranslations = Partial<Record<string, DocTranslation>>

/** A template's translations column, made safe to read whatever it holds. */
export function docTranslationsOf(value: unknown): DocTranslations {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as DocTranslations) : {}
}

/** The languages a template has a translation in, in DOC_LANGUAGES order. */
export function docLanguagesOf(value: unknown): DocLanguage[] {
  const translations = docTranslationsOf(value)
  return DOC_LANGUAGES.filter((code) => !!translations[code])
}

/** Whether a block has words to translate: a label, or a choice's options. */
function hasText(f: DocField): boolean {
  return !!f.label?.trim() || (f.type === 'choice' && (f.options?.length ?? 0) > 0)
}

/** The blocks of a form that carry words, which is what a translation covers. */
export function translatableBlocks(fields: DocField[]): DocField[] {
  return fields.filter(hasText)
}

/** A choice's translated options, when they still line up one-to-one with the original's. */
function usableOptions(f: DocField, t: DocBlockTranslation | undefined): string[] | null {
  if (f.type !== 'choice' || !Array.isArray(f.options) || f.options.length === 0) return null
  const options = t?.options
  if (!Array.isArray(options) || options.length !== f.options.length) return null
  return options.every((o) => typeof o === 'string' && o.trim() !== '') ? options : null
}

/**
 * The ids of blocks still to translate into a language: no words for them
 * yet, or a choice whose options have changed in number since.
 */
export function untranslatedBlockIds(fields: DocField[], translation: DocTranslation | undefined): string[] {
  return translatableBlocks(fields)
    .filter((f) => {
      const t = translation?.fields?.[f.id]
      if (f.label?.trim() && !t?.label?.trim()) return true
      if (f.type === 'choice' && (f.options?.length ?? 0) > 0 && !usableOptions(f, t)) return true
      return false
    })
    .map((f) => f.id)
}

/**
 * A form as it is sent in `language`: its blocks with the translated words
 * laid over them. A block with no translation keeps the original's words
 * rather than going missing. `language` is what was used: null when the form
 * has no translation into it, and the original went out.
 */
export function docInLanguage(
  template: { title: string; fields: unknown; translations?: unknown },
  language: string | null | undefined,
): { title: string; fields: DocField[]; language: string | null } {
  const fields = Array.isArray(template.fields) ? (template.fields as DocField[]) : []
  const translation = language ? docTranslationsOf(template.translations)[language] : undefined
  if (!language || !translation) return { title: template.title, fields, language: null }
  return {
    title: translation.title?.trim() || template.title,
    language,
    fields: fields.map((f) => {
      const t = translation.fields?.[f.id]
      if (!t) return f
      const out: DocField = { ...f }
      if (t.label?.trim()) out.label = t.label
      const options = usableOptions(f, t)
      if (options) {
        out.options = options
        out.sourceOptions = f.options
      }
      return out
    }),
  }
}

/**
 * An answer on a patient's copy, in the original form's words: an option
 * chosen on a translated copy is read back as the original's option at the
 * same position. Anything else -- a number, free text, an "Other" answer --
 * is returned as it is.
 */
export function answerInOriginal(field: Pick<DocField, 'options' | 'sourceOptions'> | undefined, value: unknown): unknown {
  const from = field?.options
  const to = field?.sourceOptions
  if (!Array.isArray(from) || !Array.isArray(to) || from.length !== to.length) return value
  const one = (v: unknown) => {
    if (typeof v !== 'string') return v
    const i = from.indexOf(v)
    return i >= 0 ? to[i] : v
  }
  return Array.isArray(value) ? value.map(one) : one(value)
}

/**
 * Translations trimmed to the blocks the form still has, so a deleted
 * question leaves nothing behind. Languages are kept even when empty: the
 * clinic added them, and the editor shows them as still to translate.
 */
export function pruneDocTranslations(translations: DocTranslations, fields: DocField[]): DocTranslations {
  const ids = new Set(fields.map((f) => f.id))
  const out: DocTranslations = {}
  for (const [code, t] of Object.entries(translations)) {
    if (!t) continue
    const kept: Record<string, DocBlockTranslation> = {}
    for (const [id, block] of Object.entries(t.fields ?? {})) {
      if (!ids.has(id) || !block) continue
      const label = block.label?.trim() ? block.label : undefined
      const options = Array.isArray(block.options) && block.options.some((o) => o?.trim()) ? block.options : undefined
      if (label !== undefined || options !== undefined) kept[id] = { ...(label !== undefined ? { label } : {}), ...(options !== undefined ? { options } : {}) }
    }
    out[code] = { ...(t.title?.trim() ? { title: t.title } : {}), fields: kept }
  }
  return out
}
