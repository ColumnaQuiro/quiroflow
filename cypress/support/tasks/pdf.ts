import { inflateSync } from 'node:zlib'

// The text a PDF actually prints, one entry per drawn string.
//
// Enough of a reader for the documents this app generates and nothing more:
// pdfkit compresses each content stream with Flate and, for the standard
// fonts it uses, writes every string as hex glyph codes inside a TJ array,
// split wherever kerning applies. So: inflate every stream, take each TJ
// array, join its hex pieces, decode. Asserting on this rather than on the
// row that fed the PDF is the point -- the document is what the patient is
// handed, and a bug between the row and the page would pass a row check.
function pdfText(binary: string): string[] {
  const buf = Buffer.from(binary, 'binary')
  const texts: string[] = []
  let at = 0
  while (true) {
    const start = buf.indexOf('stream', at, 'latin1')
    if (start === -1) break
    let dataStart = start + 'stream'.length
    if (buf[dataStart] === 0x0d) dataStart++
    if (buf[dataStart] === 0x0a) dataStart++
    const end = buf.indexOf('endstream', dataStart, 'latin1')
    if (end === -1) break
    at = end + 'endstream'.length

    let content: string
    try {
      content = inflateSync(buf.subarray(dataStart, end)).toString('latin1')
    } catch {
      // An image or an uncompressed stream; neither carries text here.
      continue
    }
    for (const match of content.matchAll(/\[((?:<[0-9a-fA-F]*>|[\s\d.-])*)\]\s*TJ/g)) {
      const hex = [...match[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1]).join('')
      texts.push(Buffer.from(hex, 'hex').toString('latin1'))
    }
  }
  return texts
}

export const pdfTasks = {
  'pdf:text': (opts: { binary: string }) => pdfText(opts.binary),
}
