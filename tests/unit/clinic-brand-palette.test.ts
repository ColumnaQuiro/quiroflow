import { describe, it, expect } from 'vitest'
import { brandContrast, clinicBrandCss, clinicBrandPalette, normalizeBrandColor, CLINIC_BRAND_PRESETS } from '../../utils/clinicBrandPalette'

// A clinic picks one colour for the patient app and every brand shade is
// derived from it. Whatever it picks, the app has to stay readable in both
// themes -- that is the whole reason it is one colour and not sixteen.

const LIGHT_SURFACE: [number, number, number] = [255, 255, 255]
const DARK_SURFACE: [number, number, number] = [24, 25, 31]

// The presets, plus the colours that break a naive derivation: white, black,
// a pale yellow, a neon green, a deep navy and a mid grey.
const COLOURS = [...CLINIC_BRAND_PRESETS, '#ffffff', '#000000', '#fde047', '#39ff14', '#0b1437', '#808080', '#f5f5f4']

describe('normalizeBrandColor', () => {
  it('accepts the forms people type and stores one', () => {
    expect(normalizeBrandColor('#0F766E')).toBe('#0f766e')
    expect(normalizeBrandColor('0f766e')).toBe('#0f766e')
    expect(normalizeBrandColor(' #abc ')).toBe('#aabbcc')
  })

  it('refuses what is not a colour', () => {
    for (const bad of ['', null, undefined, 'red', '#12345', '#gggggg', 'rgb(1,2,3)', '#0f766e; color: red']) expect(normalizeBrandColor(bad)).toBeNull()
  })
})

describe('clinicBrandPalette', () => {
  it('keeps the clinic colour as the light fill when it can be seen', () => {
    expect(clinicBrandPalette('#0f766e')!.light.brand).toEqual([15, 118, 110])
  })

  it.each(COLOURS)('%s stays readable in both themes', (colour) => {
    const { light, dark } = clinicBrandPalette(colour)!
    // Text on a filled button.
    expect(brandContrast(light.on, light.brand)).toBeGreaterThanOrEqual(4.5)
    expect(brandContrast(dark.on, dark.brand)).toBeGreaterThanOrEqual(4.5)
    // Brand-coloured text on the tints it sits on, and on the plain surface.
    expect(brandContrast(light.text, light.tint)).toBeGreaterThanOrEqual(4.5)
    expect(brandContrast(light.text2, LIGHT_SURFACE)).toBeGreaterThanOrEqual(4.5)
    expect(brandContrast(dark.text, dark.tintDeep)).toBeGreaterThanOrEqual(4.5)
    expect(brandContrast(dark.text2, dark.tintDeep)).toBeGreaterThanOrEqual(4.5)
    // A filled control has an edge against the page.
    expect(brandContrast(light.brand, LIGHT_SURFACE)).toBeGreaterThanOrEqual(1.6)
    expect(brandContrast(dark.brand, DARK_SURFACE)).toBeGreaterThanOrEqual(5.5)
  })

  it('puts dark text on a pale colour instead of darkening the colour', () => {
    const { light } = clinicBrandPalette('#f59e0b')!
    expect(light.brand).toEqual([245, 158, 11])
    expect(light.on).toEqual([15, 16, 20])
  })

  it('darkens only a colour too close to white to have an edge', () => {
    const { light } = clinicBrandPalette('#ffffff')!
    expect(brandContrast(light.brand, LIGHT_SURFACE)).toBeGreaterThanOrEqual(1.6)
    expect(brandContrast(light.brand, LIGHT_SURFACE)).toBeLessThan(2)
  })

  it('is null for something that is not a colour', () => {
    expect(clinicBrandPalette('teal')).toBeNull()
  })
})

describe('clinicBrandCss', () => {
  it('sets every brand variable for both themes, above theme.css', () => {
    const css = clinicBrandCss('#0f766e')
    expect(css).toContain(':root:root { --color-brand: 15 118 110;')
    expect(css).toContain(":root[data-theme='dark'] { --color-brand:")
    for (const name of ['brand', 'brand-hover', 'brand-text', 'brand-text2', 'brand-tint', 'brand-tintBorder', 'brand-tintDeep', 'brand-tintDeepBorder', 'brand-on']) {
      expect(css.match(new RegExp(`--color-${name}: \\d+ \\d+ \\d+;`, 'g'))).toHaveLength(2)
    }
  })

  it('is empty for a bad value, so nothing reaches a style tag', () => {
    expect(clinicBrandCss('#0f766e } body { display: none')).toBe('')
    expect(clinicBrandCss(null)).toBe('')
  })
})
