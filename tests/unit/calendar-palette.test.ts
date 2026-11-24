import { describe, it, expect } from 'vitest'
import { CALENDAR_PALETTE, CALENDAR_PALETTE_ROWS, calendarBlockColors, calendarColorWarnings, isPaletteColor, normalizeCalendarColor } from '../../utils/calendarPalette'

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

  it('lays every colour out exactly once, in rows of ten', () => {
    const shown = CALENDAR_PALETTE_ROWS.flat().map((c) => c.hex)
    expect(shown.slice().sort()).toEqual(CALENDAR_PALETTE.map((c) => c.hex).sort())
    for (const row of CALENDAR_PALETTE_ROWS) expect(row).toHaveLength(10)
  })
})

describe('calendarBlockColors', () => {
  // WCAG contrast of the text triplet on the fill.
  const lum = (r: number, g: number, b: number) =>
    [r, g, b].map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i]!, 0)
  const ratio = (hex: string, triplet: string) => {
    const a = lum(...([1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]))
    const b = lum(...(triplet.split(' ').map(Number) as [number, number, number]))
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }

  it('fills with the colour exactly as chosen', () => {
    expect(calendarBlockColors('#FF00FF')!.fill).toBe('#ff00ff')
    expect(calendarBlockColors('#1e40af')!.fill).toBe('#1e40af')
  })

  it('puts white text on deep colours and dark text on soft ones', () => {
    expect(calendarBlockColors('#1e40af')!.text).toBe('255 255 255')
    expect(calendarBlockColors('#fde68a')!.text).toBe('15 16 20')
  })

  it.each(CALENDAR_PALETTE.map((c) => [c.en, c.hex]))('%s (%s) keeps its text readable', (_name, hex) => {
    expect(ratio(hex, calendarBlockColors(hex)!.text)).toBeGreaterThanOrEqual(3)
  })

  it('is null for what is not a hex', () => {
    expect(calendarBlockColors(null)).toBeNull()
    expect(calendarBlockColors('rgb(var(--color-brand))')).toBeNull()
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
