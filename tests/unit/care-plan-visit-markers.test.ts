import { describe, expect, it } from 'vitest'
import { cleanVisitMarkers, markerForVisit, markerVisitNumbers, visitMarkerLabel } from '../../utils/carePlanVisitMarkers'

const es = (_en: string, es: string) => es

describe('care plan visit markers', () => {
  it('marks a visit once, or every Nth visit from where it starts', () => {
    const once = [{ at: 3 }]
    expect(markerForVisit(once, 3)).toEqual({ at: 3 })
    expect(markerForVisit(once, 6)).toBeNull()
    const every = [{ at: 12, every: 12 }]
    expect([11, 12, 13, 24, 36, 37].map((n) => !!markerForVisit(every, n))).toEqual([false, true, false, true, true, false])
  })

  it('takes the first marker that matches, so scans on 11 and review on 12 stay apart', () => {
    const markers = [
      { at: 11, every: 12, label: 'Scans' },
      { at: 12, every: 12, label: 'Review' },
    ]
    expect(markerForVisit(markers, 11)?.label).toBe('Scans')
    expect(markerForVisit(markers, 12)?.label).toBe('Review')
    expect(markerForVisit(markers, 23)?.label).toBe('Scans')
    expect(markerForVisit(markers, 24)?.label).toBe('Review')
    expect(markerForVisit(markers, 10)).toBeNull()
  })

  it('previews the visits a marker falls on', () => {
    expect(markerVisitNumbers({ at: 12, every: 12 })).toEqual([12, 24, 36])
    expect(markerVisitNumbers({ at: 3 })).toEqual([3])
  })

  it('names a marked visit by its label, else its type, else Revisión', () => {
    expect(visitMarkerLabel({ label: 'Rx' }, es)).toBe('Rx')
    expect(visitMarkerLabel({ label: ' ', expected_type_name: 'Reevaluación' }, es)).toBe('Reevaluación')
    expect(visitMarkerLabel(null, es)).toBe('Revisión')
  })

  it('keeps only what the database accepts', () => {
    expect(cleanVisitMarkers([{ at: 0 }, { at: 12.4, every: 12, label: '  ', appointment_type_id: '' }])).toEqual([{ at: 12, every: 12, appointment_type_id: null, label: null }])
  })
})
