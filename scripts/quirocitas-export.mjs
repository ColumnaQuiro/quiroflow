#!/usr/bin/env node
// Downloads everything a Quirocitas clinic holds about its patients, for
// migrating them into QuiroFlow. Quirocitas' own CSV export carries only the
// demographics; the clinical history, attachments, photos, appointments,
// bonos and payments are only reachable through its web pages, so this reads
// those pages the way a logged-in user would. It never submits a form that
// saves anything.
//
//   QUIROCITAS_USER=… QUIROCITAS_PASSWORD=… \
//     node scripts/quirocitas-export.mjs https://quirocitas-yourclinic.es/chiro
//
// or keep the credentials out of the shell history:
//
//   node --env-file=$HOME/.quiroflow/quirocitas-yourclinic.env \
//     scripts/quirocitas-export.mjs https://quirocitas-yourclinic.es/chiro
//
// Every clinic runs the same PHP app on its own host, so the base URL is the
// only thing that changes between clinics. QUIROCITAS_COOKIE="PHPSESSID=…"
// works instead of a password, from a browser that is already logged in.
//
// Output (patient data -- outside the repo by default):
//
//   ~/.quiroflow/quirocitas/<host>/
//     patients.json            the clinic's patient list (id, name, phones)
//     summary.json             counts and every failure, per patient
//     patients/<id>/
//       patient.json           everything below, parsed
//       ficha.html             the patient record page, as served
//       historial.html         the clinical history page, as served
//       photo.jpg              when the patient has one
//       pruebas/<file>         attached tests: scans, x-rays, PDFs
//       facturas/<…>.html      each invoice the patient already has
//     caja/<yyyy-mm>.html      the cash ledger, one page per month
//     ledger.json              its rows: payments by method, debt, bono use
//
// The raw pages are kept beside the parsed JSON so a mapping mistake found
// during the import can be fixed by re-parsing (--reparse), without another
// pass over the clinic's server. A finished patient is skipped on a re-run,
// so an interrupted export resumes where it stopped.
//
// Options:
//   --out <dir>        output directory
//   --only <id,id>     just these patient ids (for trying it out)
//   --limit <n>        just the first n patients
//   --concurrency <n>  patients in flight at once (default 3)
//   --no-techniques    skip the per-visit adjusted segments (one request per
//                      visit, so most of the run time)
//   --no-ledger        skip the cash ledger (Caja), month by month
//   --ledger-only      just the ledger, using the patients already exported
//   --force            re-download patients already exported
//   --reparse          rebuild patient.json from the saved pages, no network
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const baseArg = args.find((a, i) => /^https?:\/\//.test(a) && !args[i - 1]?.startsWith('--'))
if (!baseArg) {
  console.error('usage: node scripts/quirocitas-export.mjs <https://quirocitas-<clinic>.es/chiro> [--out dir] [--only ids] [--limit n] [--no-techniques] [--force] [--reparse]')
  process.exit(1)
}
const BASE = baseArg.replace(/\/+$/, '')
const OUT = option('out') ?? join(homedir(), '.quiroflow', 'quirocitas', new URL(BASE).host)
const ONLY = option('only')?.split(',').map((s) => s.trim())
const LIMIT = option('limit') ? Number(option('limit')) : undefined
const CONCURRENCY = Number(option('concurrency') ?? 3)
const TECHNIQUES = !flag('no-techniques')
const FORCE = flag('force')
const REPARSE = flag('reparse')
const LEDGER = !flag('no-ledger') && !REPARSE
const LEDGER_ONLY = flag('ledger-only')

// --- HTML, without a DOM -------------------------------------------------
// The pages are a 2010s PHP app with consistent, double-quoted markup, so a
// handful of targeted patterns is enough and keeps this free of dependencies.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', egrave: 'è', ograve: 'ò', uuml: 'ü', middot: '·' }
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&(\w+);/g, (m, n) => NAMED[n] ?? m)
const text = (html) => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim()

