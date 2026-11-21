import { describe, expect, it } from 'vitest'
import {
  buttonProblems,
  exampleCount,
  normaliseDraft,
  sendValuesFromDraft,
  formButtonUrl,
  isFormButton,
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

// A button that opens one of the clinic's forms: Meta stores the link, each
// send fills the {{1}} with the token of the patient's own copy.
describe('a form button', () => {
  const FORM = '7d0b2a1e-0000-4000-8000-000000000001'
  const withButton = (patch: Partial<NonNullable<TemplateDraft['formButton']>> = {}) =>
    draft({ header: 'none', formButton: { text: 'Rellenar formulario', docTemplateId: FORM, ...patch } })

  it('is accepted with words and a form', () => {
    expect(templateDraftProblems(withButton())).toEqual([])
  })

  it('needs words, at most 25 of them in characters, and no variables', () => {
    expect(es(withButton({ text: '  ' }))).toContain('Botón 1: escribe qué pone.')
    expect(es(withButton({ text: 'Rellenar el formulario de primera visita' }))[0]).toMatch(/WhatsApp permite 25/)
    expect(es(withButton({ text: 'Hola {{1}}' }))).toContain('Botón 1: el texto no puede llevar variables.')
  })

  it('needs the form it opens', () => {
    expect(es(withButton({ docTemplateId: '' }))).toContain('Elige el formulario que abre el botón.')
  })

  it('goes to Meta as a dynamic link to the public form page, with a sample', () => {
    const buttons = templateComponents(withButton(), null, 'https://app.quiroflow.com/').find((c) => c.type === 'BUTTONS')
    expect(buttons).toEqual({
      type: 'BUTTONS',
      buttons: [{ type: 'URL', text: 'Rellenar formulario', url: 'https://app.quiroflow.com/doc/{{1}}', example: ['https://app.quiroflow.com/doc/ejemplo'] }],
    })
    expect(templateComponents(draft({ header: 'none' }), null, 'https://app.quiroflow.com').some((c) => c.type === 'BUTTONS')).toBe(false)
  })

  it('is told apart from other link buttons by where it points', () => {
    expect(isFormButton({ type: 'URL', url: formButtonUrl('https://app.quiroflow.com') })).toBe(true)
    expect(isFormButton({ type: 'URL', url: 'https://app.quiroflow.com/oferta-primera-visita/{{1}}' })).toBe(false)
    expect(isFormButton({ type: 'QUICK_REPLY' })).toBe(false)
  })
})

// Every kind of part Meta takes, as POST /{waba}/message_templates receives it
// (developers.facebook.com/documentation/business-messaging/whatsapp/templates/components).
describe('every component Meta takes, at creation', () => {
  const base = (patch: Partial<TemplateDraft> = {}) => draft({ header: 'none', ...patch })
  const buttonsOf = (d: TemplateDraft) => templateComponents(d, null, 'https://app.quiroflow.com').find((c) => c.type === 'BUTTONS')

  it('a heading, with its one variable and the sample Meta reviews it with', () => {
    expect(templateComponents(base({ header: 'text', headerText: ' Hola {{1}} ', headerExample: 'Ana' }), null)[0]).toEqual({ type: 'HEADER', format: 'TEXT', text: 'Hola {{1}}', example: { header_text: ['Ana'] } })
    expect(templateComponents(base({ header: 'text', headerText: 'Tu cita está confirmada' }), null)[0]).toEqual({ type: 'HEADER', format: 'TEXT', text: 'Tu cita está confirmada' })
  })

  it('an image or a video, named by its upload handle', () => {
    expect(templateComponents(base({ header: 'image' }), 'H1')[0]).toEqual({ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['H1'] } })
    expect(templateComponents(base({ header: 'video' }), 'H2')[0]).toEqual({ type: 'HEADER', format: 'VIDEO', example: { header_handle: ['H2'] } })
  })

  it('a location, which takes nothing until each send', () => {
    const d = base({ header: 'location', location: { latitude: 40.4, longitude: -3.7, name: 'Clínica Demo', address: 'Calle Mayor 1' } })
    expect(templateComponents(d, null)[0]).toEqual({ type: 'HEADER', format: 'LOCATION' })
  })

  it('every button kind, in the order the clinic put them', () => {
    const d = base({
      buttons: [
        { kind: 'url', text: 'Nuestra web', url: 'https://clinica.example/' },
        { kind: 'url', text: 'Reservar', url: 'https://clinica.example/reserva?phone=', dynamic: true, example: '34600000000', suffix: { source: 'phone' } },
        { kind: 'phone', text: 'Llamar', phone: '+34 600 000 000' },
        { kind: 'copy_code', code: ' BIENVENIDA10 ' },
        { kind: 'quick_reply', text: 'Sí, voy' },
        { kind: 'quick_reply', text: 'No puedo' },
      ],
    })
    expect(buttonsOf(d)).toEqual({
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: 'Nuestra web', url: 'https://clinica.example/' },
        { type: 'URL', text: 'Reservar', url: 'https://clinica.example/reserva?phone={{1}}', example: ['https://clinica.example/reserva?phone=34600000000'] },
        { type: 'PHONE_NUMBER', text: 'Llamar', phone_number: '+34600000000' },
        { type: 'COPY_CODE', example: 'BIENVENIDA10' },
        { type: 'QUICK_REPLY', text: 'Sí, voy' },
        { type: 'QUICK_REPLY', text: 'No puedo' },
      ],
    })
    expect(templateDraftProblems(d)).toEqual([])
  })

  it('a form button beside the others, still a link to the patient\'s own copy', () => {
    const d = base({ buttons: [{ kind: 'form', text: 'Rellenar formulario', docTemplateId: 'f' }, { kind: 'quick_reply', text: 'Ya lo hice' }] })
    expect(buttonsOf(d)?.buttons).toEqual([
      { type: 'URL', text: 'Rellenar formulario', url: 'https://app.quiroflow.com/doc/{{1}}', example: ['https://app.quiroflow.com/doc/ejemplo'] },
      { type: 'QUICK_REPLY', text: 'Ya lo hice' },
    ])
  })
})

