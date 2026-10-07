import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib'

// "Download PDF" for every report and report page, built in the browser.
//
// A report marks what goes into the file rather than describing it twice:
// each section carries `data-pdf-block`, and this walks those in page order.
//
//   data-pdf-block="kpis"   figures: children with data-pdf-kpi, each holding
//                           data-pdf-label / data-pdf-value / data-pdf-note
//   data-pdf-block="table"  the first <table> inside, as real text, continued
//                           over pages with its header repeated
//   data-pdf-block="image"  the section as it looks on screen (charts, bars)
//   data-pdf-block          (no value) whichever of the three fits
//   data-pdf-title          heading for a kpis/table block (an image block
//                           already shows its own)
//   data-pdf-span           1-12, the width it takes on screen; two image
//                           blocks of 6 or less sit side by side on paper
//   data-pdf-skip           anything inside a block to leave out (menus,
//                           buttons, "Add to a report page")
//
// Text and tables are real text: searchable, and sharp when printed. Charts
// are images at twice screen resolution. A block is never cut in half; only
// a table longer than what is left of the page continues onto the next.

export interface ReportPdfMeta {
  /** The report or page name, printed at the top of every page. */
  title: string
  /** What was filtered, one line each: period, comparison, practitioner, clinic. */
  lines: string[]
  /** Who asked for it, in the footer. */
  generatedBy: string
  logoUrl?: string | null
  /** Without ".pdf". */
  fileName: string
}

type Kpi = { label: string; value: string; note: string }
type Block =
  | { kind: 'kpis'; title: string; kpis: Kpi[] }
  | { kind: 'table'; title: string; head: string[]; rows: string[][] }
  | { kind: 'image'; el: HTMLElement; span: number }

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 40
const CONTENT_W = PAGE_W - 2 * MARGIN
const FOOTER_H = 26
const GAP = 14

const INK = [0.082, 0.09, 0.118] as const
const MUTED = [0.42, 0.443, 0.502] as const
const FAINT = [0.541, 0.561, 0.627] as const
const LINE = [0.91, 0.914, 0.929] as const

// The standard PDF fonts speak WinAnsi, which covers Spanish and the euro but
// not arrows or triangles; a character outside it would stop the whole file.
const SUBSTITUTES: Record<string, string> = { '▲': '+', '▼': '-', '−': '-', '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': 'Yes', '✕': 'x', ' ': ' ', ' ': ' ' }

function collectBlocks(root: HTMLElement): Block[] {
  const blocks: Block[] = []
  const rootWidth = root.getBoundingClientRect().width || 1
  const visible = (el: HTMLElement) => el.getClientRects().length > 0
  const insideBlock = (el: HTMLElement) => {
    const outer = el.parentElement?.closest('[data-pdf-block]')
    return !!outer && root.contains(outer)
  }
  // A report's figure tiles (components/reports/Stat.vue) mark themselves;
  // tiles side by side on screen -- the same parent -- are one row on paper.
  let looseKpis: { parent: Element | null; block: Extract<Block, { kind: 'kpis' }> } | null = null

  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-block], [data-pdf-kpi]'))) {
    if (insideBlock(el) || !visible(el)) continue
    if (!el.hasAttribute('data-pdf-block')) {
      const kpi = readKpi(el)
      if (looseKpis && looseKpis.parent === el.parentElement && looseKpis.block === blocks[blocks.length - 1]) looseKpis.block.kpis.push(kpi)
      else {
        looseKpis = { parent: el.parentElement, block: { kind: 'kpis', title: '', kpis: [kpi] } }
        blocks.push(looseKpis.block)
      }
      continue
    }
    const asked = el.dataset.pdfBlock || ''
    const title = (el.dataset.pdfTitle ?? '').trim()
    const hasKpis = el.querySelector('[data-pdf-kpi]') !== null
    const table = el.querySelector('table')
    // A chart is a picture even when a table sits under it.
    const kind = asked || (hasKpis ? 'kpis' : el.querySelector('canvas') ? 'image' : table ? 'table' : 'image')
    if (kind === 'kpis') {
      const kpis = Array.from(el.querySelectorAll<HTMLElement>('[data-pdf-kpi]')).map(readKpi)
      if (kpis.length) blocks.push({ kind: 'kpis', title, kpis })
    } else if (kind === 'table' && table) {
      const head = Array.from(table.querySelectorAll('thead th')).map((c) => text(c))
      const rows = Array.from(table.querySelectorAll('tbody tr'))
        .map((tr) => Array.from(tr.querySelectorAll('td, th')).map((c) => text(c)))
        .filter((r) => r.some((c) => c !== ''))
      // An empty table still says something ("nobody owes anything"), so it
      // goes in as its heading and a line saying so.
      blocks.push({ kind: 'table', title, head, rows: rows.length ? rows : [[text(el.querySelector('[data-pdf-empty]')) || '—']] })
    } else {
      // Side by side on screen, side by side on paper.
      const span = Number(el.dataset.pdfSpan) || (el.getBoundingClientRect().width / rootWidth <= 0.55 ? 6 : 12)
      blocks.push({ kind: 'image', el, span })
    }
  }
  return blocks
}

