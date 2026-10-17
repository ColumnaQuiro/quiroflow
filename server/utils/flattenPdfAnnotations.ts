import type { PDFArray, PDFDict, PDFDocument, PDFRef } from 'pdf-lib'

// pdf-lib arrives as an argument rather than an import. A static import here
// puts the whole library into the Nitro chunk every request evaluates, and a
// cold start then loads it before serving a page that will never touch a PDF.
// The two callers `await import('pdf-lib')` when they have a file in hand and
// pass it down.
export type PdfLib = typeof import('pdf-lib')

// Draws a PDF's annotations into the page itself.
//
// macOS Preview fills in a document by laying text boxes, shapes and
// signatures OVER the page as annotations; the page underneath stays the
// blank template. A desktop browser draws annotations, so the file looks
// finished there. The viewer Android hands a PDF to does not: one patient's
// informe (30 Sep 2026: 24 Preview text boxes, 12 circles) opened on their
// phone as the empty template, the same file that read correctly on the
// clinic's computer. A patient forwarding it, or opening it from WhatsApp or
// email, would be at the mercy of whichever viewer they have.
//
// Each annotation already carries its own rendering -- the /AP normal
// appearance, a small Form XObject -- which is exactly what a viewer paints
// at /Rect. Painting that same XObject into the page content and dropping the
// annotation makes the page look the same everywhere. Nothing is redrawn or
// re-typeset, so what the clinic saw is what everyone sees.
//
// Deliberately left as annotations:
//   - Links: they still need to be clickable, and paint nothing.
//   - Form fields (Widget): a fillable form should stay fillable.
//   - Sticky notes (Text) and their Popups: a comment for the author, shown
//     as an icon -- not content.
//   - Anything hidden or not for display (flags), or switched by optional
//     content, or without an appearance to paint.

const KEEP = new Set(['/Link', '/Widget', '/Text', '/Popup'])

// Annotation flags (PDF 32000-1, 12.5.3).
const HIDDEN = 1 << 1
const NO_VIEW = 1 << 5

type Box = [number, number, number, number]

function numbers(lib: PdfLib, arr: PDFArray | undefined): number[] | null {
  if (!arr) return null
  const out: number[] = []
  for (let i = 0; i < arr.size(); i++) {
    const n = arr.lookup(i)
    if (!(n instanceof lib.PDFNumber)) return null
    out.push(n.asNumber())
  }
  return out
}

function normalised(box: number[]): Box {
  const [x1, y1, x2, y2] = box as Box
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
}

/** The bounding box of `box` once `m` is applied to it. */
function transformBox(box: Box, m: number[]): Box {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number]
  const corners = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ].map(([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f])
  const xs = corners.map((p) => p[0]!)
  const ys = corners.map((p) => p[1]!)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** The appearance a viewer would paint for this annotation, as an indirect stream. */
function normalAppearance(lib: PdfLib, doc: PDFDocument, annot: PDFDict): PDFRef | null {
  const ap = annot.lookupMaybe(lib.PDFName.of('AP'), lib.PDFDict)
  if (!ap) return null
  let n = ap.get(lib.PDFName.of('N'))
  const resolved = doc.context.lookup(n)
  // A dictionary of states (a checkbox's on/off): /AS says which is showing.
  if (resolved instanceof lib.PDFDict && !(resolved instanceof lib.PDFStream)) {
    const state = annot.lookupMaybe(lib.PDFName.of('AS'), lib.PDFName)
    if (!state) return null
    n = resolved.get(state)
  }
  if (!(doc.context.lookup(n) instanceof lib.PDFStream)) return null
  return n instanceof lib.PDFRef ? n : null
}

/**
 * Paints every visible markup annotation into its page and removes it.
 * Returns how many were flattened; 0 means the document was not touched.
 */
export function flattenPdfAnnotations(lib: PdfLib, doc: PDFDocument): number {
  let flattened = 0

  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    if (!annots || annots.size() === 0) continue

    const keep: (PDFRef | PDFDict)[] = []
    const ops = []
    const dropped = new Set<PDFRef | PDFDict>()

    for (let i = 0; i < annots.size(); i++) {
      const entry = annots.get(i) as PDFRef | PDFDict
      const annot = doc.context.lookup(entry)
      if (!(annot instanceof lib.PDFDict)) continue

      const subtype = annot.lookupMaybe(lib.PDFName.of('Subtype'), lib.PDFName)?.toString() ?? ''
      const flags = annot.lookupMaybe(lib.PDFName.of('F'), lib.PDFNumber)?.asNumber() ?? 0
      const appearance = normalAppearance(lib, doc, annot)
      const rect = numbers(lib, annot.lookupMaybe(lib.PDFName.of('Rect'), lib.PDFArray))
      const form = appearance ? doc.context.lookup(appearance, lib.PDFStream) : null
      const bbox = form ? numbers(lib, form.dict.lookupMaybe(lib.PDFName.of('BBox'), lib.PDFArray)) : null

      if (KEEP.has(subtype) || flags & HIDDEN || flags & NO_VIEW || annot.has(lib.PDFName.of('OC')) || !appearance || !form || !rect || rect.length !== 4 || !bbox || bbox.length !== 4) {
        keep.push(entry)
        continue
      }

      // PDF 32000-1, 12.5.5: the appearance's BBox, carried through its own
      // Matrix, is fitted onto the annotation's Rect. Do applies the form's
      // Matrix itself, so only the fitting goes in front of it.
      const matrix = numbers(lib, form.dict.lookupMaybe(lib.PDFName.of('Matrix'), lib.PDFArray)) ?? [1, 0, 0, 1, 0, 0]
      const box = transformBox(normalised(bbox), matrix)
      const target = normalised(rect)
      const width = box[2] - box[0]
      const height = box[3] - box[1]
      if (width <= 0 || height <= 0) {
        keep.push(entry)
        continue
      }
      const sx = (target[2] - target[0]) / width
      const sy = (target[3] - target[1]) / height

      // An appearance is a Form XObject by definition; some writers leave the
      // type off, which a viewer forgives in an annotation and not in Do.
      form.dict.set(lib.PDFName.of('Type'), lib.PDFName.of('XObject'))
      form.dict.set(lib.PDFName.of('Subtype'), lib.PDFName.of('Form'))

      const name = page.node.newXObject('FlatAnnot', appearance)
      ops.push(lib.pushGraphicsState(), lib.concatTransformationMatrix(sx, 0, 0, sy, target[0] - sx * box[0], target[1] - sy * box[1]), lib.drawObject(name), lib.popGraphicsState())
      dropped.add(entry)
      flattened++
    }

    if (dropped.size === 0) continue

    // A popup belongs to the annotation it pops up from; with that gone it is
    // an orphan a viewer may still draw as an empty box.
    const remaining = keep.filter((entry) => {
      const annot = doc.context.lookup(entry) as PDFDict
      const parent = annot.get(lib.PDFName.of('Parent'))
      return !(parent && dropped.has(parent as PDFRef))
    })
    if (remaining.length > 0) page.node.set(lib.PDFName.of('Annots'), doc.context.obj(remaining))
    else page.node.delete(lib.PDFName.of('Annots'))

    // The page's own content is wrapped in q/Q first, so a transform it
    // leaves behind cannot move what is drawn after it.
    const start = doc.context.register(doc.context.contentStream([lib.pushGraphicsState()]))
    const end = doc.context.register(doc.context.contentStream([lib.popGraphicsState()]))
    page.node.wrapContentStreams(start, end)
    page.node.addContentStream(doc.context.register(doc.context.contentStream(ops)))
  }

  return flattened
}
