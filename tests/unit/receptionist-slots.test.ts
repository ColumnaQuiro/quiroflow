import { describe, it, expect } from 'vitest'
import {
  FREE_TIMES_MAX_DAYS,
  MAX_TIMES_PER_LIST,
  parseFreeTimesInput,
  receptionistBookingSection,
  receptionistClockSection,
  receptionistSlotGroups,
  type ReceptionistSlotQuery,
} from '../../utils/receptionistSlots'

// The free times the AI receptionist is given to offer (utils/receptionistSlots.ts).
//
// It used to be told to "offer up to N times" with no calendar and no date,
// so every time it offered was made up.
describe('Receptionist free times', () => {
  const weekdays = { mon: [['09:00', '12:00']], tue: [['09:00', '12:00']], wed: [['09:00', '12:00']], thu: [['09:00', '12:00']], fri: [['09:00', '12:00']], sat: [], sun: [] } as Record<string, [string, string][]>
  // Monday 5 Oct 2026, 08:00 in Madrid (UTC+2).
  const now = new Date('2026-10-05T06:00:00Z')
  const base: ReceptionistSlotQuery = {
    now,
    clinics: [{ id: 'c1', name: 'Centro', timeZone: 'Europe/Madrid', businessHours: weekdays }],
    practitioners: [{ id: 'p1', businessHours: null, clinicIds: ['c1'] }],
    types: [{ id: 't1', name: 'Primera visita', durationMinutes: 60 }],
    appointments: [],
    blocks: [],
    bookingWindowDays: 2,
    minimumNoticeMinutes: 120,
  }
  const days = (q: ReceptionistSlotQuery) => receptionistSlotGroups(q)!.groups.map((g) => g.days)

  it("offers starts after the notice and inside the window, on the clinic's clock", () => {
    // Notice ends 10:00 Monday (a start exactly then is not after it); the
    // window ends 08:00 Wednesday, before Wednesday opens.
    expect(days(base)).toEqual([
      [
        { date: '2026-10-05', times: ['11:00'] },
        { date: '2026-10-06', times: ['09:00', '10:00', '11:00'] },
      ],
    ])
  })

  it('leaves out appointments and blocks, the way the public API does', () => {
    const q: ReceptionistSlotQuery = {
      ...base,
      clinics: [...base.clinics, { id: 'c2', name: 'Norte', timeZone: 'Europe/Madrid', businessHours: weekdays }],
      practitioners: [{ id: 'p1', businessHours: null, clinicIds: ['c1'] }],
      appointments: [{ practitionerId: 'p1', starts_at: '2026-10-06T07:00:00Z', ends_at: '2026-10-06T08:00:00Z' }],
      blocks: [
        // Their own block at the other clinic keeps them away here too.
        { clinicId: 'c2', practitionerId: 'p1', starts_at: '2026-10-06T08:00:00Z', ends_at: '2026-10-06T09:00:00Z' },
        // The other clinic's closure is its own.
        { clinicId: 'c2', practitionerId: null, starts_at: '2026-10-06T09:00:00Z', ends_at: '2026-10-06T10:00:00Z' },
      ],
    }
    // c2 has nobody working there, so only c1 is listed, unnamed.
    const result = receptionistSlotGroups(q)!
    expect(result.groups.map((g) => g.clinicName)).toEqual([null])
    expect(result.groups[0]!.days[1]).toEqual({ date: '2026-10-06', times: ['11:00'] })

    // A closure at this clinic closes it for everyone.
    const closed = { ...base, blocks: [{ clinicId: 'c1', practitionerId: null, starts_at: '2026-10-06T00:00:00Z', ends_at: '2026-10-07T00:00:00Z' }] }
    expect(days(closed)[0]!.map((d) => d.date)).toEqual(['2026-10-05'])
  })

  it('merges practitioners, honours their hours and overrides, and ignores other clinics', () => {
    const q: ReceptionistSlotQuery = {
      ...base,
      practitioners: [
        { id: 'p1', businessHours: null, clinicIds: ['c1'] },
        // Afternoons only, with a 30-minute override for this type.
        { id: 'p2', businessHours: { tue: [['15:00', '16:00']] }, clinicIds: ['c1'] },
        { id: 'p3', businessHours: { tue: [['18:00', '19:00']] }, clinicIds: ['elsewhere'] },
      ],
      types: [{ id: 't1', name: 'Primera visita', durationMinutes: 60, durationByPractitioner: { p2: 30 } }],
    }
    expect(days(q)[0]![1]).toEqual({ date: '2026-10-06', times: ['09:00', '10:00', '11:00', '15:00', '15:30'] })
  })

  it('lists types with the same times once, and others separately', () => {
    const q = {
      ...base,
      types: [
        { id: 't1', name: 'Primera visita', durationMinutes: 60 },
        { id: 't2', name: 'Revisión', durationMinutes: 60 },
        { id: 't3', name: 'Ajuste', durationMinutes: 30 },
      ],
    }
    const groups = receptionistSlotGroups(q)!.groups
    expect(groups.map((g) => g.types.map((t) => t.name))).toEqual([['Primera visita', 'Revisión'], ['Ajuste']])
  })

  it('names clinics only when there is more than one with times', () => {
    const q: ReceptionistSlotQuery = {
      ...base,
      clinics: [...base.clinics, { id: 'c2', name: 'Norte', timeZone: 'Europe/Madrid', businessHours: weekdays }],
      practitioners: [{ id: 'p1', businessHours: null, clinicIds: ['c1', 'c2'] }],
    }
    expect(receptionistSlotGroups(q)!.groups.map((g) => g.clinicName)).toEqual(['Centro', 'Norte'])
  })

  it('says "unknown" rather than "nothing free" when there is nothing to compute from', () => {
    expect(receptionistSlotGroups({ ...base, practitioners: [] })).toBeNull()
    expect(receptionistSlotGroups({ ...base, clinics: [] })).toBeNull()
    expect(receptionistSlotGroups({ ...base, types: [] })).toBeNull()
    // Nobody has hours: not set up, not booked solid.
    expect(receptionistSlotGroups({ ...base, clinics: [{ ...base.clinics[0]!, businessHours: null }] })).toBeNull()

    // Booked solid IS an answer: an empty list, not null.
    const solid = { ...base, appointments: [{ practitionerId: 'p1', starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-10T00:00:00Z' }] }
    expect(days(solid)).toEqual([[]])
  })

  it('drops whole days past the cap, and says where it stopped', () => {
    const allDay = { mon: [['00:00', '23:00']], tue: [['00:00', '23:00']], wed: [['00:00', '23:00']], thu: [['00:00', '23:00']], fri: [['00:00', '23:00']], sat: [['00:00', '23:00']], sun: [['00:00', '23:00']] } as Record<string, [string, string][]>
    const q = { ...base, clinics: [{ ...base.clinics[0]!, businessHours: allDay }], types: [{ id: 't1', name: 'Ajuste', durationMinutes: 10 }], bookingWindowDays: 30 }
    const group = receptionistSlotGroups(q)!.groups[0]!
    const count = group.days.reduce((n, d) => n + d.times.length, 0)
    expect(count).toBeLessThanOrEqual(MAX_TIMES_PER_LIST)
    expect(group.truncatedAfter).toBe(group.days[group.days.length - 1]!.date)
    // Every listed day is complete: the last one runs to its close.
    expect(group.days[group.days.length - 1]!.times.at(-1)).toBe('22:50')
  })
})

describe('Receptionist booking prompt', () => {
  const availability = {
    groups: [
      {
        clinicName: null,
        types: [{ name: 'Primera visita', durationMinutes: 60 }],
        days: [{ date: '2026-10-06', times: ['09:00', '10:00'] }],
        truncatedAfter: null,
      },
      { clinicName: null, types: [{ name: 'Ajuste', durationMinutes: 30 }], days: [], truncatedAfter: null },
    ],
  }

  it('lists the times and limits the model to them', () => {
    const text = receptionistBookingSection({ availability, slotsPerReply: 2, bookingWindowDays: 14 })
    expect(text).toContain('## Primera visita (60 min)\n- Tuesday 2026-10-06: 09:00, 10:00')
    expect(text).toContain('## Ajuste (30 min)\nNo free times in the next 14 days.')
    expect(text).toContain('Offer times ONLY from this list')
    expect(text).toContain('at most 2 times per reply')
    expect(text).not.toContain('which one if it is not clear')
    expect(receptionistBookingSection({ availability, slotsPerReply: 1, bookingWindowDays: 14 })).toContain('at most 1 time per reply')
  })

  it('says where a cut-short list stops, so a later day is not read as full', () => {
    const cut = { groups: [{ ...availability.groups[0]!, truncatedAfter: '2026-10-06' }] }
    const text = receptionistBookingSection({ availability: cut, slotsPerReply: 2, bookingWindowDays: 30 })
    expect(text).toContain('(This list stops at 2026-10-06. Later days may have free times; they are just not shown.)')
  })

  it('asks which clinic when times are per clinic', () => {
    const multi = { groups: availability.groups.map((g, i) => ({ ...g, clinicName: i ? 'Norte' : 'Centro' })) }
    const text = receptionistBookingSection({ availability: multi, slotsPerReply: 2, bookingWindowDays: 14 })
    expect(text).toContain('## Primera visita (60 min) at Centro')
    expect(text).toContain('ask which one if it is not clear')
  })

  it('falls back to asking when suits when there are no times to offer from', () => {
    const text = receptionistBookingSection({ availability: null, slotsPerReply: 2, bookingWindowDays: 14 })
    expect(text).toContain("You cannot see the clinic's calendar")
    expect(text).toContain('within the next 14 days')
    expect(text).not.toMatch(/\d{2}:\d{2}/)
  })

  it("states the date and time on the clinic's clock", () => {
    // 23:30Z on Sunday is already Monday in Madrid.
    expect(receptionistClockSection(new Date('2026-10-11T23:30:00Z'), 'Europe/Madrid')).toContain('It is Monday, 12 October 2026, 01:30 at the clinic (Europe/Madrid)')
    expect(receptionistClockSection(new Date('2026-10-11T23:30:00Z'), null)).toContain('(Europe/Madrid)')
  })
})

describe('find_free_times', () => {
  const weekdays = { mon: [['09:00', '12:00']], tue: [['09:00', '12:00']], wed: [['09:00', '12:00']], thu: [['09:00', '12:00']], fri: [['09:00', '12:00']], sat: [], sun: [] } as Record<string, [string, string][]>
  const base: ReceptionistSlotQuery = {
    // Monday 5 Oct 2026, 08:00 in Madrid.
    now: new Date('2026-10-05T06:00:00Z'),
    clinics: [{ id: 'c1', name: 'Centro', timeZone: 'Europe/Madrid', businessHours: weekdays }],
    practitioners: [{ id: 'p1', businessHours: null, clinicIds: ['c1'] }],
    types: [{ id: 't1', name: 'Primera visita', durationMinutes: 60 }],
    appointments: [],
    blocks: [],
    bookingWindowDays: 1,
    minimumNoticeMinutes: 120,
  }

  it('looks at a later window when given one, a whole day from its midnight', () => {
    // Monday 7 Dec 2026, midnight in Madrid (UTC+1 by then).
    const result = receptionistSlotGroups({ ...base, from: new Date('2026-12-06T23:00:00Z') })!
    expect(result.groups[0]!.days).toEqual([{ date: '2026-12-07', times: ['09:00', '10:00', '11:00'] }])
  })

  it('still keeps the minimum notice from now when the window starts today', () => {
    const result = receptionistSlotGroups({ ...base, from: new Date('2026-10-04T22:00:00Z') })!
    expect(result.groups[0]!.days[0]).toEqual({ date: '2026-10-05', times: ['11:00'] })
  })

  it('reads the dates the model asks for, and refuses what it cannot answer', () => {
    expect(parseFreeTimesInput({ from_date: '2026-12-01', to_date: '2026-12-10' }, '2026-10-11')).toEqual({ from: '2026-12-01', days: 10, typeName: null })
    expect(parseFreeTimesInput({ from_date: '2026-12-01' }, '2026-10-11')).toEqual({ from: '2026-12-01', days: 1, typeName: null })
    // A range starting in the past starts today.
    expect(parseFreeTimesInput({ from_date: '2026-10-01', to_date: '2026-10-12' }, '2026-10-11')).toEqual({ from: '2026-10-11', days: 2, typeName: null })
    // At most a month per call.
    expect(parseFreeTimesInput({ from_date: '2026-11-01', to_date: '2027-03-01' }, '2026-10-11')).toMatchObject({ from: '2026-11-01', days: FREE_TIMES_MAX_DAYS })
    expect(parseFreeTimesInput({ from_date: '2026-11-01', appointment_type: ' Ajuste ' }, '2026-10-11')).toMatchObject({ typeName: 'Ajuste' })

    expect(parseFreeTimesInput({ from_date: '1 December' }, '2026-10-11')).toHaveProperty('error')
    expect(parseFreeTimesInput({ from_date: '2026-02-31' }, '2026-10-11')).toHaveProperty('error')
    expect(parseFreeTimesInput({ from_date: '2026-12-10', to_date: '2026-12-01' }, '2026-10-11')).toHaveProperty('error')
    expect(parseFreeTimesInput({ from_date: '2026-09-01', to_date: '2026-09-10' }, '2026-10-11')).toHaveProperty('error')
    expect(parseFreeTimesInput({ from_date: '2028-01-01' }, '2026-10-11')).toHaveProperty('error')
  })

  it('tells the model it can look further when the tool is on', () => {
    const availability = receptionistSlotGroups(base)!
    expect(receptionistBookingSection({ availability, slotsPerReply: 2, bookingWindowDays: 1, searchTool: true })).toContain('call find_free_times')
    expect(receptionistBookingSection({ availability, slotsPerReply: 2, bookingWindowDays: 1 })).not.toContain('find_free_times')
  })
})
