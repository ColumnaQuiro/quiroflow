import { describe, expect, it } from 'vitest'
import { buildPatientTimeline, type TimelineSources } from '../../utils/patientTimeline'

const es = (_en: string, es: string) => es
const now = new Date('2026-10-09T12:00:00Z')
const empty: TimelineSources = { now, timeZone: 'Europe/Madrid', staffNames: { tm1: 'Marta Ruiz' }, appointments: [], sent: [], received: [], calls: [], plans: [], exercises: [], documents: [], invoices: [] }

describe('the patient timeline', () => {
  it('orders everything newest first, and leaves out what has not happened yet', () => {
    const events = buildPatientTimeline(
      {
        ...empty,
        appointments: [
          { id: 'a1', starts_at: '2026-10-08T08:00:00Z', created_at: '2026-10-01T09:00:00Z', status: 'completed', appointment_types: { name: 'Ajuste' } },
          { id: 'a2', starts_at: '2026-10-15T08:00:00Z', created_at: '2026-10-08T08:30:00Z', status: 'booked', appointment_types: { name: 'Ajuste' } },
        ],
        calls: [{ id: 'c1', action: 'called_left_message', note: null, created_at: '2026-10-05T10:00:00Z', created_by: 'tm1' }],
      },
      es,
    )
    expect(events.map((e) => e.key)).toEqual(['appt-b-a2', 'appt-c-a1', 'call-c1', 'appt-b-a1'])
    expect(events[0].text).toBe('Ajuste reservada para el jue, 15 oct, 10:00')
    expect(events[1]).toMatchObject({ text: 'Ajuste realizada', actor: { kind: 'patient' }, tone: 'success' })
    expect(events[2]).toMatchObject({ category: 'recall', text: 'Llamada, dejó un mensaje', actor: { kind: 'staff', name: 'Marta Ruiz' } })
  })

  it('shows messages both ways with their channel, and a failed one as such', () => {
    const events = buildPatientTimeline(
      {
        ...empty,
        sent: [{ id: 's1', channel: 'push', kind: 'exercises', status: 'delivered', preview: 'Nuevo ejercicio para casa: Puente', sent_at: '2026-10-09T09:00:00Z' }, { id: 's2', channel: 'email', kind: 'other', status: 'bounced', preview: 'Tu factura', sent_at: '2026-10-09T08:00:00Z' }],
        received: [{ id: 'r1', channel: 'whatsapp', at: '2026-10-09T10:00:00Z', preview: 'Gracias!' }],
      },
      es,
    )
    expect(events.map((e) => [e.channel, e.actor.kind, e.text])).toEqual([
      ['WhatsApp', 'patient', 'Gracias!'],
      ['Push', 'system', 'Nuevo ejercicio para casa: Puente'],
      ['Email', 'system', 'Tu factura'],
    ])
    expect(events[2].tone).toBe('danger')
  })

  it('says who started a plan or assigned an exercise, and when a document was signed', () => {
    const events = buildPatientTimeline(
      {
        ...empty,
        plans: [{ id: 'p1', name: 'Lumbar', created_at: '2026-10-02T09:00:00Z', created_by: 'tm1', frequency_value: 1, frequency_unit: 'week', visits_per_period: 2, total_visits: 12 }],
        exercises: [{ id: 'e1', created_at: '2026-10-03T09:00:00Z', ended_at: null, assigned_by: null, exercises: { name: 'Puente' } }],
        documents: [{ id: 'd1', title: 'Consentimiento', created_at: '2026-10-01T09:00:00Z', completed_at: '2026-10-01T09:30:00Z', created_by: 'tm1' }],
        invoices: [{ id: 'i1', created_at: '2026-10-04T09:00:00Z', invoice_number: 'F-12', status: 'void' }],
      },
      es,
    )
    expect(events.map((e) => e.text)).toEqual([
      'Ejercicio para casa asignado: Puente',
      'Plan «Lumbar» iniciado: 12 visitas, 2 veces por semana',
      'Documento firmado: Consentimiento',
      'Documento enviado: Consentimiento',
    ])
    expect(events[1].actor).toEqual({ kind: 'staff', name: 'Marta Ruiz' })
    expect(events[0].actor).toEqual({ kind: 'system' })
  })
})
