import { randomBytes } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { encryptPDF } from '@pdfsmaller/pdf-encrypt'
import sharp from 'sharp'
import { flattenPdfAnnotations } from './flattenPdfAnnotations'

// A patient's file as a PDF only their password opens (utils/protectedDocument.ts
// says why). AES-256, the PDF 2.0 handler (V5/R6), which every current viewer
// opens -- iOS, Android, Acrobat, browsers -- and which, unlike RC4, is not
// broken.
//
// A PDF has its annotations drawn into the page first: a document filled in
// with macOS Preview otherwise opens on the patient's phone as the blank
// template (flattenPdfAnnotations). A photo is placed on an A4 page of its own
// orientation, because an image cannot carry a password and a PDF can.

export class ProtectedPdfError extends Error {}

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 24

async function imageAsPdf(buffer: Buffer, mimeType: string): Promise<Uint8Array> {
  // EXIF orientation applied to the pixels: a phone stores a portrait photo
  // as a landscape frame plus a tag, and a PDF page draws the raw frame.
  const upright = sharp(buffer).rotate()
  const png = mimeType === 'image/png'
  const bytes = png ? await upright.png().toBuffer() : await upright.jpeg({ quality: 92 }).toBuffer()

  const doc = await PDFDocument.create()
  const image = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  const landscape = image.width > image.height
  const [w, h] = landscape ? [A4[1], A4[0]] : A4
  const scale = Math.min((w - 2 * MARGIN) / image.width, (h - 2 * MARGIN) / image.height, 1)
  const page = doc.addPage([w, h])
  page.drawImage(image, {
    x: (w - image.width * scale) / 2,
    y: (h - image.height * scale) / 2,
    width: image.width * scale,
    height: image.height * scale,
  })
  return doc.save()
}

async function pdfForSharing(buffer: Buffer): Promise<Uint8Array> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(buffer, { updateMetadata: false })
  } catch (err) {
    if (err instanceof Error && /encrypt/i.test(err.message)) {
      throw new ProtectedPdfError('This PDF already has a password of its own, so it cannot be protected again here.')
    }
    throw new ProtectedPdfError('This PDF could not be read.')
  }
  flattenPdfAnnotations(doc)
  return doc.save({ useObjectStreams: false })
}

export function canProtect(mimeType: string | null): boolean {
  return mimeType === 'application/pdf' || mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp'
}

export async function buildProtectedPdf(buffer: Buffer, mimeType: string | null, password: string): Promise<Buffer> {
  if (!canProtect(mimeType)) throw new ProtectedPdfError('Only PDFs and photos (JPEG, PNG, WebP) can be sent protected.')
  const plain = mimeType === 'application/pdf' ? await pdfForSharing(buffer) : await imageAsPdf(buffer, mimeType!)

  // The owner password unlocks editing; nobody needs it, so nobody is given
  // it. The patient's password opens, reads and prints.
  const encrypted = await encryptPDF(plain, password, {
    algorithm: 'AES-256',
    ownerPassword: randomBytes(24).toString('hex'),
    allowPrinting: true,
    allowHighQualityPrint: true,
    allowCopying: true,
    allowExtraction: true,
    allowModifying: false,
    allowAnnotating: false,
    allowFillingForms: false,
    allowAssembly: false,
  })
  return Buffer.from(encrypted)
}
