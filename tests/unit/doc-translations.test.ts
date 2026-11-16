import { describe, it, expect } from 'vitest'
import type { DocField } from '../../utils/docFields'
import { answerInOriginal, docInLanguage, docLanguagesOf, pruneDocTranslations, untranslatedBlockIds } from '../../utils/docTranslations'
import { cleanAiFormTranslation, parseTranslateRequest, translationBatches, AI_TRANSLATE_MAX_BATCH } from '../../utils/aiFormTranslate'

// One form, its words in other languages by block id. What a patient is
// sent, what Settings > Docs counts as still to translate, and how an answer
// given in English is read by an automation written in Spanish.

const form: { title: string; fields: DocField[]; translations: unknown } = {
  title: 'Historia clínica',
  fields: [
    { id: 'h', type: 'heading', label: 'Hola {{first_name}}', value: null },
    { id: 'pain', type: 'choice', label: '¿Tienes dolor?', options: ['Sí', 'No'], value: null },
    { id: 'where', type: 'short_text', label: '¿Dónde?', value: null },
    { id: 'sign', type: 'signature', label: '', value: null },
  ],
  translations: {
    en: {
      title: 'Health history',
      fields: {
        h: { label: 'Hello {{first_name}}' },
        pain: { label: 'Are you in pain?', options: ['Yes', 'No'] },
      },
    },
  },
}

describe('docInLanguage', () => {
  it('lays the translated words over the same blocks', () => {
    const sent = docInLanguage(form, 'en')
    expect(sent.language).toBe('en')
    expect(sent.title).toBe('Health history')
    expect(sent.fields.map((f) => f.id)).toEqual(['h', 'pain', 'where', 'sign'])
    expect(sent.fields[1]).toMatchObject({ label: 'Are you in pain?', options: ['Yes', 'No'], sourceOptions: ['Sí', 'No'] })
  })

  it('keeps an untranslated question in the original rather than dropping it', () => {
    expect(docInLanguage(form, 'en').fields[2]!.label).toBe('¿Dónde?')
  })

  it('sends the original when there is no translation into that language', () => {
    const sent = docInLanguage(form, 'fr')
    expect(sent).toMatchObject({ language: null, title: 'Historia clínica' })
    expect(sent.fields[1]!.sourceOptions).toBeUndefined()
    expect(docInLanguage(form, null).language).toBeNull()
  })

  it('ignores options that no longer line up with the original', () => {
    const drifted = { ...form, translations: { en: { fields: { pain: { label: 'Pain?', options: ['Yes'] } } } } }
    const f = docInLanguage(drifted, 'en').fields[1]!
    expect(f.label).toBe('Pain?')
    expect(f.options).toEqual(['Sí', 'No'])
    expect(f.sourceOptions).toBeUndefined()
  })
})

describe('untranslatedBlockIds', () => {
  it('counts blocks with words and no translation, and skips blocks with none', () => {
    expect(untranslatedBlockIds(form.fields, (form.translations as any).en)).toEqual(['where'])
    expect(untranslatedBlockIds(form.fields, undefined)).toEqual(['h', 'pain', 'where'])
  })

  it('counts a choice whose options changed in number', () => {
    const fields = form.fields.map((f) => (f.id === 'pain' ? { ...f, options: ['Sí', 'No', 'A veces'] } : f))
    expect(untranslatedBlockIds(fields, (form.translations as any).en)).toContain('pain')
  })
})

describe('answerInOriginal', () => {
  it('reads an option picked on a translated copy as the original option', () => {
    const copy = docInLanguage(form, 'en').fields[1]!
    expect(answerInOriginal(copy, 'Yes')).toBe('Sí')
    expect(answerInOriginal({ ...copy, multiple: true } as DocField, ['Yes', 'No'])).toEqual(['Sí', 'No'])
  })

  it('leaves free text, numbers and copies in the original alone', () => {
    const copy = docInLanguage(form, 'en').fields[1]!
    expect(answerInOriginal(copy, 'Only at night')).toBe('Only at night')
    expect(answerInOriginal(form.fields[1], 'Sí')).toBe('Sí')
    expect(answerInOriginal(undefined, 7)).toBe(7)
  })
})

describe('pruneDocTranslations', () => {
  it('drops the words of deleted questions and keeps an empty language', () => {
    const pruned = pruneDocTranslations({ en: { title: 'X', fields: { gone: { label: 'Bye' }, pain: { label: 'Pain?' } } }, fr: { fields: {} } }, form.fields)
    expect(pruned).toEqual({ en: { title: 'X', fields: { pain: { label: 'Pain?' } } }, fr: { fields: {} } })
  })
})

describe('docLanguagesOf', () => {
  it('lists the languages present, whatever the column holds', () => {
    expect(docLanguagesOf(form.translations)).toEqual(['en'])
    expect(docLanguagesOf(null)).toEqual([])
    expect(docLanguagesOf([])).toEqual([])
  })
})

describe('translating with AI', () => {
  const blocks = form.fields.slice(0, 3).map((f) => ({ id: f.id, type: f.type, label: f.label, ...(f.options ? { options: f.options } : {}) }))

  it('keeps answers it can place, and drops the rest', () => {
    const out = cleanAiFormTranslation(
      {
        title: 'Health history',
        blocks: [
          { n: 1, label: 'Hello {{first_name}}', options: [] },
          { n: 2, label: 'Pain?', options: ['Yes'] }, // one option short
          { n: 3, label: 'Where?', options: [] },
          { n: 9, label: 'Invented', options: [] },
        ],
      },
      { title: 'Historia clínica', blocks },
    )
    expect(out.title).toBe('Health history')
    expect(Object.keys(out.fields)).toEqual(['h', 'where'])
  })

  it('refuses a translation that loses or invents a merge token', () => {
    const lost = cleanAiFormTranslation({ title: '', blocks: [{ n: 1, label: 'Hello there', options: [] }] }, { blocks })
    const invented = cleanAiFormTranslation({ title: '', blocks: [{ n: 3, label: 'Where, {{first_name}}?', options: [] }] }, { blocks })
    expect(lost.fields).toEqual({})
    expect(invented.fields).toEqual({})
  })

  it('splits a long form into batches, with the title in the first', () => {
    const long = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, type: 'text' as const, label: 'x'.repeat(2000) }))
    const batches = translationBatches(long, 'Consentimiento')
    expect(batches.length).toBeGreaterThan(1)
    expect(batches[0]!.title).toBe('Consentimiento')
    expect(batches.slice(1).every((b) => !b.title)).toBe(true)
    expect(batches.flatMap((b) => b.blocks).map((b) => b.id)).toEqual(long.map((b) => b.id))
    for (const b of batches) expect(parseTranslateRequest({ language: 'en', ...b })).not.toBeTypeOf('string')
  })

  it('sends a paragraph longer than a batch on its own', () => {
    const batches = translationBatches([{ id: 'a', type: 'text', label: 'y'.repeat(AI_TRANSLATE_MAX_BATCH + 500) }, { id: 'b', type: 'text', label: 'z' }])
    expect(batches.map((b) => b.blocks.map((x) => x.id))).toEqual([['a'], ['b']])
    expect(parseTranslateRequest({ language: 'en', ...batches[0] })).not.toBeTypeOf('string')
  })

  it('rejects an unknown language or an empty request', () => {
    expect(parseTranslateRequest({ language: 'de', blocks })).toBeTypeOf('string')
    expect(parseTranslateRequest({ language: 'en', blocks: [] })).toBeTypeOf('string')
  })
})
