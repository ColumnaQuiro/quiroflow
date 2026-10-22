import { describe, it, expect } from 'vitest'
import {
  formatPatientAttributeValue,
  normalizePatientAttributeValue,
  patientAttributeKeyFromLabel,
  patientAttributeMergeVars,
} from '../../utils/patientAttributes'

// Custom patient fields store their value as text in one form per kind, which
// the database checks (20261022185051_custom_patient_fields.sql). These are
// the conversions either side of it.

const es = (_en: string, es: string) => es

describe('patientAttributeKeyFromLabel', () => {
  it('makes a merge-field key from the label, without accents or punctuation', () => {
    expect(patientAttributeKeyFromLabel('Mutua / nº póliza', [])).toBe('mutua_n_poliza')
    expect(patientAttributeKeyFromLabel('Cómo nos conoció (detalle)', [])).toBe('como_nos_conocio_detalle')
  })

  it('stays unique among the clinic’s keys', () => {
    expect(patientAttributeKeyFromLabel('Deporte', ['deporte', 'deporte_2'])).toBe('deporte_3')
  })

  it('still gives a key the database accepts for a label with no letters', () => {
    expect(patientAttributeKeyFromLabel('¿?', [])).toMatch(/^[a-z0-9_]{1,40}$/)
  })
})

describe('normalizePatientAttributeValue', () => {
  it('turns a blank into no value at all', () => {
    expect(normalizePatientAttributeValue('text', '   ')).toBeNull()
    expect(normalizePatientAttributeValue('boolean', '')).toBeNull()
    expect(normalizePatientAttributeValue('choice', null)).toBeNull()
  })

  it('stores a number typed with a comma with a dot', () => {
    expect(normalizePatientAttributeValue('number', ' 42,5 ')).toBe('42.5')
  })

  it('stores yes/no as true/false', () => {
    expect(normalizePatientAttributeValue('boolean', 'true')).toBe('true')
    expect(normalizePatientAttributeValue('boolean', false)).toBe('false')
  })
})

describe('formatPatientAttributeValue', () => {
  it('reads each kind back as the record shows it', () => {
    expect(formatPatientAttributeValue('boolean', 'true', es)).toBe('Sí')
    expect(formatPatientAttributeValue('number', '42.5', es)).toBe('42,5')
    expect(formatPatientAttributeValue('date', '2026-03-01', es)).toBe('1 de marzo de 2026')
    expect(formatPatientAttributeValue('text', null, es)).toBe('')
  })
})

describe('patientAttributeMergeVars', () => {
  it('keys each answer as attr_<key> for document templates', () => {
    expect(
      patientAttributeMergeVars([
        { value: 'Pádel', patient_attributes: { key: 'deporte', kind: 'text' } },
        { value: 'false', patient_attributes: { key: 'consentimiento_fotos', kind: 'boolean' } },
        { value: 'x', patient_attributes: null },
      ]),
    ).toEqual({ attr_deporte: 'Pádel', attr_consentimiento_fotos: 'No' })
  })
})
