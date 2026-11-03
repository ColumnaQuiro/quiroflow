// Quirocitas' pages, read without a DOM. The pages and why each one is safe
// to touch are described in server/utils/quirocitas.ts, which fetches them;
// this is only the parsing, kept apart so it can be tested on its own.
//
// Regex over markup that has not changed shape in years (2010s PHP,
// consistent double-quoted attributes), checked field by field against a real
// DOM parser over a whole clinic's export before it was trusted.

// --- HTML, without a DOM ----------------------------------------------------

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', egrave: 'è', ograve: 'ò', uuml: 'ü', middot: '·' }
export const quirocitasDecode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&(\w+);/g, (m, n) => NAMED[n] ?? m)
export const quirocitasSafeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
const text = (html: string) => quirocitasDecode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim()

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:[\]-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    if (m.index === 0) continue
    out[m[1]!.toLowerCase()] = quirocitasDecode(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

type Control = string | boolean | null | { value: string; label: string }

// Every named control as the page shows it. Checkboxes are booleans; an
// unchecked radio group is null; a select is its chosen option.
function controls(html: string): Record<string, Control> {
  const fields: Record<string, Control> = {}
  for (const [tag] of html.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(tag)
    if (!a.name || ['submit', 'button', 'image', 'file'].includes(a.type ?? '')) continue
    if (a.type === 'checkbox') fields[a.name] = 'checked' in a
    else if (a.type === 'radio') { if ('checked' in a) fields[a.name] = a.value ?? true; else fields[a.name] ??= null }
    else fields[a.name] = a.value ?? ''
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const a = attrs(`<textarea ${m[1]}>`)
    if (a.name) fields[a.name] = quirocitasDecode(m[2]!).replace(/\r\n/g, '\n').trim()
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const a = attrs(`<select ${m[1]}>`)
    if (!a.name) continue
    const options = [...m[2]!.matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<option\b|$)/gi)].map((o): Record<string, string> => ({ ...attrs(`<option ${o[1]}>`), label: text(o[2]!) }))
    const chosen = options.find((o) => 'selected' in o) ?? options[0]
    fields[a.name] = chosen ? { value: chosen.value ?? chosen.label, label: chosen.label } : null
  }
  return fields
}
const str = (c: Control | undefined) => (c && typeof c === 'object' ? c.value : typeof c === 'string' ? c : '')
const label = (c: Control | undefined) => (c && typeof c === 'object' ? c.label : '')

interface Row { class?: string; cells: string[]; inputs: Record<string, Control>; html: string }
interface Table { header: string[]; rows: Row[] }

// Innermost tables, as header + rows of cell text, each row keeping its
// controls (where the ids are) and its markup.
function tables(html: string): Table[] {
  const out: Table[] = []
  for (const m of html.matchAll(/<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table>/gi)) {
    const rows: Row[] = [...m[1]!.matchAll(/<tr\b([^>]*)>([\s\S]*?)(?=<tr\b|$)/gi)].map((r) => ({
      class: attrs(`<tr ${r[1]}>`).class,
      cells: [...r[2]!.matchAll(/<t([dh])\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)].map((c) => text(c[2]!)),
      inputs: controls(r[2]!),
      html: r[2]!,
    })).filter((r) => r.cells.length)
    if (rows.length >= 2) out.push({ header: rows[0]!.cells, rows: rows.slice(1) })
  }
  return out
}

function section(html: string, id: string, nextIds: string[]) {
  const start = html.indexOf(`id="${id}"`)
  if (start < 0) return ''
  const ends = nextIds.map((n) => html.indexOf(`id="${n}"`, start)).filter((i) => i > start)
  return html.slice(start, ends.length ? Math.min(...ends) : html.indexOf('</form>', start))
}

// --- what comes back ----------------------------------------------------------

export interface QuirocitasListPatient { id: string; name: string; phones: string[] }

