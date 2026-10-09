import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFStream, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib'

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

function numbers(arr: PDFArray | undefined): number[] | null {
  if (!arr) return null
  const out: number[] = []
  for (let i = 0; i < arr.size(); i++) {
    const n = arr.lookup(i)
    if (!(n instanceof PDFNumber)) return null
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
function normalAppearance(doc: PDFDocument, annot: PDFDict): PDFRef | null {
  const ap = annot.lookupMaybe(PDFName.of('AP'), PDFDict)
  if (!ap) return null
  let n = ap.get(PDFName.of('N'))
  const resolved = doc.context.lookup(n)
  // A dictionary of states (a checkbox's on/off): /AS says which is showing.
  if (resolved instanceof PDFDict && !(resolved instanceof PDFStream)) {
    const state = annot.lookupMaybe(PDFName.of('AS'), PDFName)
    if (!state) return null
    n = resolved.get(state)
  }
  if (!(doc.context.lookup(n) instanceof PDFStream)) return null
  return n instanceof PDFRef ? n : null
}

/**
 * Paints every visible markup annotation into its page and removes it.
 * Returns how many were flattened; 0 means the document was not touched.
 */
export function flattenPdfAnnotations(doc: PDFDocument): number {
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
      if (!(annot instanceof PDFDict)) continue

      const subtype = annot.lookupMaybe(PDFName.of('Subtype'), PDFName)?.toString() ?? ''
      const flags = annot.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0
      const appearance = normalAppearance(doc, annot)
      const rect = numbers(annot.lookupMaybe(PDFName.of('Rect'), PDFArray))
      const form = appearance ? doc.context.lookup(appearance, PDFStream) : null
      const bbox = form ? numbers(form.dict.lookupMaybe(PDFName.of('BBox'), PDFArray)) : null

      if (KEEP.has(subtype) || flags & HIDDEN || flags & NO_VIEW || annot.has(PDFName.of('OC')) || !appearance || !form || !rect || rect.length !== 4 || !bbox || bbox.length !== 4) {
        keep.push(entry)
        continue
      }

      // PDF 32000-1, 12.5.5: the appearance's BBox, carried through its own
      // Matrix, is fitted onto the annotation's Rect. Do applies the form's
      // Matrix itself, so only the fitting goes in front of it.
      const matrix = numbers(form.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray)) ?? [1, 0, 0, 1, 0, 0]
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
      form.dict.set(PDFName.of('Type'), PDFName.of('XObject'))
      form.dict.set(PDFName.of('Subtype'), PDFName.of('Form'))

      const name = page.node.newXObject('FlatAnnot', appearance)
      ops.push(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, target[0] - sx * box[0], target[1] - sy * box[1]), drawObject(name), popGraphicsState())
      dropped.add(entry)
      flattened++
    }

    if (dropped.size === 0) continue

    // A popup belongs to the annotation it pops up from; with that gone it is
    // an orphan a viewer may still draw as an empty box.
    const remaining = keep.filter((entry) => {
      const annot = doc.context.lookup(entry) as PDFDict
      const parent = annot.get(PDFName.of('Parent'))
      return !(parent && dropped.has(parent as PDFRef))
    })
    if (remaining.length > 0) page.node.set(PDFName.of('Annots'), doc.context.obj(remaining))
    else page.node.delete(PDFName.of('Annots'))

    // The page's own content is wrapped in q/Q first, so a transform it
    // leaves behind cannot move what is drawn after it.
    const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]))
    const end = doc.context.register(doc.context.contentStream([popGraphicsState()]))
    page.node.wrapContentStreams(start, end)
    page.node.addContentStream(doc.context.register(doc.context.contentStream(ops)))
  }

  return flattened
}
