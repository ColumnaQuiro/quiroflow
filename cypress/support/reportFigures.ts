// Every figure a report or dashboard widget shows, read off the page as text,
// plus the numbers behind every chart -- so a spec can pin all of them at
// once and a change that moves any one of them fails.
//
// Recorded rather than hand-written. The report-figures specs seed a
// generated clinic (scripts/lib/report-dataset.mjs) against a fixed instant,
// freeze the browser's Date to it, and compare each page with
// cypress/fixtures/<spec>.json. With CYPRESS_RECORD_REPORT_FIGURES=1 they
// write that file instead; that is how it was made, from the pages as they
// were before the reports were reworked for speed, and it is only ever
// re-recorded on purpose, when a figure is meant to change.
//
// What is deliberately NOT pinned:
//
//   - the order of rows that tie. Lists, tables and chart points are compared
//     as sorted sets of "label | value" lines, because two practitioners with
//     the same takings, or two visit types with the same count, come out in
//     whatever order the database returned the rows -- which no query
//     promises, and which differs between an empty CI database and a busy
//     local one. Every value and the label beside it are still compared.
//   - widgets whose figures are measured against the database's own clock
//     (days since a last visit, days overdue), not the frozen browser one.
//     Those are compared against the view directly, in their own test.
export const SERVER_CLOCK_WIDGETS = ['Recalls due', 'Care plans behind schedule']

export interface FigureSnapshot {
  lines: string[]
  charts: string[]
}

function lineOf(el: HTMLElement): string {
  return el.innerText.replace(/\s*\n\s*/g, ' | ').replace(/[ \t]+/g, ' ').trim()
}

function rendered(el: Element): boolean {
  return (el as HTMLElement).getClientRects().length > 0
}

export function snapshotRegion(doc: Document): FigureSnapshot {
  const region = doc.querySelector<HTMLElement>('.overflow-y-auto.bg-surface-page')
  const lines: string[] = []
  const visit = (el: HTMLElement) => {
    if (!rendered(el)) return
    const title = el.matches('.rounded-card') ? el.querySelector('h3')?.textContent?.trim() : undefined
    if (title && SERVER_CLOCK_WIDGETS.includes(title)) {
      lines.push(`${title}: (server clock)`)
      return
    }
    // A bar drawn to scale says its figure only in its height.
    if (el.style.height && !el.innerText.trim()) {
      lines.push(`height ${el.style.height}`)
      return
    }
    // Rows built from divs rather than <li> -- the same flex row repeated --
    // are a list too, and tie the same way.
    const kids = [...el.children] as HTMLElement[]
    const rowList = kids.length >= 2 && kids.every((k) => k.tagName === 'DIV' && k.className === kids[0].className && /\bflex\b/.test(k.className) && k.innerText.trim())
    if (el.matches('ul, ol, tbody') || rowList) {
      const items = [...el.children].filter(rendered).map((c) => lineOf(c as HTMLElement)).filter(Boolean).sort()
      lines.push(`[${items.join(' ; ')}]`)
      return
    }
    if (el.matches('li, tr')) {
      const line = lineOf(el)
      if (line) lines.push(line)
      return
    }
    if (el.matches('select')) {
      const select = el as HTMLSelectElement
      lines.push(`<select: ${select.selectedOptions[0]?.textContent?.trim() ?? ''}>`)
      return
    }
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text) lines.push(text)
      } else if (node.nodeType === 1) {
        visit(node as HTMLElement)
      }
    }
  }
  if (region) visit(region)
  return { lines, charts: chartData(doc) }
}

// The data each vue-chartjs chart was handed, found on the rendered vnode
// tree (the canvas itself holds only pixels). Each dataset becomes its sorted
// "label=value" pairs, and the datasets are sorted too -- see above on ties.
export function chartData(doc: Document): string[] {
  const charts: string[] = []
  const seen = new Set<unknown>()
  const walk = (vnode: any) => {
    if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return
    seen.add(vnode)
    const data = vnode.props?.data
    if (data && Array.isArray(data.datasets) && Array.isArray(data.labels)) {
      const sets = data.datasets
        .map((s: { label?: string; data: unknown[] }) => `${s.label ?? ''}: ${data.labels.map((l: unknown, i: number) => `${l}=${JSON.stringify(s.data[i] ?? null)}`).sort().join(', ')}`)
        .sort()
      charts.push(sets.join(' || '))
    }
    if (vnode.component) walk(vnode.component.subTree)
    if (vnode.suspense) walk(vnode.suspense.activeBranch)
    if (Array.isArray(vnode.children)) vnode.children.forEach(walk)
  }
  walk((doc.querySelector('#__nuxt') as any)?._vnode)
  return [...new Set(charts)].sort()
}

/**
 * Waits until the page has finished loading what it shows: nothing still
 * drawing a skeleton or marked busy, and the figures unchanged for a moment
 * (a filter change starts its load a tick after the click, so "no skeleton"
 * alone can be read in the gap before it begins).
 */
export function settledSnapshot(): Cypress.Chainable<FigureSnapshot> {
  let last = ''
  let since = 0
  return cy
    .document({ log: false })
    .should((doc) => {
      const region = doc.querySelector('.overflow-y-auto.bg-surface-page')
      expect(region, 'report region').to.exist
      expect(region!.querySelector('.skeleton-shimmer, [aria-busy="true"]'), 'still loading').to.equal(null)
      const snapshot = JSON.stringify(snapshotRegion(doc))
      const now = performance.now()
      if (snapshot !== last) {
        last = snapshot
        since = now
      }
      expect(now - since, 'figures stable').to.be.greaterThan(800)
    })
    .then(() => JSON.parse(last) as FigureSnapshot)
}

const recording = () => !!Cypress.env('RECORD_REPORT_FIGURES')

/** Compares the settled page with the recorded figures under `key` (or records them). */
export function expectFigures(fixture: string, recorded: Record<string, FigureSnapshot>, key: string) {
  settledSnapshot().then((actual) => {
    if (recording()) {
      recorded[key] = actual
      return
    }
    cy.fixture(fixture).then((all: Record<string, FigureSnapshot>) => {
      expect(all[key], `recorded figures for ${key}`).to.exist
      expect(actual.lines, `${key}: what the page shows`).to.deep.equal(all[key].lines)
      expect(actual.charts, `${key}: what the charts were given`).to.deep.equal(all[key].charts)
    })
  })
}

export function saveRecordedFigures(fixture: string, recorded: Record<string, FigureSnapshot>) {
  if (recording()) cy.writeFile(`cypress/fixtures/${fixture}`, recorded)
}

/** The same preset every report's range picker offers. */
export function pickPreset(label: 'Last 7 days' | 'Last 30 days' | 'This month' | 'Last month') {
  // clickUntil, not click: the button can be in the server-rendered HTML
  // before Vue has hydrated it. See cypress/support/commands.ts.
  cy.clickUntil('button:contains("month"), button:contains("days")', 'button:contains("Last 7 days")')
  cy.contains('button', label).click()
}
