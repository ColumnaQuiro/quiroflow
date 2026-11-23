import { describe, expect, it } from 'vitest'
import {
  quirohiroAppointmentRows,
  quirohiroCalendarType,
  quirohiroNoteRows,
  quirohiroPatientRow,
  quirohiroPatients,
  quirohiroRecordText,
  quirohiroText,
  type QuirohiroSnapshot,
} from '../../utils/quirohiroRows'

// What a QuiroHiro (GoHighLevel) location becomes in QuiroFlow, from a copy
// shaped the way its v2 API answers. Every person here is invented.

const users = [
  { id: 'u1', name: 'Ana Prueba', firstName: 'Ana', lastName: 'Prueba' },
  { id: 'u2', name: 'Bruno Ejemplo', firstName: 'Bruno', lastName: 'Ejemplo' },
]
const calendars = [
  { id: 'cal-adj-ana', name: 'Sesión de Ajuste Ana', slotDuration: 30, slotDurationUnit: 'mins', teamMembers: [{ userId: 'u1' }] },
  { id: 'cal-first-bruno', name: 'Primera Visita Bruno', slotDuration: 75, slotDurationUnit: 'mins', teamMembers: [{ userId: 'u2' }] },
]
const folders = [
  { id: 'fo-contact', name: 'Contact', position: 0, standard: true },
  { id: 'fo-extra', name: 'Additional Info', position: 1, standard: true },
  { id: 'fo-motivo', name: 'Motivo de consultación', position: 2, standard: false },
  { id: 'fo-antecedentes', name: 'Antecedentes y sistemas', position: 3, standard: false },
  { id: 'fo-tratamiento', name: 'Tratamiento', position: 4, standard: false },
]
const fields = [
  { id: 'f-dni', name: 'DNI/NIF', fieldKey: 'contact.dninif', dataType: 'TEXT', parentId: 'fo-contact' },
  { id: 'f-gen', name: 'Género', fieldKey: 'contact.genero', dataType: 'SINGLE_OPTIONS', parentId: 'fo-contact', picklistOptions: ['Hombre', 'Mujer'] },
  { id: 'f-prof', name: 'Profesión', fieldKey: 'contact.profesion', dataType: 'TEXT', parentId: 'fo-contact' },
  { id: 'f-first', name: 'Primera vez con la quiropráctica', fieldKey: 'contact.primera_vez_con_la_quiroprctica', dataType: 'TEXT', parentId: 'fo-contact' },
  { id: 'f-utm', name: 'qh_attribution_utm_source', fieldKey: 'contact.qh_attribution_utm_source', dataType: 'TEXT', parentId: 'fo-extra' },
  { id: 'f-motivo', name: 'Motivo de consulta', fieldKey: 'contact.motivo_de_consulta', dataType: 'LARGE_TEXT', parentId: 'fo-motivo', position: 0 },
  { id: 'f-dolor', name: 'escala de dolor', fieldKey: 'contact.escala_de_dolor', dataType: 'SINGLE_OPTIONS', parentId: 'fo-motivo', position: 1 },
  {
    id: 'f-traumas', name: 'Traumas', fieldKey: 'contact.traumas', dataType: 'TEXTBOX_LIST', parentId: 'fo-antecedentes',
    picklistOptions: [{ id: 'opt-fract', label: 'fracturas' }, { id: 'opt-esg', label: 'esguinces' }],
  },
  { id: 'f-fecha', name: 'Fecha Primera Visita', fieldKey: 'contact.fecha_primera_visita', dataType: 'DATE', parentId: 'fo-tratamiento' },
  { id: 'f-files', name: 'Archivos', fieldKey: 'contact.archivos', dataType: 'FILE_UPLOAD', parentId: 'fo-motivo' },
]

const patient = {
  id: 'c-pat', firstName: 'Carla', lastName: 'Inventada Pérez', email: 'Carla@Example.com', phone: '+34611222333',
  additionalPhones: ['+34 611 222 333', '+33612345678'], dateOfBirth: '1985-04-12', type: 'paciente', tags: ['referido'],
  source: 'Facebook', dateAdded: '2025-02-01T10:00:00.000Z', assignedTo: 'u1', dnd: false,
  customFields: [
    { id: 'f-dni', value: '12345678z' },
    { id: 'f-gen', value: 'Mujer' },
    { id: 'f-prof', value: 'Profesora' },
    { id: 'f-first', value: 'Sí' },
    { id: 'f-utm', value: 'facebook' },
    { id: 'f-motivo', value: 'Dolor lumbar desde hace meses' },
    { id: 'f-dolor', value: '7' },
    { id: 'opt-fract', value: 'muñeca 2010' },
    { id: 'f-fecha', value: 1795132800000 },
    { id: 'f-files', value: { abc: { url: 'https://example.com/a.pdf' } } },
  ],
}
const lead = { id: 'c-lead', firstName: 'Diego', lastName: 'Lead', phone: '+34600000000', type: 'lead', tags: ['lead'], customFields: [{ id: 'f-utm', value: 'facebook' }] }
const bookedLead = { id: 'c-booked', contactName: 'Elena Reserva Sola', type: 'lead', tags: [], customFields: [] }
const examinedLead = { id: 'c-exam', firstName: 'Fabio', type: 'lead', customFields: [{ id: 'opt-esg', value: 'tobillo' }] }

