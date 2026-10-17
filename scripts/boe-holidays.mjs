#!/usr/bin/env node
// Prints one year of Spain's fiestas laborales, national and by comunidad,
// as the entry utils/spanishHolidays.ts keeps for that year -- read from the
// BOE's own XML of the Dirección General de Trabajo's yearly resolution
// ("…por la que se publica la relación de fiestas laborales para el año N"),
// which comes out every October for the year after.
//
//   node scripts/boe-holidays.mjs BOE-A-2026-21254 2027
//
// Paste the output into HOLIDAYS there. Local holidays (two per municipality)
// are not in it: each province publishes those, and clinics add them by hand.
const [id, yearArg] = process.argv.slice(2)
if (!/^BOE-A-\d{4}-\d+$/.test(id ?? '') || !/^\d{4}$/.test(yearArg ?? '')) {
  console.error('usage: node scripts/boe-holidays.mjs <BOE-A-…> <year>')
  process.exit(1)
}
const year = Number(yearArg)

// The annex's columns, left to right, as ISO 3166-2 codes.
const COLUMNS = ['ES-AN', 'ES-AR', 'ES-AS', 'ES-IB', 'ES-CN', 'ES-CB', 'ES-CM', 'ES-CL', 'ES-CT', 'ES-EX', 'ES-GA', 'ES-MD', 'ES-MC', 'ES-NC', 'ES-PV', 'ES-RI', 'ES-VC', 'ES-CE', 'ES-ML']
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const res = await fetch(`https://www.boe.es/diario_boe/xml.php?id=${id}`)
if (!res.ok) throw new Error(`BOE answered ${res.status}`)
const xml = await res.text()
if (!xml.includes(`fiestas laborales para el año ${year}`)) throw new Error(`${id} is not the ${year} fiestas laborales resolution`)

const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim()
const annex = xml.slice(xml.indexOf('ANEXO'))
const rows = []
let month = null
for (const [, tr] of annex.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
  const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => decode(m[1]))
  if (!cells.length) continue
  const asMonth = MONTHS.indexOf(cells[0].toLowerCase())
  if (asMonth >= 0) {
    month = asMonth + 1
    continue
  }
  const day = cells[0].match(/^(\d{1,2})\s+(.+?)\.?$/)
  if (!day || month === null) continue
  const marks = cells.slice(1)
  if (marks.length !== COLUMNS.length) throw new Error(`"${cells[0]}" has ${marks.length} columns, expected ${COLUMNS.length}: the annex changed shape`)
  const regions = COLUMNS.filter((_, i) => marks[i])
  const date = `${year}-${String(month).padStart(2, '0')}-${day[1].padStart(2, '0')}`
  rows.push([date, day[2], regions.length === COLUMNS.length ? '*' : regions.join(' ')])
}
if (rows.length < 20) throw new Error(`only ${rows.length} holidays found: the annex changed shape`)

console.log(`  // ${id}`)
console.log(`  ${year}: [`)
for (const [date, name, regions] of rows) console.log(`    ['${date}', ${JSON.stringify(name).replace(/'/g, "\\'").replace(/^"|"$/g, "'")}, '${regions}'],`)
console.log('  ],')