describe('what Meta refuses, before Meta is asked', () => {
  const qr = (text = 'Sí') => ({ kind: 'quick_reply' as const, text })
  const url = (patch = {}) => ({ kind: 'url' as const, text: 'Web', url: 'https://clinica.example/', ...patch })
  const ens = (b: Parameters<typeof buttonProblems>[0]) => buttonProblems(b).map((p) => p.en)

  it('ten buttons at most, two links (a form counts), one call, one code', () => {
    expect(ens(Array.from({ length: 11 }, () => qr()))[0]).toMatch(/10 buttons at most/)
    expect(ens([url(), url(), url()])).toContain('WhatsApp allows two link buttons at most (a form button is one).')
    expect(ens([url(), url(), { kind: 'form', text: 'Formulario', docTemplateId: 'f' }])).toContain('WhatsApp allows two link buttons at most (a form button is one).')
    expect(ens([{ kind: 'phone', text: 'A', phone: '+34600000000' }, { kind: 'phone', text: 'B', phone: '+34600000001' }])).toContain('WhatsApp allows one call button.')
    expect(ens([{ kind: 'copy_code', code: 'A' }, { kind: 'copy_code', code: 'B' }])).toContain('WhatsApp allows one copy-code button.')
    expect(ens(Array.from({ length: 10 }, () => qr()))).toEqual([])
  })

  it('quick replies together, before or after the rest', () => {
    const grouped = 'Put the quick replies together, before or after the other buttons.'
    expect(ens([qr(), qr(), url()])).toEqual([])
    expect(ens([url(), qr(), qr()])).toEqual([])
    expect(ens([qr(), url(), qr()])).toContain(grouped)
    expect(ens([url(), qr(), url({ text: 'Otra' })])).toContain(grouped)
  })

  it('a link that opens, ending in {{1}} only through "changes with each send", with a sample', () => {
    expect(ens([url({ url: 'clinica.example' })])[0]).toMatch(/https:\/\//)
    expect(ens([url({ url: 'https://clinica.example/{{1}}' })])[0]).toMatch(/without \{\{1\}\}/)
    expect(ens([url({ url: `https://clinica.example/${'a'.repeat(2000)}` })])[0]).toMatch(/too long/)
    expect(ens([url({ dynamic: true, example: '' })])[0]).toMatch(/example of the end/)
    expect(ens([url({ dynamic: true, example: 'con espacio' })])[0]).toMatch(/cannot have spaces/)
    expect(ens([url({ dynamic: true, example: 'abc', suffix: { source: 'text', text: ' ' } })])[0]).toMatch(/fixed text/)
    expect(ens([url({ dynamic: true, example: 'abc', suffix: { source: 'phone' } })])).toEqual([])
  })

  it('a phone with its country code, 20 characters at most', () => {
    expect(ens([{ kind: 'phone', text: 'Llamar', phone: '' }])[0]).toMatch(/phone number/)
    expect(ens([{ kind: 'phone', text: 'Llamar', phone: 'llámanos' }])[0]).toMatch(/country code/)
    expect(ens([{ kind: 'phone', text: 'Llamar', phone: '+3460000000000000000000' }])[0]).toMatch(/too long/)
  })

  it('a code of 20 characters at most, without spaces', () => {
    expect(ens([{ kind: 'copy_code', code: '' }])[0]).toMatch(/code it copies/)
    expect(ens([{ kind: 'copy_code', code: 'X'.repeat(21) }])[0]).toMatch(/WhatsApp allows 20/)
    expect(ens([{ kind: 'copy_code', code: 'DOS PALABRAS' }])[0]).toMatch(/cannot have spaces/)
  })

  it('a heading of one line, 60 characters, one {{1}} with its sample', () => {
    const p = (patch: Partial<TemplateDraft>) => templateDraftProblems(draft({ header: 'text', ...patch })).map((x) => x.en)
    expect(p({ headerText: '' })).toContain('Write the heading.')
    expect(p({ headerText: 'x'.repeat(61) })[0]).toMatch(/61 characters/)
    expect(p({ headerText: 'Hola {{1}} y {{2}}' })[0]).toMatch(/has to be \{\{1\}\}/)
    expect(p({ headerText: 'Hola {{2}}' })[0]).toMatch(/has to be \{\{1\}\}/)
    expect(p({ headerText: 'Hola {{1}}', headerExample: '' })[0]).toMatch(/example for the heading/)
    expect(p({ headerText: '*Hola*' })[0]).toMatch(/one line/)
    expect(p({ headerText: 'Hola {{1}}', headerExample: 'Ana' })).toEqual([])
  })

  it('a location with real coordinates', () => {
    const p = (location: TemplateDraft['location']) => templateDraftProblems(draft({ header: 'location', location })).map((x) => x.en)
    expect(p(null)[0]).toMatch(/latitude and longitude/)
    expect(p({ latitude: Number.NaN, longitude: -3.7, name: '', address: '' })[0]).toMatch(/latitude and longitude/)
    expect(p({ latitude: 91, longitude: -3.7, name: '', address: '' })[0]).toMatch(/latitude and longitude/)
    expect(p({ latitude: 40.4168, longitude: -3.7038, name: 'Clínica', address: '' })).toEqual([])
  })
})

describe('what each send is filled with, kept beside the template', () => {
  it('the heading source, the place, a link\'s end, the code and each quick reply', () => {
    const values = sendValuesFromDraft(
      draft({
        header: 'location',
        location: { latitude: 40.4, longitude: -3.7, name: ' Clínica Demo ', address: ' Calle Mayor 1 ' },
        buttons: [
          { kind: 'url', text: 'Reservar', url: 'https://clinica.example/r?phone=', dynamic: true, example: '346', suffix: { source: 'phone' } },
          { kind: 'phone', text: 'Llamar', phone: '+34600000000' },
          { kind: 'copy_code', code: 'BIENVENIDA' },
          { kind: 'quick_reply', text: 'Sí' },
        ],
      }),
    )
    expect(values).toEqual({
      location: { latitude: 40.4, longitude: -3.7, name: 'Clínica Demo', address: 'Calle Mayor 1' },
      buttons: [{ suffix: { source: 'phone' } }, null, { code: 'BIENVENIDA' }, { payload: 'Sí' }],
    })
    expect(sendValuesFromDraft(draft({ header: 'text', headerText: 'Hola {{1}}', headerExample: 'Ana', headerSource: { source: 'first_name' } }))).toEqual({ header: { source: 'first_name' } })
  })

  it('nothing for a template with no blanks of its own', () => {
    expect(sendValuesFromDraft(draft())).toBeNull()
  })
})

describe('a draft as posted', () => {
  it('reads an older page\'s form button as a button', () => {
    const d = normaliseDraft({ name: 'x', language: 'es', header: 'none', body: 'Hola', formButton: { text: 'Rellenar', docTemplateId: 'f' } })
    expect(d.buttons).toEqual([{ kind: 'form', text: 'Rellenar', docTemplateId: 'f' }])
  })

  it('keeps only what a draft may hold', () => {
    const d = normaliseDraft({ header: 'gif', buttons: [{ kind: 'flow', text: 'x' }, { kind: 'quick_reply', text: 5 }], location: { latitude: '40' } })
    expect(d.header).toBe('none')
    expect(d.location).toBeNull()
    expect(d.buttons).toEqual([{ kind: 'quick_reply', text: '5' }])
  })
})
