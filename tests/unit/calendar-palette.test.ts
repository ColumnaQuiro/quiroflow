import { describe, it, expect } from 'vitest'
import { CALENDAR_PALETTE, calendarColorWarnings, isPaletteColor, normalizeCalendarColor } from '../../utils/calendarPalette'

// The calendar offers presets plus a free colour. The presets must all be
// safe; the free colour warns when it reads as red (money owed) or vanishes
// into one theme's surface.

describe('CALENDAR_PALETTE', () => {
  it('keeps the original ten first, in order', () => {
    expect(CALENDAR_PALETTE.slice(0, 10).map((c) => c.hex)).toEqual([
      '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6', '#22c55e', '#84cc16', '#f59e0b', '#f97316', '#d946ef', '#8b5cf6',
    ])
  })

  it('has no duplicates and only lower-case #rrggbb', () => {
    const hexes = CALENDAR_PALETTE.map((c) => c.hex)
    expect(new Set(hexes).size).toBe(hexes.length)
    for (const h of hexes) expect(h).toMatch(/^#[0-9a-f]{6}$/)
  })

  it.each(CALENDAR_PALETTE.map((c) => [c.en, c.hex]))('%s (%s) raises no warning', (_name, hex) => {
    expect(calendarColorWarnings(hex)).toEqual([])
  })
})

describe('calendarColorWarnings', () => {
  it('flags reds, not pinks or oranges', () => {
    expect(calendarColorWarnings('#ef4444')).toContain('red')
    expect(calendarColorWarnings('#ff0000')).toContain('red')
    expect(calendarColorWarnings('#b91c1c')).toContain('red')
    expect(calendarColorWarnings('#ec4899')).not.toContain('red')
    expect(calendarColorWarnings('#f97316')).not.toContain('red')
  })

  it('flags colours that vanish into a surface', () => {
    expect(calendarColorWarnings('#ffffff')).toContain('faint-light')
    expect(calendarColorWarnings('#fef9c3')).toContain('faint-light')
    expect(calendarColorWarnings('#000000')).toContain('faint-dark')
    expect(calendarColorWarnings('#111827')).toContain('faint-dark')
  })

  it('passes loud colours that read fine', () => {
    expect(calendarColorWarnings('#ff00ff')).toEqual([])
    expect(calendarColorWarnings('#00e5ff')).toEqual([])
  })

  it('ignores what is not a colour', () => {
    expect(calendarColorWarnings(null)).toEqual([])
    expect(calendarColorWarnings('rgb(0,0,0)')).toEqual([])
  })
})

describe('normalizeCalendarColor / isPaletteColor', () => {
  it('normalises short and upper-case hex', () => {
    expect(normalizeCalendarColor('#ABC')).toBe('#aabbcc')
    expect(normalizeCalendarColor('6366F1')).toBe('#6366f1')
    expect(normalizeCalendarColor('nope')).toBeNull()
  })

  it('matches palette colours case-insensitively', () => {
    expect(isPaletteColor('#6366F1')).toBe(true)
    expect(isPaletteColor('#123456')).toBe(false)
  })
})
