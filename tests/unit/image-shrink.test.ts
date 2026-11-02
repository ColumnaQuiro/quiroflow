import { describe, expect, it } from 'vitest'
import { planImageShrink, renameForImageType } from '../../utils/imageShrink'

describe('image shrink plan', () => {
  it('caps a logo at 600 px on its long side, keeping the aspect ratio', () => {
    expect(planImageShrink('logo', 2400, 800, 'image/jpeg', false)).toEqual({ width: 600, height: 200, type: 'image/jpeg' })
    expect(planImageShrink('logo', 1000, 3000, 'image/jpeg', false)).toEqual({ width: 200, height: 600, type: 'image/jpeg' })
  })

  it('caps a photo at 256 px on its short side, the square its circle shows', () => {
    expect(planImageShrink('photo', 3024, 4032, 'image/jpeg', false)).toEqual({ width: 256, height: 341, type: 'image/jpeg' })
  })

  it('never upscales', () => {
    expect(planImageShrink('logo', 300, 100, 'image/png', false)).toMatchObject({ width: 300, height: 100 })
    expect(planImageShrink('photo', 120, 120, 'image/jpeg', false)).toMatchObject({ width: 120, height: 120 })
  })

  it('draws an SVG at the cap, since a vector has no resolution to lose', () => {
    expect(planImageShrink('logo', 120, 40, 'image/svg+xml', true)).toEqual({ width: 600, height: 200, type: 'image/png' })
  })

  it('keeps a PNG or transparent logo as PNG, so pdfkit and Apple Wallet still read it', () => {
    expect(planImageShrink('logo', 1200, 400, 'image/png', false).type).toBe('image/png')
    expect(planImageShrink('logo', 1200, 400, 'image/webp', true).type).toBe('image/png')
    expect(planImageShrink('logo', 1200, 400, 'image/webp', false).type).toBe('image/jpeg')
  })

  it('makes every photo a JPEG', () => {
    expect(planImageShrink('photo', 1200, 1200, 'image/png', true).type).toBe('image/jpeg')
  })

  it('names the stored file after what is in it', () => {
    expect(renameForImageType('Logo clinica.HEIC', 'image/jpeg')).toBe('Logo clinica.jpg')
    expect(renameForImageType('logo.webp', 'image/png')).toBe('logo.png')
    expect(renameForImageType('logo', 'image/png')).toBe('logo.png')
  })
})
