import { describe, it, expect } from 'vitest'
import {
  parsePracticeHubFormDefinition,
  parsePracticeHubFormList,
  practiceHubDefinitionBlocks,
  practiceHubDefinitionImages,
  practiceHubDiagramUrl,
  practiceHubPlainText,
} from '../../utils/practicehubFormDefinition'

// PracticeHub's form editor, as its website served it on 10 Nov 2026: the
// list under Settings > Forms, and the builder data each editor page carries.
describe("PracticeHub's own description of a form", () => {
  let n = 0
  const newId = () => `id-${++n}`

  const editor = (data: unknown, titles: unknown) =>
    `<script> jQuery(document).ready(function($) { var formSections = [];
      saved_data = ${JSON.stringify(data)}; //var saved_data  = [{"type":"paragraph","label":"an older copy"}];
      saved_section_titles = ${JSON.stringify(titles)}; var options_one = { disabledAttrs: [ 'access' ] }; }); </script>`

  it('lists the forms, and which are inactive', () => {
    const html = `<table><tr> <th>Name</th><th>Type</th><th>Status</th><th>Action</th></tr>
      <tr class="tr-6"><td>AUTORIZACI&Oacute;N &amp; DATOS</td><td>Patient</td><td><span class="label label-success">Active</span></td><td><ul><li><a href="/settings/forms/form?action=update&amp;id=6">Edit</a></li><li><a href="#/" data-form-id="6" data-status="inactive">Make Inactive</a></li></ul></td></tr>
      <tr class="tr-12"><td>Antiguo</td><td>Practitioner</td><td><span class="label label-default">Inactive</span></td><td></td></tr></table>`
    expect(parsePracticeHubFormList(html)).toEqual([
      { id: '6', name: 'AUTORIZACIÓN & DATOS', active: true },
      { id: '12', name: 'Antiguo', active: false },
    ])
  })

  it('reads the builder data, not the commented-out copy beside it, and survives a "];" inside a label', () => {
    const definition = parsePracticeHubFormDefinition(
      editor([[{ type: 'paragraph', label: 'Opciones [a]; [b];' }, { type: 'signature', required: true, label: 'Firmado', name: 'signature-1708880832218' }]], ['Consentimiento ']),
    )
    expect(definition).toEqual({
      sections: [[{ type: 'paragraph', label: 'Opciones [a]; [b];' }, { type: 'signature', required: true, label: 'Firmado', name: 'signature-1708880832218' }]],
      titles: ['Consentimiento'],
    })
  })

  it('is null for a page that is not a form editor', () => {
    expect(parsePracticeHubFormDefinition('<html><body>Account Login</body></html>')).toBeNull()
  })

  it('makes every field the block type it was', () => {
    const definition = parsePracticeHubFormDefinition(
      editor(
        [
          [
            { type: 'header', label: 'Antecedentes' },
            { type: 'paragraph', label: 'En cumplimiento de la Ley&nbsp;Org&aacute;nica, <b>lee</b> esto.' },
            { type: 'text', label: 'Origen del dolor', name: 'text-1' },
            { type: 'textarea', required: true, label: 'Motivo', description: 'Con detalle.', name: 'textarea-1' },
            { type: 'number', label: 'De 0 a 10', min: '0', max: '10', name: 'number-1' },
            { type: 'number', label: 'Edad', name: 'number-2' },
            { type: 'date', label: 'Fecha', name: 'date-1' },
            { type: 'checkbox-group', required: true, label: 'Fracturas', name: 'checkbox-group-1', values: [{ label: 'Si', value: 'Si' }, { label: 'No', value: 'No' }] },
            { type: 'radio-group', label: 'Sistema', name: 'radio-group-1', values: [{ label: 'Espalda', value: 'Espalda', selected: true }, { label: 'Hombros', value: 'Hombros' }] },
            { type: 'select', label: 'Mano', name: 'select-1', values: [{ label: 'Diestro', value: 'Diestro' }, { label: 'Zurdo', value: 'Zurdo' }] },
            { type: 'drawableimage', label: '¿Dónde te duele?', name: 'drawableimage-1', form_image_id: 'assets/male_default.jpg' },
            { type: 'signature', required: true, label: 'Firmado', name: 'signature-1' },
          ],
        ],
        ['Section 1'],
      ),
    )!
    const blocks = practiceHubDefinitionBlocks(definition, { newId, imagePaths: new Map([['assets/male_default.jpg', 'acc/practicehub-assets-male-default.jpg']]) })
    expect(blocks.map((b) => [b.type, b.label, b.required ?? false])).toEqual([
      ['heading', 'Antecedentes', false],
      ['text', 'En cumplimiento de la Ley Orgánica, lee esto.', false],
      ['short_text', 'Origen del dolor', false],
      ['long_text', 'Motivo (Con detalle.)', true],
      ['scale', 'De 0 a 10', false],
      ['short_text', 'Edad', false],
      ['date', 'Fecha', false],
      ['choice', 'Fracturas', true],
      ['choice', 'Sistema', false],
      ['choice', 'Mano', false],
      ['drawable_image', '¿Dónde te duele?', false],
      ['signature', 'Firmado', true],
    ])
    expect(blocks[7]).toMatchObject({ multiple: true, options: ['Si', 'No'], value: [] })
    // A radio option PracticeHub pre-selects is not an answer the patient gave.
    expect(blocks[8]).toMatchObject({ multiple: false, options: ['Espalda', 'Hombros'], value: null })
    expect(blocks[10]!.imagePath).toBe('acc/practicehub-assets-male-default.jpg')
  })

  it('heads each section with its title only when the form has more than one', () => {
    const sections = [[{ type: 'text', label: 'Peso', name: 'text-1' }], [{ type: 'text', label: 'Sueño', name: 'text-2' }]]
    const many = practiceHubDefinitionBlocks(parsePracticeHubFormDefinition(editor(sections, ['Mi salud física   ', 'Mi salud mental ']))!, { newId })
    expect(many.map((b) => [b.type, b.label])).toEqual([['heading', 'Mi salud física'], ['short_text', 'Peso'], ['heading', 'Mi salud mental'], ['short_text', 'Sueño']])
    const one = practiceHubDefinitionBlocks(parsePracticeHubFormDefinition(editor([sections[0]], ['Section 1']))!, { newId })
    expect(one.map((b) => b.type)).toEqual(['short_text'])
  })

  it('leaves a drawable field without its picture a drawable field', () => {
    const definition = { sections: [[{ type: 'drawableimage', label: 'Marca', form_image_id: 0 }]], titles: [] }
    expect(practiceHubDefinitionImages(definition)).toEqual([])
    const [block] = practiceHubDefinitionBlocks(definition, { newId })
    expect(block).toMatchObject({ type: 'drawable_image', label: 'Marca' })
    expect(block!.imagePath).toBeUndefined()
  })

  it("builds a picture's address the way PracticeHub's form script does, and nothing outside it", () => {
    expect(practiceHubDiagramUrl('assets/male_default.jpg')).toBe('https://s3-eu-west-1.amazonaws.com/phub-dev/assets/male_default.jpg')
    expect(practiceHubDiagramUrl('clinic/form images/spine.png')).toBe('https://s3-eu-west-1.amazonaws.com/phub-production/clinic/form%20images/spine.png')
    expect(practiceHubDiagramUrl(0)).toBeNull()
    expect(practiceHubDiagramUrl('../other-bucket/x.png')).toBeNull()
    expect(practiceHubDiagramUrl('x.png?redirect=https://elsewhere.test')).toBeNull()
  })

  it('reads a label as text', () => {
    expect(practiceHubPlainText('<p>Uno &amp; dos</p><p>tres&nbsp;&#243;</p>')).toBe('Uno & dos\ntres ó')
  })
})
