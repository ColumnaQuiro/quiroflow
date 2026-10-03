import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { PDFDocument, PDFName } from 'pdf-lib'
import { captionRevealsPassword, defaultProtectedCaption, documentPassword, isSpanishId, protectedFileName } from '../../utils/protectedDocument'
import { buildProtectedPdf, ProtectedPdfError } from '../../server/utils/protectedPdf'

// A patient's file sent to their WhatsApp as a PDF only their DNI/NIE (or a
// password the clinic gives them) opens.
describe('The password a document is locked with', () => {
  it('knows a DNI or NIE by its check letter, not its shape', () => {
    expect(isSpanishId('12345678Z')).to.equal(true)
    expect(isSpanishId('X1234567L')).to.equal(true)
    // One letter off is a typo -- and a file the patient could never open.
    expect(isSpanishId('12345678A')).to.equal(false)
    expect(isSpanishId('X12345678L')).to.equal(false)
  })

  it('writes a DNI one way however it was typed, because the PDF password is exact', () => {
    expect(documentPassword(' 12.345.678-z ')).to.equal('12345678Z')
    expect(documentPassword('x1234567l')).to.equal('X1234567L')
  })

  it('keeps a chosen password exactly as typed', () => {
    // The clinic tells the patient this one, so it must not change under them.
    expect(documentPassword('  Columna-2026 ')).to.equal('Columna-2026')
  })
})

describe('The message beside the document', () => {
  it('says which password it is, never what it is', () => {
    const caption = defaultProtectedCaption({ fileName: 'Informe Emmanuel.pdf', passwordIsNationalId: true })
    expect(caption).to.contain('DNI/NIE')
    expect(caption).to.contain('mayúscula')
    expect(captionRevealsPassword(caption, '12345678Z')).to.equal(false)
  })

  it('catches the password in the text, however it is spaced', () => {
    expect(captionRevealsPassword('Tu contraseña es 12345678-z', '12345678Z')).to.equal(true)
    expect(captionRevealsPassword('La contraseña: Columna-2026', 'Columna-2026')).to.equal(true)
  })

  it('names the file it sends', () => {
    expect(protectedFileName('Informe Emmanuel.pdf')).to.equal('Informe Emmanuel (protegido).pdf')
    expect(protectedFileName('IMG_2041.jpeg')).to.equal('IMG_2041 (protegido).pdf')
  })
})

describe('Building the protected PDF', () => {
  async function report() {
    const doc = await PDFDocument.create()
    doc.addPage([595, 842]).drawText('Informe', { x: 50, y: 780 })
    // An uncompressed stream, so the plain file really does show it.
    doc.catalog.set(PDFName.of('Marker'), doc.context.register(doc.context.stream('MARCADOR-PACIENTE')))
    return Buffer.from(await doc.save())
  }

  it('encrypts with AES-256 and leaves nothing readable', async () => {
    const plain = await report()
    expect(plain.toString('latin1')).to.contain('MARCADOR-PACIENTE')

    const locked = await buildProtectedPdf(plain, 'application/pdf', '12345678Z')
    const text = locked.toString('latin1')
    expect(text).to.match(/\/V 5/)
    expect(text).to.match(/\/R 6/)
    expect(text).to.contain('/AESV3')
    expect(text).not.to.contain('MARCADOR-PACIENTE')
    // Nothing opens it without the password.
    await expect(PDFDocument.load(locked)).rejects.toThrow(/encrypted/i)
  })

  it('puts a photo into a PDF, which can carry a password and an image cannot', async () => {
    const photo = await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 120, g: 160, b: 140 } } }).png().toBuffer()
    const locked = await buildProtectedPdf(photo, 'image/png', '12345678Z')
    expect(locked.subarray(0, 5).toString()).to.equal('%PDF-')
    expect(locked.toString('latin1')).to.contain('/AESV3')
  })

  it('refuses a PDF that already has a password', async () => {
    const once = await buildProtectedPdf(await report(), 'application/pdf', '12345678Z')
    await expect(buildProtectedPdf(once, 'application/pdf', 'X1234567L')).rejects.toThrow(ProtectedPdfError)
  })

  it('refuses what a phone would not open as a document', async () => {
    await expect(buildProtectedPdf(Buffer.from('x'), 'application/zip', '12345678Z')).rejects.toThrow(ProtectedPdfError)
  })
})
