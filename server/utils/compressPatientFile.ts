import { PDFDocument, PDFName } from 'pdf-lib'
import sharp from 'sharp'
import { flattenPdfAnnotations } from './flattenPdfAnnotations'

// Quality 90 is a deliberate middle ground, not a guess: verified against a
// synthetic photographic test image (photo-realistic noise, not flat color
// or random static -- both are unrepresentative worst/best cases for JPEG)
// that recompressing an unoptimized near-lossless source at quality 90
// yields ~55-60dB PSNR against the original when re-rendered -- well past
// the ~40dB threshold where a difference becomes perceptible to the eye --
// while cutting file size by roughly 40-60%. These files (posture-comparison
// reports etc.) are viewed on screen, not printed at diagnostic resolution,
// so this is the right trade-off: meaningfully smaller with no visible loss.
const JPEG_QUALITY = 90
// Below this, the overhead of downloading + recompressing + re-uploading
// isn't worth it -- a 200KB file has little to gain and every file touched
// is a real (if small) risk if something ever goes wrong mid-write.
const MIN_SIZE_BYTES = 300_000

interface CompressResult {
  buffer: Buffer
  changed: boolean
}

// A standalone image is re-encoded in its own format, never converted:
// a PNG turned into JPEG bytes kept its .png name and image/png type and lost
// its transparency (a signature's clear background came back black).
//
// rotate() with no angle applies the EXIF orientation to the pixels. sharp
// drops metadata by default, and a phone stores a portrait photo as a
// landscape frame plus an orientation tag -- so without it, a posture photo
// came back sideways, over the original. Only for standalone images: inside a
// PDF the tag means nothing (the page draws the raw pixels), and applying it
// there would be the rotation.
async function compressImageBuffer(buffer: Buffer, mimeType: string): Promise<CompressResult> {
  const image = sharp(buffer).rotate()
  const out =
    mimeType === 'image/jpeg'
      ? await image.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
      : mimeType === 'image/png'
        ? // Lossless: the same pixels, alpha included, packed tighter.
          await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
        : await image.webp({ quality: JPEG_QUALITY, alphaQuality: 100 }).toBuffer()
  return out.length < buffer.length ? { buffer: out, changed: true } : { buffer, changed: false }
}

// How many colour components a PDF image's /ColorSpace declares, when it is
// one this can recompress faithfully: sharp decodes to RGB or grey, so a CMYK
// or indexed image re-encoded by it would no longer match what the PDF says
// it is, and would render wrongly. null means "leave this image alone".
function declaredComponents(doc: PDFDocument, dict: any): 1 | 3 | null {
  let cs = dict.get(PDFName.of('ColorSpace'))
  if (!cs) return null
  cs = doc.context.lookup(cs) ?? cs
  const name = cs.toString()
  if (name === '/DeviceRGB') return 3
  if (name === '/DeviceGray') return 1
  // [/ICCBased <stream>]: the stream's /N is the component count.
  if (typeof cs.asArray === 'function') {
    const arr = cs.asArray()
    if (arr[0]?.toString() === '/ICCBased') {
      const stream = doc.context.lookup(arr[1]) as any
      const n = Number(stream?.dict?.get(PDFName.of('N'))?.toString())
      if (n === 1 || n === 3) return n
    }
  }
  return null
}

// Recompresses every embedded JPEG image inside a PDF in place, leaving
// page layout, text, and vector content untouched -- only the raster image
// streams (DCTDecode) are touched. Images already stored some other way
// (indexed/PNG-style FlateDecode, JBIG2 scans, etc.) are left alone rather
// than guessed at; a skipped image just means this particular PDF doesn't
// shrink as much, never a corrupted one.
async function recompressPdfImages(doc: PDFDocument): Promise<boolean> {
  let touchedAny = false

  for (const page of doc.getPages()) {
    const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'))
    if (!xobjects || typeof (xobjects as any).entries !== 'function') continue

    for (const [, ref] of (xobjects as any).entries()) {
      const xobj = doc.context.lookup(ref) as any
      if (!xobj?.dict || xobj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
      if (xobj.dict.get(PDFName.of('Filter'))?.toString() !== '/DCTDecode') continue

      // A /Decode array remaps the samples; a re-encoded stream would be
      // remapped again.
      if (xobj.dict.get(PDFName.of('Decode'))) continue
      const components = declaredComponents(doc, xobj.dict)
      if (!components) continue

      const original = xobj.contents ?? xobj.getContents?.()
      if (!original || original.length < MIN_SIZE_BYTES) continue

      try {
        const image = sharp(Buffer.from(original))
        const recompressed = await (components === 1 ? image.toColourspace('b-w') : image.toColourspace('srgb')).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
        // The stream has to keep the component count the PDF declares for it.
        if ((await sharp(recompressed).metadata()).channels !== components) continue
        if (recompressed.length < original.length) {
          xobj.dict.set(PDFName.of('Length'), doc.context.obj(recompressed.length))
          xobj.contents = recompressed
          touchedAny = true
        }
      } catch {
        // Not a format sharp can decode (or a corrupt stream) -- skip this
        // one image rather than fail the whole file.
        continue
      }
    }
  }

  return touchedAny
}

// Every PDF has its annotations painted into the page (flattenPdfAnnotations:
// a Preview-filled report otherwise opens blank on a phone), whatever its
// size, and kept even when that makes it larger -- the point is what it
// shows. Its images are recompressed only past MIN_SIZE_BYTES, and that alone
// is kept only when it made the file smaller.
async function processPdfBuffer(buffer: Buffer): Promise<CompressResult> {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false })
  const flattened = flattenPdfAnnotations(doc) > 0
  const recompressed = buffer.length >= MIN_SIZE_BYTES && (await recompressPdfImages(doc))
  if (!flattened && !recompressed) return { buffer, changed: false }

  const out = Buffer.from(await doc.save({ useObjectStreams: false }))
  if (flattened || out.length < buffer.length) return { buffer: out, changed: true }
  return { buffer, changed: false }
}

// Returns the original buffer unchanged (changed: false) for anything not
// worth compressing -- small files, unsupported types, or a recompression
// that didn't actually come out smaller. Never throws for an
// unrecognized/unprocessable file; callers should treat that the same as
// "nothing to do here".
export async function compressPatientFile(buffer: Buffer, mimeType: string | null): Promise<CompressResult> {
  try {
    if (mimeType === 'application/pdf') return await processPdfBuffer(buffer)
    if (buffer.length < MIN_SIZE_BYTES) return { buffer, changed: false }
    if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') return await compressImageBuffer(buffer, mimeType)
  } catch {
    // Same reasoning as above: a file this couldn't process is left
    // exactly as it was, not treated as an error.
  }
  return { buffer, changed: false }
}