const attrs = (tag) => {
  const out = {}
  for (const m of tag.matchAll(/([\w:[\]-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    if (m.index === 0) continue // the tag name itself
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

// Every named control, as the browser would submit or show it. Checkboxes
// and radios become booleans keyed by name+value so the unchecked ones are
// still visible (a cleared consent is information too).
function controls(html) {
  const fields = {}
  for (const [tag] of html.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(tag)
    if (!a.name || ['submit', 'button', 'image', 'file'].includes(a.type)) continue
    if (a.type === 'checkbox') fields[a.name] = 'checked' in a
    else if (a.type === 'radio') { if ('checked' in a) fields[a.name] = a.value ?? true; else fields[a.name] ??= null }
    else fields[a.name] = a.value ?? ''
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const a = attrs(`<textarea ${m[1]}>`)
    if (a.name) fields[a.name] = decode(m[2]).replace(/\r\n/g, '\n').trim()
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const a = attrs(`<select ${m[1]}>`)
    if (!a.name) continue
    const options = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<option\b|$)/gi)].map((o) => ({ ...attrs(`<option ${o[1]}>`), label: text(o[2]) }))
    const chosen = options.find((o) => 'selected' in o) ?? options[0]
    fields[a.name] = chosen ? { value: chosen.value ?? chosen.label, label: chosen.label } : null
  }
  return fields
}

// Innermost tables (no table inside them), as header + rows of cell text,
// with each row's hidden inputs alongside -- that is where the ids live.
function tables(html) {
  const out = []
  for (const m of html.matchAll(/<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table>/gi)) {
    const rows = [...m[1].matchAll(/<tr\b([^>]*)>([\s\S]*?)(?=<tr\b|$)/gi)].map((r) => ({
      class: attrs(`<tr ${r[1]}>`).class,
      cells: [...r[2].matchAll(/<t([dh])\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)].map((c) => text(c[2])),
      inputs: controls(r[2]),
    })).filter((r) => r.cells.length)
    if (rows.length < 2) continue
    out.push({ header: rows[0].cells, rows: rows.slice(1) })
  }
  return out
}
const tableByHeader = (all, first) => all.find((t) => t.header[0] === first || t.header.join('|').startsWith(first))

// Section of a page between one element id and the next, for pages whose
// tabs are sibling divs in one form.
function section(html, id, nextIds) {
  const start = html.indexOf(`id="${id}"`)
  if (start < 0) return ''
  const ends = nextIds.map((n) => html.indexOf(`id="${n}"`, start)).filter((i) => i > start)
  return html.slice(start, ends.length ? Math.min(...ends) : html.indexOf('</form>', start))
}

// --- HTTP -----------------------------------------------------------------

let cookie = process.env.QUIROCITAS_COOKIE ?? ''
const absorb = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';')
    const name = pair.split('=')[0]
    cookie = [...cookie.split('; ').filter((p) => p && !p.startsWith(`${name}=`)), pair].join('; ')
  }
}

async function request(path, { form, binary, attempts = 4 } = {}) {
  const url = /^https?:/.test(path) ? path : `${BASE}/${path.replace(/^\//, '')}`
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: form ? 'POST' : 'GET',
        body: form ? new URLSearchParams(form) : undefined,
        headers: { cookie, 'user-agent': 'QuiroFlow import' },
        redirect: 'manual',
      })
      absorb(res)
      if (res.status >= 300 && res.status < 400) {
        const to = new URL(res.headers.get('location'), url).href
        if (/login\.php/.test(to)) throw Object.assign(new Error('session expired (redirected to login)'), { fatal: true })
        return request(to, { binary, attempts })
      }
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`${res.status} on ${path}`)
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.text()
    } catch (e) {
      if (e.fatal || attempt >= attempts) throw e
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
  }
}

async function login() {
  if (cookie) return
  const { QUIROCITAS_USER: usuario, QUIROCITAS_PASSWORD: passwd } = process.env
  if (!usuario || !passwd) throw new Error('set QUIROCITAS_USER and QUIROCITAS_PASSWORD, or QUIROCITAS_COOKIE')
  await request('login.php') // the session cookie the login form expects
  await request('login.php', { form: { usuario, passwd, submit: 'Aceptar' } })
}

// --- the clinic's patient list ---------------------------------------------
// buscar.php embeds every patient as `r_[i] = {'id': '…', 'label': '…', 'tel': [...]}`
// for its search-as-you-type box.

function patientList(html) {
  const unq = (s) => s.replace(/\\(.)/g, '$1')
  return [...html.matchAll(/r_\[\d+\]\s*=\s*\{([\s\S]*?)\};/g)].map(([, body]) => {
    const id = body.match(/'id':\s*'((?:\\.|[^'])*)'/)?.[1]
    const label = body.match(/'label':\s*'((?:\\.|[^'])*)'/)?.[1]
    const tel = [...(body.match(/'tel':\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'((?:\\.|[^'])*)'/g)].map((m) => unq(m[1])).filter(Boolean)
    return { id: unq(id ?? ''), name: decode(unq(label ?? '')), phones: tel }
  }).filter((p) => p.id)
}

