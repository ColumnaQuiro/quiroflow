import { describe, expect, it } from 'vitest'
import { completeTemplateComponents, formButtonIndex, templateMediaFormat, type MetaTemplateDefinition } from '../../utils/whatsappTemplateSend'

// What goes to Meta's POST /{phone-number-id}/messages for each part of a
// template that takes a value on every send -- the shapes of
// developers.facebook.com/documentation/business-messaging/whatsapp/templates
// (components, utility-templates, coupon-templates, template-media). Meta
// refuses the whole send when one of them is missing, so each is pinned here.

const body = { type: 'body', parameters: [{ type: 'text', text: 'Lucía' }] }
const tpl = (components: MetaTemplateDefinition['components']): MetaTemplateDefinition => ({ name: 'plantilla', language: 'es', components: [{ type: 'BODY', text: 'Hola {{1}}, gracias.' }, ...(components ?? [])] })
const who = { firstName: 'Lucía', phone: '+34 612 345 678' }

describe('the header a send fills', () => {
  it('a heading with {{1}}: the first name, unless the template was made to take something else', () => {
    const t = tpl([{ type: 'HEADER', format: 'TEXT', text: 'Hola {{1}}', example: { header_text: ['Ana'] } }])
    expect(completeTemplateComponents(t, [body], who).components).toEqual([{ type: 'header', parameters: [{ type: 'text', text: 'Lucía' }] }, body])
    expect(completeTemplateComponents(t, [body], { ...who, values: { header: { source: 'text', text: 'Clínica Demo' } } }).components[0]).toEqual({ type: 'header', parameters: [{ type: 'text', text: 'Clínica Demo' }] })
    // No name to give: Meta's own sample rather than a refused send.
    expect(completeTemplateComponents(t, [body], {}).components[0]).toEqual({ type: 'header', parameters: [{ type: 'text', text: 'Ana' }] })
  })

  it('a heading without a variable takes nothing', () => {
    const t = tpl([{ type: 'HEADER', format: 'TEXT', text: 'Tu cita' }])
    const out = completeTemplateComponents(t, [body], who)
    expect(out.components).toEqual([body])
    expect(out.missing).toEqual([])
  })

  it('an image, a video or a PDF: the file the template was made with, a PDF with its name', () => {
    for (const format of ['IMAGE', 'VIDEO']) {
      const key = format.toLowerCase()
      expect(completeTemplateComponents(tpl([{ type: 'HEADER', format }]), [body], { headerMedia: { link: 'https://signed/x' } }).components[0]).toEqual({
        type: 'header',
        parameters: [{ type: key, [key]: { link: 'https://signed/x' } }],
      })
    }
    expect(completeTemplateComponents(tpl([{ type: 'HEADER', format: 'DOCUMENT' }]), [body], { headerMedia: { link: 'https://signed/g.pdf', filename: 'Guia.pdf' } }).components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'document', document: { link: 'https://signed/g.pdf', filename: 'Guia.pdf' } }],
    })
    expect(completeTemplateComponents(tpl([{ type: 'HEADER', format: 'IMAGE' }]), [body], {}).missing).toEqual(['header image'])
  })

  it('a location: the place kept with the template, latitude and longitude as strings', () => {
    const location = { latitude: 40.4168, longitude: -3.7038, name: 'Clínica Demo', address: 'Calle Mayor 1, Madrid' }
    expect(completeTemplateComponents(tpl([{ type: 'HEADER', format: 'LOCATION' }]), [body], { values: { location } }).components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'location', location: { latitude: '40.4168', longitude: '-3.7038', name: 'Clínica Demo', address: 'Calle Mayor 1, Madrid' } }],
    })
    expect(completeTemplateComponents(tpl([{ type: 'HEADER', format: 'LOCATION' }]), [body], {}).missing).toEqual(['header location'])
  })

  it("never replaces the header the sender attached", () => {
    const own = { type: 'header', parameters: [{ type: 'document', document: { link: 'https://patient/file.pdf' } }] }
    const out = completeTemplateComponents(tpl([{ type: 'HEADER', format: 'DOCUMENT' }]), [own, body], { headerMedia: { link: 'https://signed/g.pdf' } })
    expect(out.components).toEqual([own, body])
  })
})