function readKpi(k: HTMLElement): Kpi {
  const label = text(k.querySelector('[data-pdf-label]'))
  const valueEl = k.querySelector('[data-pdf-value]')
  if (valueEl) return { label, value: text(valueEl), note: text(k.querySelector('[data-pdf-note]')) }
  // The tile's body: its first line is the figure, the rest a note under it.
  const body = (k.querySelector<HTMLElement>('[data-pdf-body]')?.innerText ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  return { label, value: body[0] ?? '', note: body.slice(1).join(' · ') }
}

// The words, not how they are drawn: innerText applies CSS, so a label set
// in small capitals on screen would come out shouting in the file.
function text(el: Element | null): string {
  if (!el) return ''
  let node: Element = el
  if (el.querySelector('[data-pdf-skip]')) {
    node = el.cloneNode(true) as Element
    for (const skip of Array.from(node.querySelectorAll('[data-pdf-skip]'))) skip.remove()
  }
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim()
}

async function snapshot(el: HTMLElement, fontEmbedCSS: string | undefined): Promise<{ png: string; w: number; h: number }> {
  const { toPng } = await import('html-to-image')
  const rect = el.getBoundingClientRect()
  const opts = {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    fontEmbedCSS,
    filter: (node: HTMLElement) => !(node instanceof HTMLElement && node.hasAttribute('data-pdf-skip')),
  }
  let png: string
  try {
    png = await toPng(el, opts)
  } catch {
    // Embedding the web fonts is what usually fails (a stylesheet that will
    // not be read cross-origin); the section is still worth having without.
    png = await toPng(el, { ...opts, skipFonts: true })
  }
  return { png, w: rect.width, h: rect.height }
}

export async function downloadReportPdf(root: HTMLElement, meta: ReportPdfMeta) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(meta.title)
  doc.setCreator('QuiroFlow')
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const supported = new Set(regular.getCharacterSet())
  const clean = (s: string) =>
    Array.from(s)
      .map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : (SUBSTITUTES[ch] ?? '')))
      .join('')
  const color = (c: readonly [number, number, number]) => rgb(c[0], c[1], c[2])

  let logo: PDFImage | null = null
  if (meta.logoUrl) {
    try {
      const bytes = new Uint8Array(await (await fetch(meta.logoUrl)).arrayBuffer())
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
      logo = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
    } catch {
      logo = null // a logo that will not load is not a reason to have no PDF
    }
  }

  // Nothing half-drawn: a section still loading would go in as its skeleton.
  for (let waited = 0; root.querySelector('[aria-busy="true"]') && waited < 15_000; waited += 100) await new Promise((r) => setTimeout(r, 100))
  const blocks = collectBlocks(root)
  // Images first, all at once, so the layout below is synchronous.
  const images = new Map<HTMLElement, { img: PDFImage; w: number; h: number }>()
  // Paper is white: a page seen in dark mode is photographed in the light
  // one, or its titles and figures come out pale grey on white.
  const html = document.documentElement
  const theme = html.getAttribute('data-theme')
  if (blocks.some((b) => b.kind === 'image') && theme && theme !== 'light') {
    html.setAttribute('data-theme', 'light')
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  }
  try {
  // The web fonts, fetched and inlined once for the whole file rather than
  // again for every section -- that was most of the wait on a page of charts.
  let fontEmbedCSS: string | undefined
  const firstImage = blocks.find((b) => b.kind === 'image')
  if (firstImage?.kind === 'image') {
    try {
      fontEmbedCSS = await (await import('html-to-image')).getFontEmbedCSS(firstImage.el)
    } catch {
      fontEmbedCSS = undefined
    }
  }
  for (const b of blocks) {
    if (b.kind !== 'image') continue
    const shot = await snapshot(b.el, fontEmbedCSS)
    if (shot.w === 0 || shot.h === 0) continue
    images.set(b.el, { img: await doc.embedPng(shot.png), w: shot.w, h: shot.h })
  }
  } finally {
    if (theme && html.getAttribute('data-theme') !== theme) html.setAttribute('data-theme', theme)
  }

  const pages: PDFPage[] = []
  let page!: PDFPage
  let y = 0

  const draw = (s: string, x: number, yy: number, size: number, font: PDFFont, c: readonly [number, number, number] = INK) =>
    page.drawText(clean(s), { x, y: yy, size, font, color: color(c) })
  const fit = (s: string, font: PDFFont, size: number, max: number) => {
    let out = clean(s)
    if (font.widthOfTextAtSize(out, size) <= max) return out
    while (out.length > 1 && font.widthOfTextAtSize(out + '…', size) > max) out = out.slice(0, -1)
    return out + '…'
  }

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H])
    pages.push(page)
    y = PAGE_H - MARGIN
    const first = pages.length === 1
    let logoW = 0
    if (logo) {
      const scale = Math.min(90 / logo.width, 32 / logo.height)
      logoW = logo.width * scale
      page.drawImage(logo, { x: PAGE_W - MARGIN - logoW, y: y - logo.height * scale, width: logoW, height: logo.height * scale })
    }
    const titleSize = first ? 17 : 12
    page.drawText(fit(meta.title, bold, titleSize, CONTENT_W - logoW - 12), { x: MARGIN, y: y - titleSize, size: titleSize, font: bold, color: color(INK) })
    y -= titleSize + 6
    const lines = first ? meta.lines : [meta.lines[0] ?? ''].filter(Boolean)
    for (const line of lines) {
      page.drawText(fit(line, regular, 9, CONTENT_W - logoW - 12), { x: MARGIN, y: y - 9, size: 9, font: regular, color: color(MUTED) })
      y -= 13
    }
    y = Math.min(y, PAGE_H - MARGIN - (logo ? 36 : 0)) - 4
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: first ? 1.5 : 0.75, color: color(first ? INK : LINE) })
    y -= GAP + 2
  }
  const room = () => y - (MARGIN + FOOTER_H)
  const ensure = (h: number) => {
    if (h > room()) newPage()
  }

  function drawKpis(b: Extract<Block, { kind: 'kpis' }>) {
    const perRow = Math.min(4, b.kpis.length)
    const w = (CONTENT_W - (perRow - 1) * 8) / perRow
    const boxH = 50
    const titleH = b.title ? 16 : 0
    ensure(titleH + boxH)
    if (b.title) {
      draw(b.title, MARGIN, y - 10, 10.5, bold)
      y -= titleH
    }
    b.kpis.forEach((k, i) => {
      const col = i % perRow
      if (col === 0 && i > 0) {
        y -= boxH + 8
        ensure(boxH)
      }
      const x = MARGIN + col * (w + 8)
      page.drawRectangle({ x, y: y - boxH, width: w, height: boxH, borderColor: color(LINE), borderWidth: 0.75 })
      page.drawText(fit(k.label.toUpperCase(), bold, 6.8, w - 14), { x: x + 7, y: y - 12, size: 6.8, font: bold, color: color(FAINT) })
      page.drawText(fit(k.value, bold, 15, w - 14), { x: x + 7, y: y - 31, size: 15, font: bold, color: color(INK) })
      if (k.note) page.drawText(fit(k.note, regular, 7.5, w - 14), { x: x + 7, y: y - 43, size: 7.5, font: regular, color: color(MUTED) })
    })
    y -= boxH + GAP
  }

  function drawTable(b: Extract<Block, { kind: 'table' }>) {
    const size = 8.5
    const rowH = 15
    const cols = Math.max(b.head.length, ...b.rows.map((r) => r.length))
    const numeric = Array.from({ length: cols }, (_, c) => c > 0 && b.rows.every((r) => !r[c] || /^[-+−–]?[€\d.,\s%x×]+[€%]?$|^—$/.test(r[c]!)))
    // Every column as wide as it needs, up to a limit; the first (the names)
    // takes whatever is left over.
    const want = Array.from({ length: cols }, (_, c) =>
      Math.min(170, Math.max(bold.widthOfTextAtSize(clean(b.head[c] ?? '').toUpperCase(), 7), ...b.rows.map((r) => regular.widthOfTextAtSize(clean(r[c] ?? ''), size))) + 14),
    )
    const rest = want.slice(1).reduce((a, n) => a + n, 0)
    const widths = rest >= CONTENT_W * 0.75 ? want.map((n) => (n / want.reduce((a, m) => a + m, 0)) * CONTENT_W) : [CONTENT_W - rest, ...want.slice(1)]
    const header = () => {
      if (!b.head.length) return
      let x = MARGIN
      b.head.forEach((h, c) => {
        const label = fit(h.toUpperCase(), bold, 7, widths[c]! - 12)
        const lw = bold.widthOfTextAtSize(label, 7)
        page.drawText(label, { x: numeric[c] ? x + widths[c]! - 6 - lw : x + 6, y: y - 10, size: 7, font: bold, color: color(FAINT) })
        x += widths[c]!
      })
      y -= rowH
      page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: PAGE_W - MARGIN, y: y + 2 }, thickness: 0.75, color: color(LINE) })
    }
    const titleH = b.title ? 16 : 0
    ensure(titleH + rowH * Math.min(3, b.rows.length + 1))
    if (b.title) {
      draw(b.title, MARGIN, y - 10, 10.5, bold)
      y -= titleH
    }
    header()
    for (const r of b.rows) {
      if (rowH > room()) {
        newPage()
        if (b.title) {
          draw(`${b.title} (continued)`, MARGIN, y - 10, 10.5, bold)
          y -= titleH
        }
        header()
      }
      let x = MARGIN
      for (let c = 0; c < cols; c++) {
        const cell = fit(r[c] ?? '', regular, size, widths[c]! - 12)
        const cw = regular.widthOfTextAtSize(cell, size)
        page.drawText(cell, { x: numeric[c] ? x + widths[c]! - 6 - cw : x + 6, y: y - 10.5, size, font: regular, color: color(INK) })
        x += widths[c]!
      }
      y -= rowH
      page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: PAGE_W - MARGIN, y: y + 2 }, thickness: 0.4, color: color(LINE) })
    }
    y -= GAP
  }

  function drawImages(row: { img: PDFImage; w: number; h: number }[]) {
    const each = row.length === 1 ? CONTENT_W : (CONTENT_W - GAP) / 2
    const maxH = PAGE_H - 2 * MARGIN - FOOTER_H - 90
    const sized = row.map((im) => {
      let w = Math.min(each, im.w * 0.75)
      if (row.length === 1) w = each
      let h = (im.h / im.w) * w
      if (h > maxH) {
        w = (maxH / h) * w
        h = maxH
      }
      return { ...im, dw: w, dh: h }
    })
    const tallest = Math.max(...sized.map((s) => s.dh))
    ensure(tallest)
    sized.forEach((s, i) => page.drawImage(s.img, { x: MARGIN + i * (each + GAP), y: y - s.dh, width: s.dw, height: s.dh }))
    y -= tallest + GAP
  }

  newPage()
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    if (b.kind === 'kpis') drawKpis(b)
    else if (b.kind === 'table') drawTable(b)
    else {
      const first = images.get(b.el)
      if (!first) continue
      const next = blocks[i + 1]
      const pair = b.span <= 6 && next?.kind === 'image' && next.span <= 6 ? images.get(next.el) : undefined
      if (pair) {
        drawImages([first, pair])
        i++
      } else drawImages([first])
    }
  }

  const stamp = new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 12 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 12 }, thickness: 0.5, color: color(LINE) })
    p.drawText(clean(`${stamp} · ${meta.generatedBy} · QuiroFlow`), { x: MARGIN, y: MARGIN, size: 7.5, font: regular, color: color(FAINT) })
    const n = clean(`${i + 1} / ${pages.length}`)
    p.drawText(n, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(n, 7.5), y: MARGIN, size: 7.5, font: regular, color: color(FAINT) })
  })

  const bytes = await doc.save()
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${meta.fileName}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return {
    pages: pages.length,
    blocks: blocks.map((b) =>
      b.kind === 'image'
        ? { kind: b.kind, title: b.el.dataset.pdfTitle ?? '' }
        : b.kind === 'kpis'
          ? { kind: b.kind, title: b.title, items: b.kpis.map((k) => `${k.label}: ${k.value}`) }
          : { kind: b.kind, title: b.title, head: b.head, rows: b.rows.length },
    ),
  }
}

/** "Income & Payments", 2026-09 -> "income-payments-2026-09". */
export function pdfFileName(title: string, stamp: string) {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'report'}-${stamp}`
}