// --- one patient --------------------------------------------------------------

// The record page. buscar.php with operacio=editar renders the same ficha
// that ficha.php does from an appointment, but by patient id -- so it also
// works for patients who never had an appointment -- and, because nombre is
// set, the search's appointment list comes back in the same page.
const fetchFicha = (p) => request('buscar.php', { form: { telefono: '', operacio: 'editar', nombre: p.name, idllistanoms: p.id, numficha: '' } })

// Drops the 160 KB patient list buscar.php repeats on every page.
const stripPatientList = (html) => html.replace(/<script\b[^>]*>(?:(?!<\/script>)[\s\S]){100000,}?<\/script>/gi, '<script>/* patient list removed */</script>')

function parseFicha(html) {
  const form = html.split(/<form\b/i).find((f) => f.includes('name="id_paciente"')) ?? ''
  const all = tables(html)
  const fields = controls(form)
  const plans = Object.keys(fields).filter((k) => /^id_plan\[\d+\]$/.test(k)).map((k) => {
    const i = k.match(/\d+/)[0]
    return {
      id: fields[k],
      times: fields[`veces[${i}]`],
      per: fields[`por[${i}]`],
      during: fields[`durante[${i}]`],
      weekdays: [1, 2, 3, 4, 5].filter((d) => fields[`dias${d}[${i}]`]),
    }
  }).filter((p) => p.id)
  const photo = [...form.matchAll(/<img\b[^>]*>/gi)].map(([t]) => attrs(t).src).find((s) => /\/photo\.\w+/.test(s ?? ''))
  return {
    fields,
    plans,
    photo: photo?.replace(/\s.*$/, '').replace(/\?.*$/, ''),
    // The search's list: one row per appointment with its id (buscita_N).
    // Its first row is a "----------" placeholder with id -1.
    appointments: (tableByHeader(all, 'Dia')?.rows.map((r) => ({ date: r.cells[1], time: r.cells[2], type: r.cells[3], chiro: r.cells[4], status: r.class, id: Object.entries(r.inputs).find(([k]) => k.startsWith('buscita_'))?.[1] })) ?? []).filter((a) => a.id && a.id !== '-1'),
    // The ficha's own list: adds price, bono and reason/invoice per visit.
    visitsTable: tableByHeader(all, 'Núm.'),
    bonos: tableByHeader(all, 'Bono/Artículo') ?? all.find((t) => t.header.includes('Bono/Artículo')),
    beneficiaries: all.find((t) => t.header[0] === 'Beneficiarios'),
    debt: all.find((t) => t.header.join('|') === 'Importe|Pagado|Aplazado|Debe'),
    // Invoices that exist: a link with the invoice number as its text, from a
    // visit (idcita) or a bono payment (idpagobono). Every other visit has the
    // same link with no text -- that one would CREATE an invoice, so it is
    // never followed.
    invoiceLinks: [...new Map([...html.matchAll(/<a href="(factura\.php\?[^"]*)"[^>]*>([^<]+)<\/a>/gi)]
      .filter((m) => text(m[2]))
      .map((m) => { const href = decode(m[1]); return [href, { href, number: text(m[2]), citaId: href.match(/idcita=(\d+)/)?.[1] ?? null, bonoPaymentId: href.match(/idpagobono=(\d+)/)?.[1] ?? null }] })).values()],
    // Whatever else the page lays out as a table, unmapped. Not the "N pagos
    // de X euros" one: that is the new-bono dialog's instalment picker.
    otherTables: all.filter((t) => !/^(Dia|Núm\.|Teléfono|Beneficiarios|Importe)$/.test(t.header[0] ?? '') && !t.header.includes('Bono/Artículo') && !/pagos? ?s? de .* euros/.test(t.header.join(' '))),
  }
}

