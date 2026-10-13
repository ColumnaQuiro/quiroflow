import { describe, expect, it } from 'vitest'
import { hasSide, listingActionLine, listingSummary, sideLettersFor, syncListingLine, toggleListing } from '../../utils/spinalListings'

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

describe('the listing in the note', () => {
  const es = (_en: string, es: string) => es
  const en = (en: string) => en
  it('says the sides in the reader’s language', () => {
    expect(listingSummary({ C5: 'R', L5: 'B', T6: 'L' }, (l) => l, sideLettersFor(es))).toBe('C5 D · T6 I · L5 I/D')
    expect(listingSummary({ C5: 'R', L5: 'B', T6: 'L' }, (l) => l, sideLettersFor(en))).toBe('C5 R · T6 L · L5 L/R')
  })
  it('writes the listing as the first line of Action and keeps it in step', () => {
    const line = listingActionLine('C5 D', es)
    expect(line).toBe('Ajustado: C5 D')
    // Added on top of what was already written.
    expect(syncListingLine('Movilización de cadera.', line)).toBe('Ajustado: C5 D\nMovilización de cadera.')
    // Replaced, never doubled.
    expect(syncListingLine('Ajustado: C5 D\nMovilización de cadera.', 'Ajustado: C5 D · L5 I')).toBe('Ajustado: C5 D · L5 I\nMovilización de cadera.')
    // An English line is recognised too.
    expect(syncListingLine('Adjusted: C5 R', 'Ajustado: C5 D')).toBe('Ajustado: C5 D')
    // Removed when nothing is listed any more; the rest is kept.
    expect(syncListingLine('Ajustado: C5 D\nMovilización de cadera.', '')).toBe('Movilización de cadera.')
    expect(syncListingLine('', '')).toBe('')
    expect(syncListingLine('', line)).toBe('Ajustado: C5 D')
  })
})
