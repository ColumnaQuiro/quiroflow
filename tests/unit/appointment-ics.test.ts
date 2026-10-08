import { describe, expect, it } from 'vitest'
import { appointmentIcs } from '../../server/utils/appointmentIcs'

const visit = {
  id: '11111111-2222-3333-4444-555555555555',
  startsAt: '2026-10-20T08:30:00.000Z',
  endsAt: '2026-10-20T09:00:00.000Z',
  title: 'Revisión · Clínica Demo',
  location: 'Calle Mayor, 12; 2º B\nValencia',
}

describe('a visit as an iCalendar file', () => {
  const ics = appointmentIcs(visit, new Date('2026-10-08T12:00:00Z'))

  it('is one event with UTC times, so the phone shows it at the right hour', () => {
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/)
    expect(ics).toContain('DTSTART:20261020T083000Z\r\n')
    expect(ics).toContain('DTEND:20261020T090000Z\r\n')
    expect(ics).toContain('UID:11111111-2222-3333-4444-555555555555@quiroflow.com\r\n')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('escapes the separators a clinic address is full of', () => {
    expect(ics).toContain('LOCATION:Calle Mayor\\, 12\; 2º B\\nValencia\r\n')
  })

  it('folds long lines at 75 bytes without splitting an accented character', () => {
    const long = appointmentIcs({ ...visit, title: 'Fisioterapia · '.repeat(8) + 'Clínica Ñandú' })
    for (const line of long.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
    const unfolded = long.replace(/\r\n /g, '')
    expect(unfolded).toContain('Clínica Ñandú')
  })

  it('leaves out a location it was not given', () => {
    expect(appointmentIcs({ ...visit, location: null })).not.toContain('LOCATION')
  })
})
