import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { compressPatientFile, makePatientFileThumbnail } from '../../server/utils/compressPatientFile'

// Photos are scaled to a 2000 px long edge on the way in, and get a small
// thumbnail for the Files grid. Both overwrite or sit beside a clinical file,
// so what must NOT happen matters as much as what must.

// mozjpeg over 8 megapixels of noise takes seconds, more on a busy machine.
vi.setConfig({ testTimeout: 30_000 })

// Photographic-ish noise: compresses like a photo, not like flat colour.
function noise(width: number, height: number, channels: number) {
  const buf = Buffer.alloc(width * height * channels)
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 7919 + (i >> 5)) % 256
  return buf
}
const photo = (width: number, height: number, quality = 95) => sharp(noise(width, height, 3), { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer()

// These encode and decode real megapixel images with sharp and pdf-lib: a
// second or two each on an idle machine, well past vitest's 5 s default on a
// busy one, where they failed three pushes in a row with nothing wrong.
vi.setConfig({ testTimeout: 30_000 })

describe('resizing a patient photo', () => {
  it('scales a large photo to 2000 px on its long edge and keeps it a JPEG', async () => {
    const big = await photo(3200, 2400)
    const { buffer, changed } = await compressPatientFile(big, 'image/jpeg')
    const meta = await sharp(buffer).metadata()
    expect(changed).toBe(true)
    expect(meta.format).toBe('jpeg')
    expect([meta.width, meta.height]).toEqual([2000, 1500])
    expect(buffer.length).toBeLessThan(big.length)
  })

  it('measures the long edge after the EXIF turn, so a portrait stays a portrait', async () => {
    // A landscape frame tagged "rotate 90°": shown 2400 wide by 3200 tall.
    const portrait = await sharp(noise(3200, 2400, 3), { raw: { width: 3200, height: 2400, channels: 3 } })
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const { buffer } = await compressPatientFile(portrait, 'image/jpeg')
    const meta = await sharp(buffer).metadata()
    expect([meta.width, meta.height]).toEqual([1500, 2000])
    // The pixels were turned, so no tag is left to turn them again.
    expect(meta.orientation ?? 1).toBe(1)
  })

  it('never enlarges a photo that is already small', async () => {
    const small = await photo(1200, 900, 100)
    const { buffer } = await compressPatientFile(small, 'image/jpeg')
    const meta = await sharp(buffer).metadata()
    expect([meta.width, meta.height]).toEqual([1200, 900])
  })

  it('keeps the original when the result would not be smaller', async () => {
    // Already at size and already squeezed hard: quality 90 can only add.
    const tight = await photo(1600, 1200, 30)
    expect(tight.length).toBeGreaterThan(300_000)
    const { buffer, changed } = await compressPatientFile(tight, 'image/jpeg')
    expect(changed).toBe(false)
    expect(buffer).toBe(tight)
  })

  it('leaves a PNG at its own size: it is a screenshot or a signature, not a photo', async () => {
    const png = await sharp(noise(2600, 900, 3), { raw: { width: 2600, height: 900, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
    const { buffer } = await compressPatientFile(png, 'image/png')
    const meta = await sharp(buffer).metadata()
    expect(meta.format).toBe('png')
    expect([meta.width, meta.height]).toEqual([2600, 900])
  })
})

describe('the backfill pass (resizeOnly)', () => {
  it('resizes a photo that is over the cap', async () => {
    const { buffer, changed } = await compressPatientFile(await photo(3200, 2400), 'image/jpeg', { resizeOnly: true })
    expect(changed).toBe(true)
    expect((await sharp(buffer).metadata()).width).toBe(2000)
  })

  it('does not re-encode a photo already at size, so a second pass loses nothing', async () => {
    const first = await compressPatientFile(await photo(3200, 2400), 'image/jpeg', { resizeOnly: true })
    const second = await compressPatientFile(first.buffer, 'image/jpeg', { resizeOnly: true })
    expect(second.changed).toBe(false)
    expect(second.buffer).toBe(first.buffer)

    // Nor one that was never large, however much smaller it could be made.
    const fat = await photo(1800, 1200, 100)
    expect((await compressPatientFile(fat, 'image/jpeg', { resizeOnly: true })).changed).toBe(false)
  })

  it('never touches a PDF, a PNG or a video', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const jpg = await doc.embedJpg(await photo(3200, 2400))
    page.drawImage(jpg, { x: 0, y: 0, width: 600, height: 450 })
    const pdf = Buffer.from(await doc.save())
    const png = await sharp(noise(2600, 900, 3), { raw: { width: 2600, height: 900, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
    const video = Buffer.alloc(400_000, 7)

    for (const [buffer, type] of [[pdf, 'application/pdf'], [png, 'image/png'], [video, 'video/mp4']] as const) {
      const out = await compressPatientFile(buffer, type, { resizeOnly: true })
      expect(out.changed, type).toBe(false)
      expect(out.buffer, type).toBe(buffer)
    }
  })
})

describe('the grid thumbnail', () => {
  it('is a JPEG of at most 480 px, upright, far smaller than the photo', async () => {
    const portrait = await sharp(noise(3200, 2400, 3), { raw: { width: 3200, height: 2400, channels: 3 } })
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const { thumb, decoded } = await makePatientFileThumbnail(portrait, 'image/jpeg')
    expect(decoded).toBe(true)
    const meta = await sharp(thumb!).metadata()
    expect(meta.format).toBe('jpeg')
    expect([meta.width, meta.height]).toEqual([360, 480])
    expect(thumb!.length).toBeLessThan(portrait.length / 10)
  })

  it('gives a transparent PNG a white ground, not a black one', async () => {
    const clear = await sharp({ create: { width: 1200, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png({ compressionLevel: 0 }).toBuffer()
    const { thumb } = await makePatientFileThumbnail(clear, 'image/png')
    const { data } = await sharp(thumb!).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(250)
  })

  it('is not made when it would not be smaller than the image itself', async () => {
    const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#808080' } }).jpeg({ quality: 20 }).toBuffer()
    expect(await makePatientFileThumbnail(tiny, 'image/jpeg')).toEqual({ thumb: null, decoded: true })
  })

  it('is never made for a PDF, a video or an SVG', async () => {
    for (const type of ['application/pdf', 'video/mp4', 'image/svg+xml', null]) {
      expect(await makePatientFileThumbnail(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), type)).toEqual({ thumb: null, decoded: false })
    }
  })

  it('reports an image it cannot read instead of throwing', async () => {
    // What a HEIC is to this build of sharp: bytes with no decoder behind them.
    expect(await makePatientFileThumbnail(Buffer.alloc(50_000, 3), 'image/heic')).toEqual({ thumb: null, decoded: false })
  })
})