// factura.php only shows an invoice; saving goes to guardarfac.php, which is
// never called. The fields carry a per-invoice suffix (numfac1, …).
function parseInvoice(html) {
  const form = html.split(/<form\b/i).find((f) => f.includes('name="numfac')) ?? ''
  const f = controls(form)
  const get = (n) => { const k = Object.keys(f).find((x) => x.replace(/\d+$/, '') === n); return k ? f[k] : undefined }
  const sel = (n) => { const v = get(n); return v && typeof v === 'object' ? v.value : v }
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
    vat: sel('tipoiva'),
    irpf: sel('tipoirpf'),
    total: get('importe'),
    chiroId: get('quiro'),
    bonoPaymentId: get('idpagobono') || null,
    citaId: get('idcita') || null,
  }
}

function parseHistorial(html) {
  const tabs = ['historial', 'pruebas', 'biomecanico', 'anamnesis']
  const part = Object.fromEntries(tabs.map((t, i) => [t, section(html, t, tabs.slice(i + 1))]))

  // Visits: one row each -- number, date, type, the note, and the cita id
  // tecnicascita.ajax.php keys the adjusted segments by.
  const visits = []
  for (const m of part.historial.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?name="notas_\d+"[\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)(?=<td\b|$)/gi)].map((c) => c[1])
    const f = controls(m[1])
    const n = Object.keys(f).find((k) => k.startsWith('notas_'))
    visits.push({ number: text(cells[0] ?? ''), date: text(cells[1] ?? ''), type: text(cells[2] ?? ''), notes: f[n], citaId: f[n.replace('notas_', 'idcita_')] })
  }

  // The segment names, in index order, from the checkbox column beside them.
  const segments = []
  for (const m of part.historial.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?name="tiz\[(\d+)\]"[\s\S]*?)<\/tr>/gi)) segments[Number(m[2])] = text(m[1])

  const historialFields = controls(part.historial)
  const tests = [...part.pruebas.matchAll(/<div class="thumb">([\s\S]*?)(?=<div class="thumb">|$)/gi)].map(([, t]) => {
    const f = controls(t)
    const src = [...t.matchAll(/(?:src|href)="([^"]*\/pruebas\/[^"]+)"/gi)].map((m) => decode(m[1]).replace(/\?.*$/, ''))[0]
    const desc = text(t.match(/<div class="thudesc">([\s\S]*?)<\/div>/i)?.[1] ?? '')
    const k = (p) => Object.entries(f).find(([n]) => n.startsWith(p))?.[1]
    return { id: k('idprueba_'), description: k('descprueba_') || desc.split('|').slice(0, -1).join('|').trim(), category: k('categoria_'), src, file: src ? decodeURIComponent(basename(src)) : desc.split('|').pop().trim() }
  })

  // Biomecánico: left/right per segment, plus its free-text assessment.
  const bio = controls(part.biomecanico)
  const bioSegments = []
  for (const m of part.biomecanico.matchAll(/<tr\b[^>]*>((?:(?!<tr\b)[\s\S])*?name="iz\[(\d+)\]"[\s\S]*?)<\/tr>/gi)) {
    const i = Number(m[2])
    bioSegments.push({ segment: text(m[1]), left: !!bio[`iz[${i}]`], right: !!bio[`de[${i}]`] })
  }
  const bioText = Object.fromEntries(Object.entries(bio).filter(([k, v]) => !/^(iz|de)\[/.test(k) && typeof v === 'string' && v))

  return {
    generalNotes: historialFields.notas ?? '',
    visits,
    segments,
    tests,
    biomechanics: { segments: bioSegments.filter((s) => s.left || s.right), fields: bioText },
    anamnesis: Object.fromEntries(Object.entries(controls(part.anamnesis)).filter(([, v]) => v !== '' && v !== null && v !== false)),
  }
}

// Many patients "have" a photo that is a stored 643-byte near-white JPEG --
// an empty capture, the same bytes for each of them. No real photo is that
// small.
const BLANK_PHOTO_BYTES = 1024