export interface QuirocitasPatient {
  id: string
  name: string
  nif: string
  birthDate: string
  address: string
  postcode: string
  city: string
  occupation: string
  gender: string
  language: string
  email: string
  phones: string[]
  preferredPhone: string | null
  chiro: string
  notes: string
  referralSource: string
  consentRgpd: boolean
  /** The box is labelled "No enviar mailings": ticked means no marketing. */
  noMailings: boolean
  /** The "sms" radio: 0 is "No enviar mensajes", 1-3 a phone, 4 e-mail, 5 Telegram. */
  messages: 'none' | 'phone' | 'email' | 'telegram' | ''
  inactive: string
  company: { name: string; nif: string; address: string; postcode: string; city: string } | null
  hasPhoto: boolean
  plans: { times: string; per: string; during: string }[]
  family: string[]
  /** One per appointment, with the id the history and the ledger use. */
  appointments: { id: string; date: string; time: string; type: string; chiro: string; status: string }[]
  /** The record's own visit list: adds the price paid, bono use and the reason / invoice column. */
  visits: { date: string; time: string; type: string; chiro: string; paid: number; bono: boolean; reason: string; status: string }[]
  bonos: { id: string; name: string; remaining: number; expires: string; owed: number; paid: number; status: string }[]
  invoiceLinks: { href: string; number: string; citaId: string | null; bonoPaymentId: string | null }[]
}

export interface QuirocitasHistory {
  generalNotes: string
  visits: { number: string; date: string; type: string; notes: string; citaId: string }[]
  segments: string[]
  tests: { id: string; description: string; category: string; file: string; src: string | null }[]
  biomechanics: { segments: { segment: string; left: boolean; right: boolean }[]; fields: Record<string, string> }
  anamnesis: Record<string, string>
}

export interface QuirocitasInvoice {
  number: string
  year: string | null
  date: string
  name: string | null
  nif: string
  address: string
  postcode: string
  city: string
  concept: string
  vat: string
  irpf: string
  total: string
  citaId: string | null
  bonoPaymentId: string | null
}

export interface QuirocitasBonoType { id: string; name: string; sessions: number; price: number; expiresInDays: number; kind: 'bono' | 'article' | 'debt' }

export interface QuirocitasLedgerRow {
  month: string
  date: string
  name: string
  note: string
  isNew: boolean
  usedBono: boolean
  cash: number | null
  card: number | null
  transfer: number | null
  debt: number | null
  value: number | null
  citaId: string | null
  bonoPaymentId: string | null
}

// --- parsers --------------------------------------------------------------------

export function parseQuirocitasPatientList(html: string): QuirocitasListPatient[] {
  const unq = (s: string) => s.replace(/\\(.)/g, '$1')
  return [...html.matchAll(/r_\[\d+\]\s*=\s*\{([\s\S]*?)\};/g)].map(([, body]) => {
    const id = body!.match(/'id':\s*'((?:\\.|[^'])*)'/)?.[1] ?? ''
    const name = body!.match(/'label':\s*'((?:\\.|[^'])*)'/)?.[1] ?? ''
    const tel = [...(body!.match(/'tel':\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'((?:\\.|[^'])*)'/g)].map((m) => unq(m[1]!)).filter(Boolean)
    return { id: unq(id), name: quirocitasDecode(unq(name)).trim(), phones: tel }
  }).filter((p) => p.id)
}

const amountDot = (s: string | undefined) => { const n = Number((s ?? '').trim()); return Number.isFinite(n) ? n : 0 }

