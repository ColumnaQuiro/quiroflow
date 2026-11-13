import { describe, expect, it } from 'vitest'
import {
  exampleCount,
  headerFileProblem,
  parseTemplateMediaName,
  templateComponents,
  templateDraftProblems,
  templateMediaPath,
  templateNameFrom,
  type TemplateDraft,
} from '../../utils/whatsappTemplateDraft'

const draft = (patch: Partial<TemplateDraft> = {}): TemplateDraft => ({
  name: 'guia_post_ajuste',
  language: 'es',
  category: 'UTILITY',
  header: 'document',
  body: 'Hola {{1}}, aquí tienes la guía que comentamos.',
  examples: ['Ana'],
  footer: '',
  ...patch,
})
const es = (d: TemplateDraft) => templateDraftProblems(d).map((p) => p.es)

// A template as a clinic writes it, checked against what Meta refuses.
describe('a WhatsApp template draft', () => {
  it('names itself the way Meta accepts', () => {
    expect(templateNameFrom('Guía post-ajuste')).toBe('guia_post_ajuste')
    expect(templateNameFrom('  ¡Ejercicios de Lumbar! 2  ')).toBe('ejercicios_de_lumbar_2')
    expect(templateNameFrom('???')).toBe('')
  })

  it('accepts a guide with one variable', () => {
    expect(templateDraftProblems(draft())).toEqual([])
  })

  it('refuses a body that opens or closes on a variable', () => {
    expect(es(draft({ body: '{{1}}, aquí tienes la guía.' }))[0]).toMatch(/no puede empezar ni terminar/)
    expect(es(draft({ body: 'Aquí tienes la guía, {{1}}.' }))[0]).toMatch(/no puede empezar ni terminar/)
  })

  it('wants the variables numbered from 1 with none missing', () => {
    expect(es(draft({ body: 'Hola {{2}}, aquí tienes la guía.', examples: ['', 'Ana'] }))[0]).toMatch(/en orden/)
    expect(templateDraftProblems(draft({ body: 'Hola {{1}}, tu cita es el {{2}} a las {{2}} h.', examples: ['Ana', 'lunes'] }))).toEqual([])
  })

  it('asks for an example for every variable', () => {
    expect(exampleCount('Hola {{1}}, el {{2}} nos vemos.')).toBe(2)
    expect(es(draft({ body: 'Hola {{1}}, el {{2}} nos vemos.', examples: ['Ana', ' '] }))).toEqual(['Pon un ejemplo para {{2}} para que Meta pueda revisarla.'])
  })

  it('holds the footer to 60 characters and no variables', () => {
    expect(es(draft({ footer: 'x'.repeat(61) }))[0]).toMatch(/61 caracteres/)
    expect(es(draft({ footer: 'Hasta pronto {{1}}' }))[0]).toMatch(/pie no puede llevar variables/)
  })

  it('refuses a name Meta would not take', () => {
    expect(es(draft({ name: 'Guía' }))[0]).toMatch(/minúsculas/)
    expect(es(draft({ name: '' }))[0]).toMatch(/Ponle un nombre/)
  })
})

describe('the file at the top', () => {
  it('needs one when the template has a header', () => {
    expect(headerFileProblem('document', null)?.es).toBe('Adjunta el PDF.')
    expect(headerFileProblem('none', null)).toBeNull()
  })

  it('has to be the right kind and size', () => {
    expect(headerFileProblem('document', { type: 'image/png', size: 10 })?.es).toBe('Tiene que ser un PDF.')
    expect(headerFileProblem('image', { type: 'image/png', size: 6 * 1024 * 1024 })?.es).toMatch(/más de 5 MB/)
    expect(headerFileProblem('document', { type: 'application/pdf', size: 2 * 1024 * 1024 })).toBeNull()
  })
})

describe('what is sent to Meta', () => {
  it('names the sample file and the examples', () => {
    expect(templateComponents(draft({ footer: ' Clínica Demo ' }), 'HANDLE')).toEqual([
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: ['HANDLE'] } },
      { type: 'BODY', text: 'Hola {{1}}, aquí tienes la guía que comentamos.', example: { body_text: [['Ana']] } },
      { type: 'FOOTER', text: 'Clínica Demo' },
    ])
  })

  it('sends a text-only template with no header and no examples', () => {
    expect(templateComponents(draft({ header: 'none', body: 'Gracias por venir hoy.', examples: [] }), null)).toEqual([{ type: 'BODY', text: 'Gracias por venir hoy.' }])
  })
})

describe('where the file is kept', () => {
  it('reads back the template it belongs to', () => {
    const path = templateMediaPath('acc-1', 'guia_post_ajuste', 'pt_PT', 'Guía Lumbar (v2).pdf', 1700000000000)
    expect(path).toBe('acc-1/templates/guia_post_ajuste.pt_PT.1700000000000.Guia-Lumbar-v2.pdf')
    expect(parseTemplateMediaName(path.split('/').at(-1)!)).toEqual({ name: 'guia_post_ajuste', language: 'pt_PT', at: 1700000000000, filename: 'Guia-Lumbar-v2.pdf' })
  })

  it('ignores anything else in the folder', () => {
    expect(parseTemplateMediaName('1700000000000-saludo.mp4')).toBeNull()
  })
})
