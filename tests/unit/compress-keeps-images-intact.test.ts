import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { PDFDocument, PDFName } from 'pdf-lib'
import { compressPatientFile } from '../../server/utils/compressPatientFile'

// Compression overwrites the original in storage, so anything it gets wrong
// is permanent. On 30 Sep 2026 it would have turned every portrait phone
// photo sideways, every PNG into a JPEG still called .png (transparency
// gone), and every CMYK image inside a PDF into RGB bytes the PDF still
// called CMYK. None had reached a production image yet: the 76 files it had
// compressed were PDFs.

// Photographic-ish noise: compresses like a photo, not like flat colour.
function noise(width: number, height: number, channels: number) {
  const buf = Buffer.alloc(width * height * channels)
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 7919 + (i >> 5)) % 256
  return buf
}

describe('compressing a patient file', () => {
  it('keeps a portrait phone photo upright', async () => {
    // Stored the way a phone stores it: a landscape frame plus "rotate 90°".
    const photo = await sharp(noise(1200, 800, 3), { raw: { width: 1200, height: 800, channels: 3 } })
      .jpeg({ quality: 100 })
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const { buffer, changed } = await compressPatientFile(photo, 'image/jpeg')
    const meta = await sharp(buffer).metadata()

    expect(changed).toBe(true)
    // Either the pixels are turned upright, or the tag that turns them is kept.
    const displaysPortrait = meta.orientation && meta.orientation >= 5 ? meta.width! > meta.height! : meta.height! > meta.width!
    expect(displaysPortrait).toBe(true)
  })

  it('keeps a PNG a PNG, transparency included', async () => {
    const rgba = noise(900, 900, 4)
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = (i >> 2) % 900 < 450 ? 0 : 255
    const png = await sharp(rgba, { raw: { width: 900, height: 900, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer()

    const { buffer } = await compressPatientFile(png, 'image/png')
    const meta = await sharp(buffer).metadata()

    expect(meta.format).toBe('png')
    expect(meta.hasAlpha).toBe(true)
  })

  it('leaves a CMYK image inside a PDF alone rather than re-encoding it as RGB', async () => {
    const cmykJpeg = await sharp(noise(700, 700, 3), { raw: { width: 700, height: 700, channels: 3 } })
      .toColourspace('cmyk')
      .jpeg({ quality: 100 })
      .toBuffer()
    const doc = await PDFDocument.create()
    const page = doc.addPage([700, 700])
    // pdf-lib's embedJpg reads the component count from the JPEG itself.
    const image = await doc.embedJpg(cmykJpeg)
    page.drawImage(image, { x: 0, y: 0, width: 700, height: 700 })
    const pdf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const { buffer } = await compressPatientFile(pdf, 'application/pdf')
    const out = await PDFDocument.load(buffer)
    const xobjects = out.getPages()[0]!.node.Resources()!.lookup(PDFName.of('XObject')) as any
    const [, ref] = [...xobjects.entries()][0]
    const stream = out.context.lookup(ref) as any
    const declared = stream.dict.get(PDFName.of('ColorSpace')).toString()
    const channels = (await sharp(Buffer.from(stream.contents)).metadata()).channels

    expect(declared).toBe('/DeviceCMYK')
    expect(channels).toBe(4)
  })

  it('still shrinks an ordinary RGB photo inside a PDF', async () => {
    const rgbJpeg = await sharp(noise(1400, 1000, 3), { raw: { width: 1400, height: 1000, channels: 3 } }).jpeg({ quality: 100 }).toBuffer()
    const doc = await PDFDocument.create()
    const page = doc.addPage([700, 500])
    page.drawImage(await doc.embedJpg(rgbJpeg), { x: 0, y: 0, width: 700, height: 500 })
    const pdf = Buffer.from(await doc.save({ useObjectStreams: false }))

    const { buffer, changed } = await compressPatientFile(pdf, 'application/pdf')

    expect(changed).toBe(true)
    expect(buffer.length).toBeLessThan(pdf.length)
    const out = await PDFDocument.load(buffer)
    expect(out.getPageCount()).toBe(1)
  })
})