export function parseQuirocitasFicha(html: string): QuirocitasPatient | null {
  const form = html.split(/<form\b/i).find((f) => f.includes('name="id_paciente"'))
  if (!form) return null
  const f = controls(form)
  const all = tables(html)
  const byHeader = (first: string) => all.find((t) => t.header[0] === first)

  const plans = Object.keys(f).filter((k) => /^id_plan\[\d+\]$/.test(k) && str(f[k])).map((k) => {
    const i = k.match(/\d+/)![0]
    return { times: str(f[`veces[${i}]`]), per: label(f[`por[${i}]`]), during: str(f[`durante[${i}]`]) }
  })
  const phones = ['tele1', 'tele2', 'tele3'].map((k) => str(f[k]).trim()).filter(Boolean)
  // The "sms" radio picks which number (1-3) messages go to; 4 is email.
  const preferred = str(f.sms)
  const company = str(f.empresa).trim()

  const visitsTable = byHeader('Núm.')
  const bonosTable = all.find((t) => t.header.includes('Bono/Artículo'))
  const family = all.find((t) => t.header[0] === 'Beneficiarios')

  return {
    id: str(f.id_paciente),
    name: str(f.nombre).trim(),
    nif: str(f.nif).trim(),
    birthDate: str(f.nacimiento).trim(),
    address: str(f.calle).trim(),
    postcode: str(f.codigo).trim(),
    city: str(f.poblacion).trim(),
    occupation: str(f.profesion).trim(),
    gender: str(f.genero),
    language: label(f.idioma),
    email: str(f.email1).trim(),
    phones,
    preferredPhone: /^[123]$/.test(preferred) ? str(f[`tele${preferred}`]).trim() || null : null,
    chiro: label(f.suquiro),
    notes: str(f.notas),
    referralSource: str(f.origen) !== '-1' ? label(f.origen) : '',
    consentRgpd: f.rgpd === true,
    noMailings: f.mailings === true,
    messages: preferred === '0' ? 'none' : /^[123]$/.test(preferred) ? 'phone' : preferred === '4' ? 'email' : preferred === '5' ? 'telegram' : '',
    inactive: label(f.inactivo),
    company: company ? { name: company, nif: str(f.enif).trim(), address: str(f.ecalle).trim(), postcode: str(f.ecodigo).trim(), city: str(f.epoblacion).trim() } : null,
    hasPhoto: /<img\b[^>]*src="\d+\/photo\.\w+/i.test(form),
    plans,
    family: (family?.rows ?? []).map((r) => str(Object.entries(r.inputs).find(([k]) => k.startsWith('idllistabene'))?.[1])).filter(Boolean),
    // The search's own list; its first row is a "----------" placeholder.
    appointments: (byHeader('Dia')?.rows ?? []).map((r) => ({
      id: str(Object.entries(r.inputs).find(([k]) => k.startsWith('buscita_'))?.[1]),
      date: r.cells[1] ?? '', time: r.cells[2] ?? '', type: r.cells[3] ?? '', chiro: r.cells[4] ?? '', status: r.class ?? '',
    })).filter((a) => a.id && a.id !== '-1'),
    // Nine cells: number, weekday, date, time, type, chiro, paid, B, reason.
    // The table ends in "Total: N" rows, which have three.
    visits: (visitsTable?.rows ?? []).filter((r) => r.cells.length === 9).map((r) => ({
      date: r.cells[2]!, time: r.cells[3]!, type: r.cells[4]!, chiro: r.cells[5]!, paid: amountDot(r.cells[6]), bono: r.cells[7] === 'B', reason: r.cells[8]!, status: r.class ?? '',
    })),
    // The bono's id is its radio's value, checked or not.
    bonos: (bonosTable?.rows ?? []).map((r) => ({ r, id: r.html.match(/name="selbono"[^>]*value="(\d+)"/i)?.[1] ?? r.html.match(/value="(\d+)"[^>]*name="selbono"/i)?.[1] })).filter(({ r, id }) => id && r.cells[1]).map(({ r, id }) => ({
      id: id!, name: r.cells[1]!, remaining: Number(r.cells[2]) || 0, expires: r.cells[3] ?? '', owed: amountDot(r.cells[4]), paid: amountDot(r.cells[5]), status: r.class ?? '',
    })),
    // An invoice that exists is a link with its number as the text. The same
    // link with no text, on every other visit, would CREATE one -- never
    // followed.
    invoiceLinks: [...new Map([...html.matchAll(/<a href="(factura\.php\?[^"]*)"[^>]*>([^<]+)<\/a>/gi)]
      .filter((m) => text(m[2]!))
      .map((m) => {
        const href = quirocitasDecode(m[1]!)
        return [href, { href, number: text(m[2]!), citaId: href.match(/idcita=(\d+)/)?.[1] ?? null, bonoPaymentId: href.match(/idpagobono=(\d+)/)?.[1] ?? null }] as const
      })).values()],
  }
}