// The page names a file in UTF-8. Should a server have stored an accented
// name in another form, try the spellings a PHP upload could have left. (At
// the first clinic the one accented file 404s in Quirocitas itself too: it is gone,
// and is reported as a problem rather than guessed at.)
function fileUrls(src) {
  const segments = src.split('/')
  const name = segments.pop()
  const dir = segments.map(encodeURIComponent).join('/')
  const pct = (bytes) => [...bytes].map((b) => /[A-Za-z0-9._~-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('')
  const spellings = [encodeURIComponent(name), encodeURIComponent(name.normalize('NFD'))]
  if ([...name].every((c) => c.charCodeAt(0) < 256)) spellings.push(pct(Buffer.from(name, 'latin1')))
  return [...new Set(spellings)].map((s) => `${dir}/${s}`)
}

const exists = (p) => access(p).then(() => true, () => false)
// Characters no file name may hold, control characters included.
const safeName = (s) => [...s].map((c) => (c.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(c) ? '_' : c)).join('').slice(0, 180) || 'file'

async function exportPatient(p, summary) {
  const dir = join(OUT, 'patients', p.id)
  if (!REPARSE && !FORCE && await exists(join(dir, 'patient.json'))) { summary.skipped++; return }
  await mkdir(join(dir, 'pruebas'), { recursive: true })
  const problems = []

  let fichaHtml, historialHtml
  if (REPARSE) {
    fichaHtml = await readFile(join(dir, 'ficha.html'), 'utf8').catch(() => null)
    historialHtml = await readFile(join(dir, 'historial.html'), 'utf8').catch(() => null)
  } else {
    fichaHtml = await fetchFicha(p).then((h) => h && stripPatientList(h))
    historialHtml = await request(`historial.php?idpaci=${encodeURIComponent(p.id)}`)
    if (fichaHtml) await writeFile(join(dir, 'ficha.html'), fichaHtml)
    if (historialHtml) await writeFile(join(dir, 'historial.html'), historialHtml)
  }
  if (!fichaHtml?.includes('name="id_paciente"')) problems.push('ficha did not load')
  const ficha = fichaHtml ? parseFicha(fichaHtml) : null
  if (ficha && ficha.fields.id_paciente !== p.id) problems.push(`ficha is for patient ${ficha.fields.id_paciente}, expected ${p.id}`)
  const history = historialHtml ? parseHistorial(historialHtml) : null
  if (!history) problems.push('historial did not load')

  // Keep what an earlier run fetched when only re-parsing.
  const previous = REPARSE ? JSON.parse(await readFile(join(dir, 'patient.json'), 'utf8').catch(() => '{}')) : {}

  if (history && TECHNIQUES && !REPARSE) {
    for (const v of history.visits) {
      if (!v.citaId) continue
      const raw = await request('tecnicascita.ajax.php', { form: { idcita: v.citaId } }).catch((e) => { problems.push(`techniques for cita ${v.citaId}: ${e.message}`); return null })
      if (!raw) continue
      try {
        const j = JSON.parse(raw)
        const side = (o) => Object.entries(o ?? {}).filter(([, t]) => typeof t === 'string' ? t.trim() : t?.length).map(([i, t]) => ({ segment: history.segments[Number(i)] ?? `#${i}`, technique: typeof t === 'string' ? t.trim() : t }))
        const left = side(j.I), right = side(j.D)
        if (left.length || right.length) v.techniques = { left, right, raw: j }
      } catch { problems.push(`techniques for cita ${v.citaId}: not JSON`) }
    }
  } else if (history && REPARSE) {
    const byCita = Object.fromEntries((previous.history?.visits ?? []).filter((v) => v.techniques).map((v) => [v.citaId, v.techniques]))
    for (const v of history.visits) if (byCita[v.citaId]) v.techniques = byCita[v.citaId]
  }

  const invoices = []
  for (const link of ficha?.invoiceLinks ?? []) {
    const file = join(dir, 'facturas', `${safeName(link.href.replace(/^factura\.php\?/, ''))}.html`)
    let html = await readFile(file, 'utf8').catch(() => null)
    if (!html && !REPARSE) {
      html = await request(link.href).catch((e) => { problems.push(`invoice ${link.number}: ${e.message}`); return null })
      if (html) { await mkdir(join(dir, 'facturas'), { recursive: true }); await writeFile(file, html) }
    }
    if (!html) continue
    const inv = parseInvoice(html)
    if (inv.number !== link.number) problems.push(`invoice link says ${link.number}, page says ${inv.number}`)
    invoices.push({ ...link, ...inv, citaId: link.citaId ?? inv.citaId, bonoPaymentId: link.bonoPaymentId ?? inv.bonoPaymentId })
  }

  const files = []
  if (!REPARSE) {
    if (ficha?.photo) {
      const img = await request(ficha.photo, { binary: true }).catch((e) => { problems.push(`photo: ${e.message}`); return null })
      if (img?.length > BLANK_PHOTO_BYTES) { await writeFile(join(dir, `photo${ficha.photo.match(/\.\w+$/)[0]}`), img); files.push(`photo${ficha.photo.match(/\.\w+$/)[0]}`) }
    }
    for (const t of history?.tests ?? []) {
      if (!t.src) { problems.push(`test "${t.file}" has no link`); continue }
      const name = safeName(t.file)
      let body = null
      for (const url of fileUrls(t.src)) {
        body = await request(url, { binary: true }).catch((e) => { problems.push(`test ${name}: ${e.message}`); return null })
        if (body) break
      }
      if (!body) { problems.push(`test ${name}: not found`); continue }
      await writeFile(join(dir, 'pruebas', name), body)
      t.saved = `pruebas/${name}`
    }
  } else {
    files.push(...(previous.files ?? []))
    const saved = new Set(await readdir(join(dir, 'pruebas')).catch(() => []))
    for (const t of history?.tests ?? []) if (saved.has(safeName(t.file))) t.saved = `pruebas/${safeName(t.file)}`
  }

  const record = { source: { base: BASE, exportedAt: REPARSE ? previous.source?.exportedAt : new Date().toISOString() }, patient: p, ficha, history, invoices, files, problems }
  await writeFile(join(dir, 'patient.json'), JSON.stringify(record, null, 2))
  summary.done++
  summary.tests += history?.tests.filter((t) => t.saved).length ?? 0
  summary.invoices += invoices.length
  summary.visits += history?.visits.length ?? 0
  summary.withTechniques += history?.visits.filter((v) => v.techniques).length ?? 0
  if (problems.length) summary.problems[p.id] = problems
}

// --- the cash ledger (Caja) ---------------------------------------------------
// diario.php is where payments live: one row per patient per day, the amount
// by method, debt, whether it used a bono, and the visit's value -- with the
// cita id (visit payments) or the bono payment id (bono sales) beside it.
// Its "Mes entero" view shows a whole month for every chiropractor at once.
//
// It is a stateful form: the date is held in the session and moves with the
// ◄ button. So each step submits the page's own form exactly as a click on ◄
// would -- every field with the value the server just rendered, no Aceptar,
// no Facturar -- which is what the clinic's staff do every day.

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const amount = (s) => { const t = (s ?? '').replace(/\./g, '').replace(',', '.').trim(); return t && !Number.isNaN(Number(t)) ? Number(t) : null }

// The body a browser would send for the page's diario.php form, minus every
// button (the caller adds the one being "clicked").
function formBody(html) {
  const form = html.split(/<form\b/i).find((f) => /action="diario\.php"/i.test(f.slice(0, 300))) ?? ''
  const body = []
  for (const [tag] of form.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(tag)
    if (!a.name || ['submit', 'button', 'image', 'file', 'reset'].includes(a.type)) continue
    if ((a.type === 'checkbox' || a.type === 'radio') && !('checked' in a)) continue
    body.push([a.name, a.value ?? (a.type === 'checkbox' || a.type === 'radio' ? 'on' : '')])
  }
  for (const m of form.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) { const a = attrs(`<t ${m[1]}>`); if (a.name) body.push([a.name, decode(m[2])]) }
  for (const m of form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const a = attrs(`<s ${m[1]}>`)
    const options = [...m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<option\b|$)/gi)].map((o) => ({ ...attrs(`<o ${o[1]}>`), label: text(o[2]) }))
    const chosen = options.find((o) => 'selected' in o) ?? options[0]
    if (a.name && chosen) body.push([a.name, chosen.value ?? chosen.label])
  }
  return body
}
const submit = (html, extra) => request('diario.php', { form: [...formBody(html).filter(([k]) => !(k in extra)), ...Object.entries(extra)] })

