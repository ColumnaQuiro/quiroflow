import { describe, it, expect } from 'vitest'
import { planeContrast, planeCss, planePalette } from '../../mobile/utils/planePalette'
import { CLINIC_BRAND_PRESETS } from '../../utils/clinicBrandPalette'

// The app's back plane in a clinic's own colour. It carries white text --
// titles, the next visit, the day's figures -- so whatever colour a clinic
// picks, white has to stay comfortably readable on it, in both themes.

const WHITE: [number, number, number] = [255, 255, 255]
// The presets, plus the colours that break a naive darkening: white, black, a
// pale yellow, a neon green, a deep navy and a mid grey.
const COLOURS = [...CLINIC_BRAND_PRESETS, '#ffffff', '#000000', '#fde047', '#39ff14', '#0b1437', '#808080', '#f5f5f4']

describe('planePalette', () => {
  it('is null for anything that is not a colour', () => {
    expect(planePalette(null)).toBeNull()
    expect(planePalette('')).toBeNull()
    expect(planePalette('teal')).toBeNull()
    expect(planeCss('#12')).toBe('')
  })

  it.each(COLOURS)('keeps white text at 7:1 or more on the %s plane, in both themes', (colour) => {
    const p = planePalette(colour)!
    expect(planeContrast(p.light.plane, WHITE)).toBeGreaterThanOrEqual(7)
    expect(planeContrast(p.dark.plane, WHITE)).toBeGreaterThanOrEqual(7)
  })

  it.each(COLOURS)('keeps the muted text readable on the %s plane and on its raised steps', (colour) => {
    const p = planePalette(colour)!
    for (const shades of [p.light, p.dark]) {
      expect(planeContrast(shades.plane, shades.muted)).toBeGreaterThanOrEqual(4.5)
      expect(planeContrast(shades.raised, WHITE)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps some of the clinic\'s hue rather than going to grey', () => {
    const { light } = planePalette('#15803d')!
    const [r, g, b] = light.plane
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
  })

  it('writes both themes, outranking the app stylesheet', () => {
    const css = planeCss('#0f766e')
    expect(css).toContain(':root:root {')
    expect(css).toContain(":root[data-theme='dark'] {")
    expect(css).toMatch(/--plane: \d+ \d+ \d+;/)
    expect(css).toMatch(/--plane-raised: \d+ \d+ \d+;/)
  })
})