/** The clinic's bono types, from the new-bono dialog every record carries. */
export function parseQuirocitasBonoTypes(html: string): QuirocitasBonoType[] {
  const catalog = html.match(/var tb = (\{[\s\S]*?\});/)?.[1] ?? '{}'
  const select = html.match(/<select[^>]*name="tipobono"[^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? ''
  return [...select.matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<option\b|$)/gi)].map((o) => {
    const a = attrs(`<option ${o[1]}>`)
    const id = a.value ?? ''
    const entry = catalog.match(new RegExp(`'${id}':\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    const num = (k: string) => Number(entry.match(new RegExp(`'${k}':\\s*'([^']*)'`))?.[1] ?? 0) || 0
    const kind = a['data-bonoarti'] === 'A' ? 'article' : a['data-bonoarti'] === 'D' ? 'debt' : 'bono'
    return { id, name: text(o[2]!), sessions: num('citas'), price: num('precio'), expiresInDays: num('caduca'), kind } as QuirocitasBonoType
  }).filter((t) => t.id)
}

export function parseQuirocitasHistory(html: string): QuirocitasHistory {
  const tabs = ['historial', 'pruebas', 'biomecanico', 'anamnesis']
  const part = Object.fromEntries(tabs.map((t, i) => [t, section(html, t, tabs.slice(i + 1))])) as Record<string, string>

  const visits: QuirocitasHistory['visits'] = []
  for (const m of part.historial!.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?name="notas_\d+"[\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)(?=<td\b|$)/gi)].map((c) => c[1]!)
    const f = controls(m[1]!)
    const n = Object.keys(f).find((k) => k.startsWith('notas_'))!
    visits.push({ number: text(cells[0] ?? ''), date: text(cells[1] ?? ''), type: text(cells[2] ?? ''), notes: str(f[n]), citaId: str(f[n.replace('notas_', 'idcita_')]) })
  }
  const segments: string[] = []
  for (const m of part.historial!.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?name="tiz\[(\d+)\]"[\s\S]*?)<\/tr>/gi)) segments[Number(m[2])] = text(m[1]!)

  const tests = [...part.pruebas!.matchAll(/<div class="thumb">([\s\S]*?)(?=<div class="thumb">|$)/gi)].map(([, t]) => {
    const f = controls(t!)
    const src = [...t!.matchAll(/(?:src|href)="([^"]*\/pruebas\/[^"]+)"/gi)].map((m) => quirocitasDecode(m[1]!).replace(/\?.*$/, ''))[0] ?? null
    const desc = text(t!.match(/<div class="thudesc">([\s\S]*?)<\/div>/i)?.[1] ?? '')
    const k = (p: string) => str(Object.entries(f).find(([n]) => n.startsWith(p))?.[1])
    const file = src ? quirocitasSafeDecode(src.split('/').pop()!) : desc.split('|').pop()!.trim()
    return { id: k('idprueba_'), description: k('descprueba_') || desc.split('|').slice(0, -1).join('|').trim(), category: k('categoria_'), file, src }
  })

  const bio = controls(part.biomecanico!)
  const bioSegments: QuirocitasHistory['biomechanics']['segments'] = []
  for (const m of part.biomecanico!.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?name="iz\[(\d+)\]"[\s\S]*?)<\/tr>/gi)) {
    const i = Number(m[2])
    if (bio[`iz[${i}]`] || bio[`de[${i}]`]) bioSegments.push({ segment: text(m[1]!), left: !!bio[`iz[${i}]`], right: !!bio[`de[${i}]`] })
  }
  const filled = (o: Record<string, Control>) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !/^(iz|de)\[/.test(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()]))

  return {
    generalNotes: str(controls(part.historial!).notas),
    visits,
    segments,
    tests,
    biomechanics: { segments: bioSegments, fields: filled(bio) },
    anamnesis: filled(controls(part.anamnesis!)),
  }
}