function parseCajaMonth(html) {
  const m = html.match(/Mes de (\w+) de (\d{4})/i)
  const month = m ? `${m[2]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}` : null
  const table = tables(html).find((t) => t.rows.some((r) => r.cells.includes('Efectivo')) || t.header.includes('Efectivo'))
  const rows = (table?.rows ?? []).filter((r) => /^\d{2}-\d{2}-\d{4}$/.test(r.cells[1] ?? '')).map((r) => {
    const id = (p) => { const v = Object.entries(r.inputs).find(([k]) => k.replace(/\d+$/, '') === p)?.[1]; return v && v !== '0' && v !== '-1' ? String(v) : null }
    return {
      date: r.cells[1], name: r.cells[2], note: r.cells[3], isNew: !!r.cells[4], usedBono: r.cells[5] === 'B',
      cash: amount(r.cells[6]), card: amount(r.cells[7]), transfer: amount(r.cells[8]), debt: amount(r.cells[9]),
      invoiced: Object.entries(r.inputs).some(([k, v]) => k.startsWith('factura') && v === true),
      value: amount(r.cells[11]),
      rowId: id('id'), citaId: id('cita'), bonoPaymentId: id('pagobono'),
    }
  })
  return { month, rows }
}

async function exportLedger(earliest) {
  const dir = join(OUT, 'caja')
  await mkdir(dir, { recursive: true })
  // As the page does it: choosing "-- Todos --" submits the form on its own,
  // then "Mes entero" switches to the month.
  const day = await submit(await request('diario.php'), { quiro: '-1' })
  let page = await submit(day, { franja: 'Mes entero' })
  const ledger = []
  let last = null
  for (;;) {
    const { month, rows } = parseCajaMonth(page ?? '')
    if (!month || month === last) throw new Error(`caja: could not move past ${last ?? 'the first month'}`)
    if (controls(page).quiro?.value !== '-1') throw new Error(`caja ${month}: not showing every chiropractor`)
    await writeFile(join(dir, `${month}.html`), page)
    ledger.push(...rows.map((r) => ({ month, ...r })))
    process.stdout.write(`\rcaja ${month}: ${rows.length} rows   `)
    last = month
    if (month <= earliest) break
    page = await submit(page, { previo: '◄' })
  }
  await writeFile(join(OUT, 'ledger.json'), JSON.stringify(ledger, null, 2))
  return ledger
}

