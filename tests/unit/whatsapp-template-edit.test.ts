import { describe, expect, it } from 'vitest'
import { draftFromTemplate, mimeTypeFromFilename, templateDraftProblems, templateEditBlocker, type ExistingTemplate } from '../../utils/whatsappTemplateDraft'

const existing = (patch: Partial<ExistingTemplate> = {}): ExistingTemplate => ({
  id: '1234567890',
  name: 'guia_lumbar',
  language: 'es',
  category: 'UTILITY',
  status: 'APPROVED',
  bodyText: 'Hola {{1}}, aquí tienes tu guía de {{2}} para casa.',
  bodyExamples: ['Ana', 'ejercicios'],
  footerText: 'Clínica Demo',
  headerText: null,
  mediaHeaderFormat: 'DOCUMENT',
  buttons: [],
  ...patch,
})

describe('templateEditBlocker', () => {
  it('lets approved, rejected and paused templates be edited', () => {
    for (const status of ['APPROVED', 'REJECTED', 'PAUSED']) expect(templateEditBlocker(existing({ status }))).toBeNull()
  })

  it('waits while Meta is still reviewing it', () => {
    expect(templateEditBlocker(existing({ status: 'PENDING' }))?.en).toContain('still reviewing')
  })

  it('refuses a disabled one', () => {
    expect(templateEditBlocker(existing({ status: 'DISABLED' }))?.en).toContain('disabled')
  })

  // Meta replaces every component on an edit: what the dialog cannot say
  // would be deleted, so these go to WhatsApp Manager instead.
  it('leaves templates with parts the dialog cannot rebuild to WhatsApp Manager', () => {
    expect(templateEditBlocker(existing({ buttons: [{ type: 'URL', text: 'Reservar', url: 'https://app.quiroflow.com/reserva/{{1}}' }] }))?.en).toContain('buttons')
    expect(templateEditBlocker(existing({ headerText: 'Tu cita', mediaHeaderFormat: null }))?.en).toContain('heading')
    expect(templateEditBlocker(existing({ mediaHeaderFormat: 'LOCATION' }))?.en).toContain('location')
    expect(templateEditBlocker(existing({ bodyText: 'Hola {{first_name}}, tu guía.' }))?.en).toContain('named variables')
  })

  it('edits a template whose only button opens a form, which the dialog can rebuild', () => {
    const form = { type: 'URL', text: 'Rellenar formulario', url: 'https://app.quiroflow.com/doc/{{1}}' }
    expect(templateEditBlocker(existing({ buttons: [form] }))).toBeNull()
    expect(templateEditBlocker(existing({ buttons: [form, { type: 'QUICK_REPLY', text: 'Llamar' }] }))?.en).toContain('buttons')
  })

  it('needs the id Meta lists it under', () => {
    expect(templateEditBlocker(existing({ id: null }))).not.toBeNull()
  })
})

describe('draftFromTemplate', () => {
  it('fills the form from what Meta has now', () => {
    expect(draftFromTemplate(existing())).toEqual({
      name: 'guia_lumbar',
      language: 'es',
      category: 'UTILITY',
      header: 'document',
      body: 'Hola {{1}}, aquí tienes tu guía de {{2}} para casa.',
      examples: ['Ana', 'ejercicios'],
      footer: 'Clínica Demo',
      formButton: null,
    })
  })

  it('keeps a form button and the form QuiroFlow knows it opens', () => {
    const tpl = existing({
      buttons: [{ type: 'URL', text: 'Rellenar formulario', url: 'https://app.quiroflow.com/doc/{{1}}' }],
      form: { docTemplateId: '7d0b2a1e-0000-4000-8000-000000000001' },
    })
    expect(draftFromTemplate(tpl).formButton).toEqual({ text: 'Rellenar formulario', docTemplateId: '7d0b2a1e-0000-4000-8000-000000000001' })
    // Made in WhatsApp Manager: the button is there, the form is for the clinic to choose.
    expect(draftFromTemplate(existing({ buttons: tpl.buttons })).formButton).toEqual({ text: 'Rellenar formulario', docTemplateId: '' })
  })

  it('leaves an example blank where Meta has none, for the clinic to give one', () => {
    expect(draftFromTemplate(existing({ bodyExamples: [] })).examples).toEqual(['', ''])
  })
})

describe('templateDraftProblems when editing', () => {
  // A template made in WhatsApp Manager can be in a language the create
  // dialog never offers; an edit cannot change it, so it is not the clinic's
  // problem to fix.
  it('does not judge the name or language, which Meta will not let change', () => {
    const draft = { ...draftFromTemplate(existing({ language: 'en_US' })), name: 'Old-Name' }
    expect(templateDraftProblems(draft)).not.toHaveLength(0)
    expect(templateDraftProblems(draft, { editing: true })).toHaveLength(0)
  })

  it('still checks everything Meta checks', () => {
    const draft = { ...draftFromTemplate(existing()), footer: 'Hola {{1}}' }
    expect(templateDraftProblems(draft, { editing: true }).map((p) => p.en)).toContain('The footer cannot have variables.')
  })
})

describe('mimeTypeFromFilename', () => {
  it('reads the type of a kept file from its name', () => {
    expect(mimeTypeFromFilename('Guia-lumbar.pdf')).toBe('application/pdf')
    expect(mimeTypeFromFilename('foto.JPEG')).toBe('image/jpeg')
    expect(mimeTypeFromFilename('saludo.mp4')).toBe('video/mp4')
    expect(mimeTypeFromFilename('notas.txt')).toBeNull()
  })
})
