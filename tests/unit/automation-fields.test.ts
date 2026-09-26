import { describe, it, expect } from 'vitest'
import { answerKey, automationFieldValue, leadAnswersFromEvents } from '../../utils/automationFields'

const laura = { firstName: 'Laura', lastName: 'Gómez', email: 'laura@example.test' }
const at = '2026-10-02T08:30:00Z'

describe('Automation merge fields', () => {
  it('writes the appointment in the clinic\'s own time zone', () => {
    expect(automationFieldValue(laura, 'appointment_time', { nextAppointmentAt: at, clinicTimezone: 'Europe/Madrid' })).toBe('10:30')
    expect(automationFieldValue(laura, 'appointment_time', { nextAppointmentAt: at, clinicTimezone: 'Atlantic/Canary' })).toBe('09:30')
    expect(automationFieldValue(laura, 'appointment_date', { nextAppointmentAt: at, clinicTimezone: 'America/Bogota' })).toBe('2 de octubre de 2026')
  })

  it('falls back to Madrid for a clinic with no zone', () => {
    expect(automationFieldValue(laura, 'appointment_time', { nextAppointmentAt: at })).toBe('10:30')
  })

  it('gives a template the clinic\'s own contact details, on one line', () => {
    const ctx = { clinicName: 'Clínica Centro', clinicPhone: '+34 963 12 34 56', clinicAddress: 'Calle de Colón 14\n46004 Valencia' }
    expect(automationFieldValue(laura, 'clinic_name', ctx)).toBe('Clínica Centro')
    expect(automationFieldValue(laura, 'clinic_phone', ctx)).toBe('+34 963 12 34 56')
    expect(automationFieldValue(laura, 'clinic_address', ctx)).toBe('Calle de Colón 14, 46004 Valencia')
  })

  it('leaves a field empty rather than inventing one', () => {
    expect(automationFieldValue(laura, 'clinic_phone', {})).toBe('')
    expect(automationFieldValue(laura, 'next_appointment', {})).toBe('')
    expect(automationFieldValue(laura, 'first_name')).toBe('Laura')
  })
})

describe('Lead form answers as merge fields', () => {
  // As /api/public/v1/leads stores a Meta lead ad's field_data: the key
  // humanised into the question, the value as the answer.
  const events = [
    { body: { answers: [{ question: '¿Cuál sería el motivo de tu consulta?', answer: 'Dolor lumbar' }, { question: 'Horario preferido', answer: 'Tardes' }] } },
    { body: null },
    { body: { verdict: 'qualified' } },
    { body: { answers: [{ question: 'Horario preferido', answer: 'Mañanas\nsi puede ser' }] } },
  ]
  const leadAnswers = leadAnswersFromEvents(events)

  it('names each question as a token an email can hold', () => {
    expect(answerKey('¿Cuál sería el motivo de tu consulta?')).toBe('answer_cual_seria_el_motivo_de_tu_consulta')
    expect(answerKey('cuál_sería_el_motivo')).toBe('answer_cual_seria_el_motivo')
    expect(answerKey('¿?')).toBe('')
    expect(answerKey('x'.repeat(200))).toMatch(/^answer_x{60}$/)
    for (const q of ['¿Cuál sería el motivo de tu consulta?', 'Horario preferido', 'a — b / c']) expect(answerKey(q)).toMatch(/^\w+$/)
  })

  it('fills a variable with what the lead answered', () => {
    expect(automationFieldValue(laura, 'answer_cual_seria_el_motivo_de_tu_consulta', { leadAnswers })).toBe('Dolor lumbar')
  })

  it('takes the latest answer to a question, on one line', () => {
    expect(automationFieldValue(laura, 'answer_horario_preferido', { leadAnswers })).toBe('Mañanas, si puede ser')
  })

  it('is empty for a question the lead was not asked, or with no answers at all', () => {
    expect(automationFieldValue(laura, 'answer_presupuesto', { leadAnswers })).toBe('')
    expect(automationFieldValue(laura, 'answer_horario_preferido', {})).toBe('')
    expect(automationFieldValue(laura, 'answer_horario_preferido')).toBe('')
  })
})