describe('the buttons a send fills', () => {
  const buttons = (b: NonNullable<NonNullable<MetaTemplateDefinition['components']>[number]['buttons']>) => tpl([{ type: 'BUTTONS', buttons: b }])

  it("a dynamic link: the phone shaped as the template's sample wants it, a name URL-encoded, or a fixed text", () => {
    const t = buttons([{ type: 'URL', text: 'Reservar', url: 'https://clinica.example/reserva/{{1}}', example: ['https://clinica.example/reserva/?phone=34600000000'] }])
    const send = (suffix: any) => completeTemplateComponents(t, [body], { ...who, values: { buttons: [{ suffix }] } }).components.at(-1)!
    expect(send({ source: 'phone' })).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '?phone=34612345678' }] })
    expect(send({ source: 'first_name' }).parameters[0].text).toBe('Luc%C3%ADa')
    expect(send({ source: 'text', text: 'oferta verano' }).parameters[0].text).toBe('oferta%20verano')
  })

  it("a dynamic link nothing was set for: the end of Meta's own sample", () => {
    const t = buttons([{ type: 'URL', text: 'Ver', url: 'https://clinica.example/p?c={{1}}', example: ['https://clinica.example/p?c=verano'] }])
    expect(completeTemplateComponents(t, [body], who).components.at(-1)).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'verano' }] })
    expect(completeTemplateComponents(buttons([{ type: 'URL', text: 'Ver', url: 'https://clinica.example/{{1}}' }]), [body], who).missing).toEqual(['button 0 url'])
  })

  it('a fixed link and a call button take nothing', () => {
    const t = buttons([
      { type: 'URL', text: 'Web', url: 'https://clinica.example/' },
      { type: 'PHONE_NUMBER', text: 'Llamar', phone_number: '+34600000000' },
    ])
    const out = completeTemplateComponents(t, [body], who)
    expect(out.components).toEqual([body])
    expect(out.missing).toEqual([])
  })

  it('a copy-code button: the code kept with the template, or the sample Meta has', () => {
    const t = buttons([{ type: 'QUICK_REPLY', text: 'Sí' }, { type: 'COPY_CODE', text: 'Copy offer code', example: ['MUESTRA'] }])
    expect(completeTemplateComponents(t, [body], { values: { buttons: [null, { code: 'BIENVENIDA' }] } }).components.at(-1)).toEqual({
      type: 'button',
      sub_type: 'copy_code',
      index: '1',
      parameters: [{ type: 'coupon_code', coupon_code: 'BIENVENIDA' }],
    })
    expect(completeTemplateComponents(t, [body], {}).components.at(-1)!.parameters[0].coupon_code).toBe('MUESTRA')
  })

  it('a quick reply: its payload when the template was made in QuiroFlow, nothing otherwise (Meta does not require it)', () => {
    const t = buttons([{ type: 'QUICK_REPLY', text: 'Sí, voy' }, { type: 'QUICK_REPLY', text: 'No puedo' }])
    expect(completeTemplateComponents(t, [body], {}).components).toEqual([body])
    expect(completeTemplateComponents(t, [body], { values: { buttons: [{ payload: 'Sí, voy' }, { payload: 'No puedo' }] } }).components.slice(1)).toEqual([
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'Sí, voy' }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'No puedo' }] },
    ])
  })

  it('a form button the sender already filled is left as it is, and found by its place', () => {
    const t = buttons([
      { type: 'QUICK_REPLY', text: 'Ya lo hice' },
      { type: 'URL', text: 'Rellenar formulario', url: 'https://app.quiroflow.com/doc/{{1}}', example: ['https://app.quiroflow.com/doc/ejemplo'] },
    ])
    expect(formButtonIndex(t)).toBe(1)
    const form = { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'TOKEN' }] }
    expect(completeTemplateComponents(t, [body, form], who).components).toEqual([body, form])
  })
})

describe('a whole send', () => {
  const everything = tpl([
    { type: 'HEADER', format: 'LOCATION' },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: 'Reservar', url: 'https://clinica.example/r?phone={{1}}', example: ['https://clinica.example/r?phone=34600000000'] },
        { type: 'PHONE_NUMBER', text: 'Llamar', phone_number: '+34600000000' },
        { type: 'COPY_CODE', example: ['MUESTRA'] },
        { type: 'QUICK_REPLY', text: 'Sí' },
      ],
    },
  ])

  it('goes header, body, then the buttons by index', () => {
    const out = completeTemplateComponents(everything, [body], {
      ...who,
      values: {
        location: { latitude: 40.4, longitude: -3.7, name: 'Clínica', address: 'Calle Mayor 1' },
        buttons: [{ suffix: { source: 'phone' } }, null, { code: 'BIENVENIDA' }, { payload: 'Sí' }],
      },
    })
    expect(out.missing).toEqual([])
    expect(out.components.map((c) => `${c.type}${c.index ? `:${c.index}:${c.sub_type}` : ''}`)).toEqual(['header', 'body', 'button:0:url', 'button:2:copy_code', 'button:3:quick_reply'])
    expect(out.components[2].parameters[0].text).toBe('34612345678')
  })

  // The promise to every template already in use: one whose required parts
  // the sender fills goes to Meta exactly as it did before this existed.
  it('changes nothing for a template the sender already fills', () => {
    const t = tpl([{ type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Reservar', url: 'https://clinica.example/{{1}}' }] }])
    const components = [body, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'x' }] }]
    expect(completeTemplateComponents(t, components, who).components).toBe(components)
    expect(completeTemplateComponents(tpl([]), [body], who).components).toEqual([body])
    expect(completeTemplateComponents(null, [body], who).components).toEqual([body])
  })

  it('says which file a template wants at the top', () => {
    expect(templateMediaFormat(tpl([{ type: 'HEADER', format: 'DOCUMENT' }]))).toBe('document')
    expect(templateMediaFormat(tpl([{ type: 'HEADER', format: 'LOCATION' }]))).toBeNull()
  })
})
