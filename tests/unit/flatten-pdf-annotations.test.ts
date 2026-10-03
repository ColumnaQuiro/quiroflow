import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { flattenPdfAnnotations } from '../../server/utils/flattenPdfAnnotations'
import { compressPatientFile } from '../../server/utils/compressPatientFile'

// Emmanuel Botella's informe, 30 Sep 2026: filled in with macOS Preview, so
// every personal detail was an annotation over a blank template, and it
// opened as the template on his Android phone. Flattening paints each
// annotation's own appearance into the page.

/** An annotation with an appearance stream, the shape Preview writes. */
function annotation(doc: PDFDocument, subtype: string, rect: number[], extra: Record<string, unknown> = {}, appearance: { bbox: number[]; matrix?: number[] } | null = { bbox: [0, 0, 100, 20] }) {
  const entries: Record<string, unknown> = { Type: 'Annot', Subtype: subtype, Rect: rect, F: 4, ...extra }
  if (appearance) {
    const formDict: Record<string, unknown> = { Type: 'XObject', Subtype: 'Form', BBox: appearance.bbox }
    if (appearance.matrix) formDict.Matrix = appearance.matrix
    const stream = doc.context.stream('BT /F1 12 Tf 2 4 Td (Emmanuel) Tj ET', formDict as never)
    entries.AP = { N: doc.context.register(stream) }
  }
  return doc.context.register(doc.context.obj(entries as never))
}

async function informe() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  page.drawText('INFORME QUIROPRACTICO', { x: 50, y: 780 })
  return { doc, page }
}

function annotSubtypes(doc: PDFDocument, pageIndex = 0) {
  const annots = doc.getPages()[pageIndex]!.node.Annots()
  if (!annots) return []
  return annots.asArray().map((ref) => (doc.context.lookup(ref) as PDFDict).get(PDFName.of('Subtype'))!.toString())
}

function lastContentStream(doc: PDFDocument): string {
  const contents = doc.getPages()[0]!.node.Contents()
  const last = contents instanceof PDFArray ? doc.context.lookup(contents.get(contents.size() - 1)) : contents
  const stream = last as PDFRawStream & { getContentsString?: () => string; computeContents?: () => Uint8Array }
  return stream.getContentsString ? stream.getContentsString() : new TextDecoder().decode((stream as any).getUnencodedContents())
}

describe('Flattening PDF annotations into the page', () => {
  it("paints a text box's appearance at its rectangle and removes the annotation", async () => {
    const { doc, page } = await informe()
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotation(doc, 'FreeText', [100, 600, 300, 640])]))

    expect(flattenPdfAnnotations(doc)).to.equal(1)
    expect(annotSubtypes(doc)).to.deep.equal([])
    // BBox 100x20 fitted onto a 200x40 rect at (100, 600): scale 2, then move.
    expect(lastContentStream(doc)).to.match(/q\s+2 0 0 2 100 600 cm\s+\/FlatAnnot-?\d+ Do\s+Q/)
  })

  it("carries the appearance's own matrix through before fitting it", async () => {
    // Rotated 90°: the 100x20 box stands 20 wide, 100 tall.
    const { doc, page } = await informe()
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotation(doc, 'FreeText', [50, 50, 70, 150], {}, { bbox: [0, 0, 100, 20], matrix: [0, 1, -1, 0, 0, 0] })]))

    flattenPdfAnnotations(doc)
    // Rotated box spans x -20..0, y 0..100; fitted onto 50..70 x 50..150.
    expect(lastContentStream(doc)).to.match(/q\s+1 0 0 1 70 50 cm\s+\/FlatAnnot-?\d+ Do\s+Q/)
  })

  it('wraps the page in q/Q so its own transforms cannot move what is painted after it', async () => {
    const { doc, page } = await informe()
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotation(doc, 'Circle', [10, 10, 60, 60])]))
    flattenPdfAnnotations(doc)

    const contents = doc.getPages()[0]!.node.Contents() as PDFArray
    const first = doc.context.lookup(contents.get(0)) as any
    expect(new TextDecoder().decode(first.getUnencodedContents()).trim()).to.equal('q')
  })

  it('keeps links, form fields, sticky notes and hidden annotations as they are', async () => {
    const { doc, page } = await informe()
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([
        annotation(doc, 'Link', [0, 0, 10, 10]),
        annotation(doc, 'Widget', [0, 20, 10, 30]),
        annotation(doc, 'Text', [0, 40, 10, 50]),
        annotation(doc, 'FreeText', [0, 60, 10, 70], { F: 2 }),
        annotation(doc, 'Square', [0, 80, 10, 90], {}, null),
      ]),
    )

    expect(flattenPdfAnnotations(doc)).to.equal(0)
    expect(annotSubtypes(doc)).to.deep.equal(['/Link', '/Widget', '/Text', '/FreeText', '/Square'])
  })

  it('drops the popup of an annotation it flattened', async () => {
    const { doc, page } = await informe()
    const freeText = annotation(doc, 'FreeText', [100, 600, 300, 640])
    const popup = annotation(doc, 'Popup', [300, 600, 400, 700], { Parent: freeText }, null)
    page.node.set(PDFName.of('Annots'), doc.context.obj([freeText, popup, annotation(doc, 'Link', [0, 0, 10, 10])]))

    flattenPdfAnnotations(doc)
    expect(annotSubtypes(doc)).to.deep.equal(['/Link'])
  })

  it('leaves a document with nothing to flatten untouched', async () => {
    const { doc } = await informe()
    const before = doc.getPages()[0]!.node.Contents()
    expect(flattenPdfAnnotations(doc)).to.equal(0)
    expect(doc.getPages()[0]!.node.Contents()).to.equal(before)
  })
})

describe('Uploading a PDF', () => {
  it('is flattened however small it is', async () => {
    const { doc, page } = await informe()
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotation(doc, 'FreeText', [100, 600, 300, 640])]))
    const small = Buffer.from(await doc.save())
    expect(small.length).to.be.lessThan(300_000)

    const { buffer, changed } = await compressPatientFile(small, 'application/pdf')
    expect(changed).to.equal(true)
    const reloaded = await PDFDocument.load(buffer)
    expect(annotSubtypes(reloaded)).to.deep.equal([])
  })

  it('comes back byte-for-byte when there is nothing to flatten or compress', async () => {
    const { doc } = await informe()
    const plain = Buffer.from(await doc.save())
    const { buffer, changed } = await compressPatientFile(plain, 'application/pdf')
    expect(changed).to.equal(false)
    expect(buffer).to.equal(plain)
  })

  it('is left alone when it cannot be read', async () => {
    const garbage = Buffer.from('%PDF-1.7 not really')
    const { buffer, changed } = await compressPatientFile(garbage, 'application/pdf')
    expect(changed).to.equal(false)
    expect(buffer).to.equal(garbage)
  })
})