const events = [
  { id: 'e1', calendarId: 'cal-adj-ana', contactId: 'c-pat', startTime: '2026-03-04T10:00:00+01:00', endTime: '2026-03-04T10:30:00+01:00', appointmentStatus: 'showed', assignedUserId: 'u1' },
  // The same event, read again in the next month's window.
  { id: 'e1', calendarId: 'cal-adj-ana', contactId: 'c-pat', startTime: '2026-03-04T10:00:00+01:00', endTime: '2026-03-04T10:30:00+01:00', appointmentStatus: 'showed', assignedUserId: 'u1' },
  { id: 'e2', calendarId: 'cal-adj-ana', contactId: 'c-pat', startTime: '2026-03-11T10:00:00+01:00', endTime: '2026-03-11T10:30:00+01:00', appointmentStatus: 'confirmed', assignedUserId: 'u1' },
  { id: 'e3', calendarId: 'cal-first-bruno', contactId: 'c-booked', startTime: '2099-01-10T09:00:00+01:00', endTime: '2099-01-10T10:15:00+01:00', appointmentStatus: 'confirmed', assignedUserId: 'u2', rescheduledAt: '2098-12-01T00:00:00Z', notes: '<p>Trae <b>resonancia</b></p>' },
  { id: 'e4', calendarId: 'cal-adj-ana', contactId: 'c-pat', startTime: '2026-03-18T10:00:00+01:00', appointmentStatus: 'noshow' },
  { id: 'e5', calendarId: 'cal-adj-ana', contactId: 'c-pat', startTime: '2026-03-25T10:00:00+01:00', appointmentStatus: 'cancelled' },
  // Two visits on one day: the note goes to the one that took place.
  { id: 'e6', calendarId: 'cal-adj-ana', contactId: 'c-pat', startTime: '2026-04-01T09:00:00+02:00', appointmentStatus: 'cancelled' },
  { id: 'e7', calendarId: 'cal-adj-ana', contactId: 'c-pat', startTime: '2026-04-01T17:00:00+02:00', appointmentStatus: 'showed' },
  { id: 'e-gone', calendarId: 'cal-adj-ana', contactId: 'c-pat', startTime: '2026-04-02T17:00:00+02:00', appointmentStatus: 'showed', deleted: true },
]
const notes = [
  { id: 'n1', contactId: 'c-pat', body: '<p>full spine</p>', bodyText: 'full spine', dateAdded: '2026-03-04T10:40:00.000Z' },
  // Written at 00:30 Madrid time on the 12th: the day after the visit, so on the history.
  { id: 'n2', contactId: 'c-pat', body: '<p>Llamó: mejor</p>', dateAdded: '2026-03-11T23:30:00.000Z' },
  { id: 'n3', contactId: 'c-pat', bodyText: 'pi derecho', dateAdded: '2026-04-01T16:00:00.000Z' },
  { id: 'n-empty', contactId: 'c-pat', body: '<p> </p>', dateAdded: '2026-04-01T16:00:00.000Z' },
  // The AI receptionist's handover, on a visit day: still the history, not the visit.
  { id: 'n-bot', contactId: 'c-pat', bodyText: '🤖 Laura transfirió la conversación a un humano.', dateAdded: '2026-03-04T08:00:00.000Z' },
]

const snapshot: QuirohiroSnapshot = {
  readAt: '2026-11-23T12:00:00Z', locationId: 'loc1', users, calendars, fields, folders,
  contacts: [patient, lead, bookedLead, examinedLead], events, notes,
}

describe('which QuiroHiro contacts come in', () => {
  it('brings patients, anyone with an appointment and anyone examined, and leaves leads out', () => {
    expect(quirohiroPatients(snapshot, 'patients').map((c) => c.id)).toEqual(['c-pat', 'c-booked', 'c-exam'])
  })
  it('brings everyone when the clinic asks for it', () => {
    expect(quirohiroPatients(snapshot, 'everyone')).toHaveLength(4)
  })
})

