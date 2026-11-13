import { describe, it, expect } from 'vitest'
import { nationalIdAnswer, patientFieldForQuestion } from '../../utils/docFields'
import { practiceHubFormBlocks, type PracticeHubFormField } from '../../utils/practicehubFormFields'
import { practiceHubDefinitionBlocks } from '../../utils/practicehubFormDefinition'

// An imported intake form asked for the patient's DNI, but its question was
// not linked to the profile, so none of the answers reached it (13 Nov 2026).
describe('imported forms fill the patient DNI', () => {
  it('links a question for the patient’s own document', () => {
    for (const label of ['DNI', 'DNI/NIE', 'DNI/NIE/Pasaporte', 'DNI:', 'NIF *', 'Nº de DNI', 'Número de DNI', 'DNI o pasaporte', 'Documento de identidad', 'Passport', 'ID number', 'Your ID number'])
      expect(patientFieldForQuestion(label), label).toBe('national_id')
  })

  it('leaves someone else’s document, and anything that is not that question, unlinked', () => {
    for (const label of [
      'DNI Madre/Padre/Tutor legal',
      'DNI/NIF/NIE du père/mère/représentant et/ou tuteur légal',
      "Parent or guardian's ID number",
      'NIF de la empresa',
      // A minors' consent: "D/Dña. ..., mayor de edad, con NIF ..., representante del menor ..., con NIF ..."
      'mayor de edad, con NIF',
      'con NIF',
      'of legal age, with NIF',
      'Documento',
      'Nombre y teléfono de contacto',
      '¿A qué te dedicas?',
      'Todo ello, por escrito acompañado de copia del documento oficial que lo identifique dirigido al responsable',
      'Ingeniería',
      '',
    ])
      expect(patientFieldForQuestion(label), label).toBeUndefined()
    expect(patientFieldForQuestion(null)).toBeUndefined()
  })

  it('accepts the answers the public form would, and nothing else', () => {
    expect(nationalIdAnswer(' 12345678Z ')).toBe('12345678Z')
    expect(nationalIdAnswer('X-1234567-L')).toBe('X-1234567-L')
    expect(nationalIdAnswer('no lo sé!')).toBeNull()
    expect(nationalIdAnswer('12')).toBeNull()
    expect(nationalIdAnswer('')).toBeNull()
    expect(nationalIdAnswer(null)).toBeNull()
    expect(nationalIdAnswer(true)).toBeNull()
  })

  it('carries the link on the imported answer and on the template', () => {
    const row = (name: string, value: string, label: string): PracticeHubFormField => ({ name, value, label })
    const data = [row('text-1', '12345678Z', 'DNI'), row('text-2', 'Y1234567X', 'DNI Madre/Padre/Tutor legal')]
    const [own, guardian] = practiceHubFormBlocks(data, { newId: () => 'id' })
    expect(own).toMatchObject({ type: 'short_text', value: '12345678Z', patientField: 'national_id' })
    expect(guardian!.patientField).toBeUndefined()
    expect(practiceHubFormBlocks(data, { blank: true, newId: () => 'id' })[0]).toMatchObject({ value: null, patientField: 'national_id' })
  })

  it('links the DNI question on a template read from PracticeHub’s form definition', () => {
    const blocks = practiceHubDefinitionBlocks(
      { sections: [[{ type: 'text', label: 'DNI' }, { type: 'text', label: 'DNI Madre/Padre/Tutor legal' }]], titles: [] } as never,
      { newId: () => 'id' },
    )
    expect(blocks.map((b) => b.patientField)).toEqual(['national_id', undefined])
  })
})
