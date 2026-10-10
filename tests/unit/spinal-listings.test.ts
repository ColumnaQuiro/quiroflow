import { describe, expect, it } from 'vitest'
import { hasSide, listingSummary, toggleListing } from '../../utils/spinalListings'

describe('spinal listings', () => {
  it('toggles a side on and off, and to both', () => {
    let l = toggleListing({}, 'C5', 'R')
    expect(l).toEqual({ C5: 'R' })
    l = toggleListing(l, 'C5', 'L')
    expect(l).toEqual({ C5: 'B' })
    expect(hasSide(l, 'C5', 'L') && hasSide(l, 'C5', 'R')).toBe(true)
    l = toggleListing(l, 'C5', 'R')
    expect(l).toEqual({ C5: 'L' })
    expect(toggleListing(l, 'C5', 'L')).toEqual({})
  })

  it('summarises head to foot, then the extremities', () => {
    expect(listingSummary({ L5: 'L', Knee: 'R', C5: 'R', T4: 'B' }, (x) => (x === 'Knee' ? 'Rodilla' : x))).toBe('C5 R · T4 L/R · L5 L · Rodilla R')
    expect(listingSummary(null)).toBe('')
  })
})