describe('a QuiroHiro contact as a patient', () => {
  it('maps the demographics, custom-field columns and phones', () => {
    const row = quirohiroPatientRow(patient, snapshot)
    expect(row.ref).toBe('QH-c-pat')
    expect(row.fields).toMatchObject({
      first_name: 'Carla', last_name: 'Inventada Pérez', email: 'carla@example.com', date_of_birth: '1985-04-12',
      national_id: '12345678Z', gender: 'female', occupation: 'Profesora', referral_source: 'Facebook', tags: ['referido'],
      reminder_channel: 'sms',
    })
    expect(row.practitioner).toBe('Ana Prueba')
    // The chief complaint is the Clinical tab's own field too.
    expect(row.clinical).toEqual({ chief_complaint: 'Dolor lumbar desde hace meses' })
    // The same number twice, spaced differently, is one number; a French one keeps its country.
    expect(row.phones).toEqual([{ country_code: 'ES', number: '611222333' }, { country_code: 'FR', number: '612345678' }])
  })
  it('splits a contact name when there are no name fields, and turns reminders off for do-not-disturb', () => {
    const row = quirohiroPatientRow({ ...bookedLead, dnd: true }, snapshot)
    expect(row.fields.first_name).toBe('Elena')
    expect(row.fields.last_name).toBe('Reserva Sola')
    expect(row.fields.reminder_channel).toBe('none')
  })
  it('drops a birth date in the future', () => {
    expect(quirohiroPatientRow({ ...patient, dateOfBirth: '2999-01-01' }, snapshot).fields.date_of_birth).toBeNull()
  })
})

describe('the clinical record', () => {
  it('lists the clinic\'s folders in order, then its own fields from GoHighLevel\'s folders', () => {
    const text = quirohiroRecordText(patient, snapshot)
    expect(text).toBe([
      'Ficha de QuiroHiro',
      '',
      'MOTIVO DE CONSULTACIÓN',
      'Motivo de consulta: Dolor lumbar desde hace meses',
      'escala de dolor: 7',
      '',
      'ANTECEDENTES Y SISTEMAS',
      'Traumas:',
      '  · fracturas: muñeca 2010',
      '',
      'TRATAMIENTO',
      'Fecha Primera Visita: 20/11/2026',
      '',
      'OTROS DATOS',
      'Primera vez con la quiropráctica: Sí',
    ].join('\n'))
    // DNI, gender and profession are columns; tracking fields and files are left out.
    expect(text).not.toMatch(/12345678|Mujer|Profesora|facebook|example\.com/)
  })
  it('is empty for a contact with nothing clinical', () => {
    expect(quirohiroRecordText(lead, snapshot)).toBe('')
  })
})

describe('appointments', () => {
  it('takes the practitioner\'s name off the calendar to get the type', () => {
    expect(quirohiroCalendarType(calendars[0]!, users)).toBe('Sesión de Ajuste')
    expect(quirohiroCalendarType(calendars[1]!, users)).toBe('Primera Visita')
    expect(quirohiroCalendarType({ id: 'x', name: 'Bruno' }, users)).toBe('Bruno')
  })
  it('maps statuses, lengths and moves, once per event', () => {
    const rows = quirohiroAppointmentRows(snapshot, '2026-11-23T12:00:00Z')
    const by = Object.fromEntries(rows.map((r) => [r.ref, r]))
    expect(rows.map((r) => r.ref).sort()).toEqual(['QH-appt-e1', 'QH-appt-e2', 'QH-appt-e3', 'QH-appt-e4', 'QH-appt-e5', 'QH-appt-e6', 'QH-appt-e7'])
    expect(by['QH-appt-e1']).toMatchObject({ status: 'completed', unmarked: false, type: 'Sesión de Ajuste', practitioner: 'Ana Prueba', minutes: 30, startsAt: '2026-03-04T09:00:00.000Z' })
    // Past and still "confirmed": attended, flagged as never marked.
    expect(by['QH-appt-e2']).toMatchObject({ status: 'completed', unmarked: true })
    expect(by['QH-appt-e3']).toMatchObject({ status: 'booked', unmarked: false, rescheduled: true, minutes: 75, practitioner: 'Bruno Ejemplo', note: 'Trae resonancia' })
    expect(by['QH-appt-e4']).toMatchObject({ status: 'no_show', minutes: 30, practitioner: 'Ana Prueba' })
    expect(by['QH-appt-e5']!.status).toBe('cancelled')
  })
})

describe('notes', () => {
  it('puts each note on the visit of its day, in the clinic\'s time, or on the history', () => {
    const rows = quirohiroNoteRows(snapshot, 'Europe/Madrid')
    expect(rows.map((r) => [r.ref, r.appointmentRef, r.text])).toEqual([
      ['QH-note-n1', 'QH-appt-e1', 'full spine'],
      ['QH-note-n2', null, 'Llamó: mejor'],
      ['QH-note-n3', 'QH-appt-e7', 'pi derecho'],
      ['QH-note-n-bot', null, '🤖 Laura transfirió la conversación a un humano.'],
    ])
  })
  it('reads the plain text out of the editor\'s HTML when there is no plain copy', () => {
    expect(quirohiroText('<p>Uno</p><p>Dos &amp; tres<br>cuatro</p>')).toBe('Uno\nDos & tres\ncuatro')
  })
})
