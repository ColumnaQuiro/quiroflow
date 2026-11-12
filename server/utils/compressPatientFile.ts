import type { PDFDocument } from 'pdf-lib'
import { flattenPdfAnnotations, type PdfLib } from './flattenPdfAnnotations'
import { PATIENT_IMAGE_MAX_EDGE, PATIENT_THUMB_MAX_EDGE, fitLongEdge } from '../../utils/patientFileStorage'

// Both libraries are loaded when a file is actually compressed, not when the
// server starts. sharp is ~800 ms and 19 MB of native code, and server/utils
// is bundled into the one Nitro chunk every request evaluates -- so a static
// import here made every cold start, login page included, pay for it.
const loadSharp = async () => (await import('sharp')).default
const loadPdfLib = (): Promise<PdfLib> => import('pdf-lib')

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

// The grid draws a thumbnail at ~200 px; 75 is plenty there and keeps one at
// 20-40 KB against the 1.3 MB photo the grid used to download per card.
const THUMB_QUALITY = 75

interface CompressResult {
  buffer: Buffer
  changed: boolean
}

export interface CompressOptions {
  /**
   * The backfill over files that were already compressed once: touch a photo
   * only when it is larger than PATIENT_IMAGE_MAX_EDGE, and nothing else. A
   * photo already at size is returned untouched, so running it twice (or
   * resuming a stopped run) never re-encodes the same pixels again.
   */
  resizeOnly?: boolean
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
//
// A photo (JPEG, WebP) larger than PATIENT_IMAGE_MAX_EDGE on its long edge is
// scaled down to it; never enlarged. A PNG is not: here it is a signature, a
// screenshot or a chart far more often than a photo, and scaling one blurs
// its text for little gain. resize() runs after the orientation is applied,
// and an 'inside' fit in a square box is the same whichever way up it is.
async function compressImageBuffer(buffer: Buffer, mimeType: string, options: CompressOptions): Promise<CompressResult> {
  const sharp = await loadSharp()
  if (mimeType === 'image/png') {
    if (options.resizeOnly) return { buffer, changed: false }
    // Lossless: the same pixels, alpha included, packed tighter.
    const out = await sharp(buffer).rotate().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    return out.length < buffer.length ? { buffer: out, changed: true } : { buffer, changed: false }
  }

  const meta = await sharp(buffer).metadata()
  const needsResize = fitLongEdge(meta.width ?? 0, meta.height ?? 0, PATIENT_IMAGE_MAX_EDGE).resized
  if (options.resizeOnly && !needsResize) return { buffer, changed: false }

  let image = sharp(buffer).rotate()
  if (needsResize) image = image.resize({ width: PATIENT_IMAGE_MAX_EDGE, height: PATIENT_IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
  const out =
    mimeType === 'image/jpeg'
      ? await image.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
      : await image.webp({ quality: JPEG_QUALITY, alphaQuality: 100 }).toBuffer()
  return out.length < buffer.length ? { buffer: out, changed: true } : { buffer, changed: false }
}

// What sharp is asked to make a thumbnail of. Not SVG (rendering an uploaded
// SVG on the server is a risk for no gain) and not PDF or video: those get
// the file tile in the grid, with no new dependency to draw a page.
const THUMBNAIL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])

export interface ThumbnailResult {
  /** The JPEG to store, or null when there is nothing worth storing. */
  thumb: Buffer | null
  /** False when sharp could not read the image at all (HEIC: the prebuilt
   *  libvips has no HEVC decoder), as opposed to "read it, no thumbnail needed". */
  decoded: boolean
}

/**
 * A small JPEG of an image for the Files grid. Null for anything that is not
 * an image sharp can read, and for an image so small that the thumbnail would
 * not be smaller than the file itself -- the grid then uses the file, as it
 * always did. Never throws.
 */
export async function makePatientFileThumbnail(buffer: Buffer, mimeType: string | null): Promise<ThumbnailResult> {
  if (!mimeType || !THUMBNAIL_TYPES.has(mimeType)) return { thumb: null, decoded: false }
  try {
    const sharp = await loadSharp()
    const out = await sharp(buffer)
      .rotate()
      .resize({ width: PATIENT_THUMB_MAX_EDGE, height: PATIENT_THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      // JPEG has no alpha; without this a transparent PNG's clear areas go black.
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toBuffer()
    return { thumb: out.length < buffer.length ? out : null, decoded: true }
  } catch {
    return { thumb: null, decoded: false }
  }
}

// How many colour components a PDF image's /ColorSpace declares, when it is
// one this can recompress faithfully: sharp decodes to RGB or grey, so a CMYK
// or indexed image re-encoded by it would no longer match what the PDF says
// it is, and would render wrongly. null means "leave this image alone".
function declaredComponents(lib: PdfLib, doc: PDFDocument, dict: any): 1 | 3 | null {
  let cs = dict.get(lib.PDFName.of('ColorSpace'))
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
      const n = Number(stream?.dict?.get(lib.PDFName.of('N'))?.toString())
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
  const [lib, sharp] = await Promise.all([loadPdfLib(), loadSharp()])
  let touchedAny = false

  for (const page of doc.getPages()) {
    const xobjects = page.node.Resources()?.lookup(lib.PDFName.of('XObject'))
    if (!xobjects || typeof (xobjects as any).entries !== 'function') continue

    for (const [, ref] of (xobjects as any).entries()) {
      const xobj = doc.context.lookup(ref) as any
      if (!xobj?.dict || xobj.dict.get(lib.PDFName.of('Subtype'))?.toString() !== '/Image') continue
      if (xobj.dict.get(lib.PDFName.of('Filter'))?.toString() !== '/DCTDecode') continue

      // A /Decode array remaps the samples; a re-encoded stream would be
      // remapped again.
      if (xobj.dict.get(lib.PDFName.of('Decode'))) continue
      const components = declaredComponents(lib, doc, xobj.dict)
      if (!components) continue

      const original = xobj.contents ?? xobj.getContents?.()
      if (!original || original.length < MIN_SIZE_BYTES) continue

      try {
        const image = sharp(Buffer.from(original))
        const recompressed = await (components === 1 ? image.toColourspace('b-w') : image.toColourspace('srgb')).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
        // The stream has to keep the component count the PDF declares for it.
        if ((await sharp(recompressed).metadata()).channels !== components) continue
        if (recompressed.length < original.length) {
          xobj.dict.set(lib.PDFName.of('Length'), doc.context.obj(recompressed.length))
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
  const lib = await loadPdfLib()
  const doc = await lib.PDFDocument.load(buffer, { updateMetadata: false })
  const flattened = flattenPdfAnnotations(lib, doc) > 0
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
export async function compressPatientFile(buffer: Buffer, mimeType: string | null, options: CompressOptions = {}): Promise<CompressResult> {
  try {
    if (mimeType === 'application/pdf') return options.resizeOnly ? { buffer, changed: false } : await processPdfBuffer(buffer)
    if (buffer.length < MIN_SIZE_BYTES) return { buffer, changed: false }
    if (mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') return await compressImageBuffer(buffer, mimeType, options)
  } catch {
    // Same reasoning as above: a file this couldn't process is left
    // exactly as it was, not treated as an error.
  }
  return { buffer, changed: false }
}
