import { describe, it, expect } from 'vitest'
import { practiceHubFormBlocks, practiceHubFormOptions, type PracticeHubFormField } from '../../utils/practicehubFormFields'

// Settings › Import › Forms turns PracticeHub's flat {name, value, label} rows
// into a document's blocks. Shapes as PracticeHub's Classic API returned them
// on 10 Nov 2026.
describe('PracticeHub form responses as document blocks', () => {
  let n = 0
  const newId = () => `id-${++n}`
  const row = (name: string, value: string | null, label = ''): PracticeHubFormField => ({ name, value, label, help_text: '' })

  it('keeps which options were ticked, as one question rather than a ticked box per option', () => {
    const data = [
      row('checkbox-group-1602421484765[]', 'Fisioterapeuta', '¿Has visitado a algún otro especialista?'),
      row('checkbox-group-1602421484765[]', 'Osteópata', '¿Has visitado a algún otro especialista?'),
      row('textarea-1', 'Hace dos años', 'Última visita'),
    ]
    const blocks = practiceHubFormBlocks(data, { newId })
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'choice', multiple: true, label: '¿Has visitado a algún otro especialista?', options: ['Fisioterapeuta', 'Osteópata'], value: ['Fisioterapeuta', 'Osteópata'] })
    expect(blocks[1]).toMatchObject({ type: 'short_text', value: 'Hace dos años' })
  })

  it('lists the options other patients ticked too, so an unticked one still shows', () => {
    const question = 'checkbox-group-1602421484765[]'
    const mine = [row(question, 'Osteópata', 'Especialistas')]
    const options = practiceHubFormOptions([{ data: [row(question, 'Fisioterapeuta'), row(question, 'Médico')] }, { data: mine }, { data: null }])
    expect(options.get(question)).toEqual(['Fisioterapeuta', 'Médico', 'Osteópata'])
    const [block] = practiceHubFormBlocks(mine, { options, newId })
    expect(block).toMatchObject({ options: ['Fisioterapeuta', 'Médico', 'Osteópata'], value: ['Osteópata'] })
  })

  it('keeps two different checkbox questions apart when one follows the other', () => {
    const blocks = practiceHubFormBlocks([row('checkbox-group-1[]', 'Yoga', 'Por tu cuenta'), row('checkbox-group-2[]', 'Acepto', 'Marca si aceptas')], { newId })
    expect(blocks.map((b) => b.value)).toEqual([['Yoga'], ['Acepto']])
  })

  it('shows fixed text as text however short, not as a question called "Answer"', () => {
    const blocks = practiceHubFormBlocks([row('429', '<p>Si el firmante es menor de edad, firma su tutor.</p>'), row('3605', '')], { newId })
    expect(blocks).toEqual([{ id: expect.any(String), type: 'text', label: 'Si el firmante es menor de edad, firma su tutor.', value: null }])
  })

  it('says a signature or a drawing was there, since the API carries only the widget id', () => {
    const blocks = practiceHubFormBlocks(
      [row('signature-signature-1602515975456', 'signature-signature-1602515975456', 'Firma'), row('sketchpad-drawableimage-1661983485759', 'sketchpad-drawableimage-1661983485759')],
      { newId },
    )
    expect(blocks.map((b) => [b.type, b.label, b.value])).toEqual([
      ['text', 'Firma: signed (via PracticeHub)', null],
      ['text', "Diagram: drawing captured (not available via PracticeHub's API)", null],
    ])
  })

  it('gives the template the questions without the answers', () => {
    const blocks = practiceHubFormBlocks(
      [row('checkbox-group-1[]', 'Yoga', 'Por tu cuenta'), row('date-1', '2026-11-10', 'Fecha'), row('radio-group-1', '7', '¿Cómo puntuarías tu salud hoy?')],
      { blank: true, newId },
    )
    expect(blocks.map((b) => [b.type, b.value])).toEqual([['choice', []], ['date', null], ['short_text', null]])
    expect(blocks[0]!.options).toEqual(['Yoga'])
  })
})