// --- run ----------------------------------------------------------------------

await mkdir(join(OUT, 'patients'), { recursive: true })
let patients
if (REPARSE) {
  patients = JSON.parse(await readFile(join(OUT, 'patients.json'), 'utf8'))
} else {
  await login()
  const list = await request('buscar.php')
  patients = patientList(list ?? '')
  if (!patients.length) throw new Error('no patient list on buscar.php -- wrong credentials, or the session did not stick')
  await writeFile(join(OUT, 'patients.json'), JSON.stringify(patients, null, 2))
}
if (ONLY) patients = patients.filter((p) => ONLY.includes(p.id))
if (LIMIT) patients = patients.slice(0, LIMIT)

console.log(`${patients.length} patients from ${BASE} -> ${OUT}${REPARSE ? ' (re-parsing saved pages)' : ''}`)
const summary = { base: BASE, startedAt: new Date().toISOString(), total: patients.length, done: 0, skipped: 0, visits: 0, withTechniques: 0, tests: 0, invoices: 0, failed: {}, problems: {} }
if (LEDGER_ONLY) patients = []
const queue = [...patients]
let n = 0
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let p; (p = queue.shift());) {
    try {
      await exportPatient(p, summary)
    } catch (e) {
      if (e.fatal) { queue.length = 0; summary.failed[p.id] = e.message; console.error(`\n${e.message} -- stopping; re-run to resume`); return }
      summary.failed[p.id] = e.message
    }
    if (++n % 25 === 0 || n === patients.length) process.stdout.write(`\r${n}/${patients.length}  (${Object.keys(summary.failed).length} failed)`)
  }
}))
if (!LEDGER_ONLY) {
  summary.finishedAt = new Date().toISOString()
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(`\n${summary.done} exported, ${summary.skipped} already there, ${Object.keys(summary.failed).length} failed, ${Object.keys(summary.problems).length} with problems; ${summary.visits} visits (${summary.withTechniques} with segments), ${summary.tests} attached tests, ${summary.invoices} invoices`)
}

if (LEDGER) {
  // Back to the month of the oldest visit any patient has.
  let earliest = '9999-99'
  for (const id of await readdir(join(OUT, 'patients'))) {
    const j = JSON.parse(await readFile(join(OUT, 'patients', id, 'patient.json'), 'utf8').catch(() => '{}'))
    for (const r of j.ficha?.visitsTable?.rows ?? []) {
      const d = r.cells[2]?.match(/^(\d{2})-(\d{2})-(\d{4})$/)
      if (d && `${d[3]}-${d[2]}` < earliest) earliest = `${d[3]}-${d[2]}`
    }
  }
  const ledger = await exportLedger(earliest)
  console.log(`\ncash ledger: ${ledger.length} rows back to ${earliest} -> ${join(OUT, 'ledger.json')}`)
}
console.log(`summary: ${join(OUT, 'summary.json')}`)