export function parseQuirocitasInvoice(html: string): QuirocitasInvoice {
  const form = html.split(/<form\b/i).find((f) => f.includes('name="numfac')) ?? ''
  const f = controls(form)
  const get = (n: string) => str(Object.entries(f).find(([k]) => k.replace(/\d+$/, '') === n)?.[1])
  return {
    number: get('numfac'),
    year: text(form.match(/name="numfac\d*"[^>]*>([^<]*)/i)?.[1] ?? '').match(/\d{4}/)?.[0] ?? null,
    date: get('fechafac'),
    name: text(form.match(/Nombre:([\s\S]*?)<\/td>/i)?.[1] ?? '') || null,
    nif: get('nif'),
    address: get('calle'),
    postcode: get('codigo'),
    city: get('poblacion'),
    concept: get('concepto'),
    vat: get('tipoiva'),
    irpf: get('tipoirpf'),
    total: get('importe'),
    citaId: get('idcita') || null,
    bonoPaymentId: get('idpagobono') || null,
  }
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const amountComma = (s: string | undefined) => { const t = (s ?? '').replace(/\./g, '').replace(',', '.').trim(); return t && Number.isFinite(Number(t)) ? Number(t) : null }

/** One month of the cash ledger, with the totals the page prints under it. */
export function parseQuirocitasCajaMonth(html: string) {
  const m = html.match(/Mes de (\w+) de (\d{4})/i)
  const idx = m ? MONTHS.indexOf(m[1]!.toLowerCase()) : -1
  const month = m && idx >= 0 ? `${m[2]}-${String(idx + 1).padStart(2, '0')}` : null
  const table = tables(html).find((t) => t.header.includes('Efectivo') || t.rows.some((r) => r.cells.includes('Efectivo')))
  const rows: QuirocitasLedgerRow[] = (table?.rows ?? []).filter((r) => /^\d{2}-\d{2}-\d{4}$/.test(r.cells[1] ?? '')).map((r) => {
    const id = (p: string) => { const v = str(Object.entries(r.inputs).find(([k]) => k.replace(/\d+$/, '') === p)?.[1]); return v && v !== '0' && v !== '-1' ? v : null }
    return {
      month: month ?? '', date: r.cells[1]!, name: r.cells[2] ?? '', note: r.cells[3] ?? '', isNew: !!r.cells[4], usedBono: r.cells[5] === 'B',
      cash: amountComma(r.cells[6]), card: amountComma(r.cells[7]), transfer: amountComma(r.cells[8]), debt: amountComma(r.cells[9]), value: amountComma(r.cells[11]),
      citaId: id('cita'), bonoPaymentId: id('pagobono'),
    }
  })
  const footer = (id: string) => amountComma(html.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`))?.[1] ?? html.match(new RegExp(`value="([^"]*)"[^>]*id="${id}"`))?.[1])
  return {
    month,
    rows,
    totals: { cash: footer('caja-\\d+'), card: footer('totalmeto-\\d+\\[2\\]'), transfer: footer('totalmeto-\\d+\\[3\\]'), value: footer('valortotal-\\d+') },
    everyChiro: str(controls(html).quiro) === '-1',
  }
}

// The body a browser would send for the page's diario.php form, minus every
// button: the caller adds the one being "clicked".
export function quirocitasCajaFormBody(html: string): [string, string][] {
  const form = html.split(/<form\b/i).find((f) => /action="diario\.php"/i.test(f.slice(0, 300))) ?? ''
  const body: [string, string][] = []
  for (const [tag] of form.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(tag)
    if (!a.name || ['submit', 'button', 'image', 'file', 'reset'].includes(a.type ?? '')) continue
    if ((a.type === 'checkbox' || a.type === 'radio') && !('checked' in a)) continue
    body.push([a.name, a.value ?? 'on'])
  }
  for (const m of form.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) { const a = attrs(`<t ${m[1]}>`); if (a.name) body.push([a.name, quirocitasDecode(m[2]!)]) }
  for (const m of form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const a = attrs(`<s ${m[1]}>`)
    const options = [...m[2]!.matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<option\b|$)/gi)].map((o): Record<string, string> => ({ ...attrs(`<o ${o[1]}>`), label: text(o[2]!) }))
    const chosen = options.find((o) => 'selected' in o) ?? options[0]
    if (a.name && chosen) body.push([a.name, chosen.value ?? chosen.label])
  }
  return body
}

