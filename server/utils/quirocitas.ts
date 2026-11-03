// Reading a clinic's records out of Quirocitas, the PHP practice manager some
// clinics move to QuiroFlow from. It has no API, and its own CSV export
// carries only demographics: the clinical history, appointments, bonos,
// payments, invoices and attached files are reachable only through the pages
// a logged-in member of staff sees. So this reads those pages, the way a
// browser would, and parses them.
//
// What it will and will not do, because some of those pages write:
//
//   * GET pages that only show something: buscar.php (the patient list),
//     historial.php, factura.php for an invoice that already has a number,
//     a patient's photo and attached files.
//   * POST buscar.php with operacio=editar, which renders a patient's record
//     by patient id, and tecnicascita.ajax.php, which returns the segments
//     adjusted at one visit. Both read.
//   * Walk diario.php (the cash ledger) month by month by submitting the
//     page's own form exactly as a click on ◄ does -- every field with the
//     value the server just rendered, never Aceptar, never Facturar.
//   * NEVER articulaciones.php (it records biomechanics marks), buscar.php's
//     borrar/eliminar, guardarfac.php, or factura.php for a visit with no
//     invoice number: opening that one is how an invoice gets created.
//
// The parsing is in utils/quirocitasPages.ts. scripts/quirocitas-export.mjs
// is the same reader as a command-line tool, for keeping a full offline copy.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { getAccountSecret, setAccountSecret } from '~/server/utils/accountSecrets'
import {
  parseQuirocitasBonoTypes,
  parseQuirocitasCajaMonth,
  parseQuirocitasFicha,
  parseQuirocitasHistory,
  parseQuirocitasInvoice,
  parseQuirocitasPatientList,
  quirocitasCajaFormBody,
  quirocitasSafeDecode,
  type QuirocitasInvoice,
} from '~/utils/quirocitasPages'

// --- the session ---------------------------------------------------------------

export interface QuirocitasLogin { baseUrl: string; username: string; password: string }

export class QuirocitasError extends Error {
  constructor(message: string, readonly statusCode = 502) { super(message) }
}

/**
 * A logged-in session against one clinic's Quirocitas.
 *
 * The session cookie is kept in account_secrets so consecutive calls -- the
 * importer makes thousands -- reuse one login, and a call that finds it
 * expired logs in again once. The ledger depends on that: Quirocitas holds the
 * month being shown in the session.
 */
export class QuirocitasClient {
  private cookie = ''
  constructor(
    private readonly login: QuirocitasLogin,
    private readonly store?: { load(): Promise<string | null>; save(cookie: string): Promise<void> },
  ) {}

  private absorb(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0]!
      const name = pair.split('=')[0]
      this.cookie = [...this.cookie.split('; ').filter((p) => p && !p.startsWith(`${name}=`)), pair].join('; ')
    }
  }

  private url(path: string) {
    return /^https?:/.test(path) ? path : `${this.login.baseUrl}/${path.replace(/^\//, '')}`
  }

  private async raw(path: string, init: { form?: [string, string][] | Record<string, string>; binary?: boolean } = {}, attempt = 1): Promise<{ status: number; location: string | null; body: Buffer | string | null; contentType: string | null }> {
    try {
      const res = await fetch(this.url(path), {
        method: init.form ? 'POST' : 'GET',
        body: init.form ? new URLSearchParams(init.form as Record<string, string>) : undefined,
        headers: { cookie: this.cookie, 'user-agent': 'QuiroFlow import' },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      })
      this.absorb(res)
      if (res.status >= 300 && res.status < 400) return { status: res.status, location: new URL(res.headers.get('location') ?? '', this.url(path)).href, body: null, contentType: null }
      if (res.status >= 500 && attempt < 3) return this.raw(path, init, attempt + 1)
      const body = res.status === 404 ? null : init.binary ? Buffer.from(await res.arrayBuffer()) : await res.text()
      return { status: res.status, location: null, body, contentType: res.headers.get('content-type') }
    } catch (e) {
      if (attempt < 3) return this.raw(path, init, attempt + 1)
      throw new QuirocitasError(`Quirocitas did not answer (${(e as Error).message})`)
    }
  }

  async signIn() {
    this.cookie = ''
    await this.raw('login.php')
    const res = await this.raw('login.php', { form: { usuario: this.login.username, passwd: this.login.password, submit: 'Aceptar' } })
    // A good login redirects into the app; a bad one renders the form again.
    const back = typeof res.body === 'string' && /name="passwd"/.test(res.body)
    if (back || /login\.php/.test(res.location ?? '')) throw new QuirocitasError('Quirocitas did not accept that username and password.', 400)
    await this.store?.save(this.cookie)
  }

  /** A page, following redirects, logging in again once if the session ran out. */
  async request(path: string, init: { form?: [string, string][] | Record<string, string>; binary?: boolean } = {}): Promise<{ body: Buffer | string | null; contentType: string | null }> {
    if (!this.cookie) this.cookie = (await this.store?.load()) ?? ''
    if (!this.cookie) await this.signIn()
    for (let relogged = false, hops = 0; hops < 5; hops++) {
      const res = await this.raw(path, init)
      if (res.location && /login\.php/.test(res.location)) {
        if (relogged) throw new QuirocitasError('Quirocitas keeps asking to sign in again.', 401)
        await this.signIn()
        relogged = true
        continue
      }
      if (res.location) { path = res.location; init = { binary: init.binary }; continue }
      if (res.status >= 400 && res.status !== 404) throw new QuirocitasError(`Quirocitas answered ${res.status} for ${path.split('?')[0]}`)
      return { body: res.body, contentType: res.contentType }
    }
    throw new QuirocitasError('Quirocitas redirected too many times.')
  }

  async page(path: string, form?: [string, string][] | Record<string, string>): Promise<string> {
    const { body } = await this.request(path, { form })
    return typeof body === 'string' ? body : ''
  }

  // --- reads ---

  async patientList() {
    const html = await this.page('buscar.php')
    const patients = parseQuirocitasPatientList(html)
    if (!patients.length) throw new QuirocitasError('Quirocitas showed no patient list. Check the address ends in /chiro and that this user can search patients.')
    return patients
  }

  /** A patient's record, clinical history and the invoices they already have. */
  async patient(id: string, name: string) {
    const fichaHtml = await this.page('buscar.php', { telefono: '', operacio: 'editar', nombre: name, idllistanoms: id, numficha: '' })
    const ficha = parseQuirocitasFicha(fichaHtml)
    if (!ficha || ficha.id !== id) throw new QuirocitasError(`Quirocitas did not show patient ${id}'s record.`)
    const history = parseQuirocitasHistory(await this.page(`historial.php?idpaci=${encodeURIComponent(id)}`))
    const invoices: (QuirocitasInvoice & { href: string })[] = []
    for (const link of ficha.invoiceLinks) {
      const inv = parseQuirocitasInvoice(await this.page(link.href))
      invoices.push({ ...inv, href: link.href, number: inv.number || link.number, citaId: link.citaId ?? inv.citaId, bonoPaymentId: link.bonoPaymentId ?? inv.bonoPaymentId })
    }
    return { ficha, history, invoices, bonoTypes: parseQuirocitasBonoTypes(fichaHtml) }
  }

  /** The segments adjusted at each visit, by cita id. Empty visits are left out. */
  async techniques(citaIds: string[], segments: string[]) {
    const out: Record<string, { left: { segment: string; technique: string }[]; right: { segment: string; technique: string }[] }> = {}
    for (const citaId of citaIds) {
      const raw = await this.page('tecnicascita.ajax.php', { idcita: citaId })
      let j: { I?: Record<string, unknown>; D?: Record<string, unknown> }
      try { j = JSON.parse(raw) } catch { continue }
      const side = (o: Record<string, unknown> | undefined) => Object.entries(o ?? {})
        .map(([i, t]) => ({ segment: segments[Number(i)] ?? `#${i}`, technique: typeof t === 'string' ? t.trim() : '' }))
        .filter((s) => s.technique)
      const left = side(j.I), right = side(j.D)
      if (left.length || right.length) out[citaId] = { left, right }
    }
    return out
  }

  /**
   * Months of the cash ledger, newest first, for every chiropractor.
   *
   * `cursor` is the form the previous call left the session on; null starts
   * from the current month.
   */
  async ledger(cursor: [string, string][] | null, months: number) {
    const submit = (html: string | [string, string][], extra: Record<string, string>) => {
      const body = typeof html === 'string' ? quirocitasCajaFormBody(html) : html
      return this.page('diario.php', [...body.filter(([k]) => !(k in extra)), ...Object.entries(extra)])
    }
    let page: string
    if (cursor) page = await submit(cursor, { previo: '◄' })
    else page = await submit(await submit(await this.page('diario.php'), { quiro: '-1' }), { franja: 'Mes entero' })
    const out: ReturnType<typeof parseQuirocitasCajaMonth>[] = []
    for (let i = 0; ; i++) {
      const month = parseQuirocitasCajaMonth(page)
      if (!month.month) throw new QuirocitasError('Quirocitas did not show a month of the cash ledger.')
      if (!month.everyChiro) throw new QuirocitasError(`The cash ledger for ${month.month} is not showing every chiropractor.`)
      out.push(month)
      if (i + 1 >= months) break
      page = await submit(page, { previo: '◄' })
    }
    return { months: out, cursor: quirocitasCajaFormBody(page) }
  }

  /** A photo or attached file's bytes. Some uploads stored an accented name in another form. */
  async file(src: string) {
    const segments = src.split('/')
    const name = quirocitasSafeDecode(segments.pop()!)
    const dir = segments.map(encodeURIComponent).join('/')
    const pct = (bytes: Buffer) => [...bytes].map((b) => /[A-Za-z0-9._~-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('')
    const spellings = [encodeURIComponent(name), encodeURIComponent(name.normalize('NFD'))]
    if ([...name].every((c) => c.charCodeAt(0) < 256)) spellings.push(pct(Buffer.from(name, 'latin1')))
    for (const s of new Set(spellings)) {
      const { body, contentType } = await this.request(`${dir}/${s}`, { binary: true })
      if (body && typeof body !== 'string' && body.length) return { bytes: body, contentType }
    }
    return null
  }
}

// --- the saved connection ----------------------------------------------------------

export async function quirocitasLogin(admin: SupabaseClient<Database>, accountId: string): Promise<QuirocitasLogin | null> {
  const [baseUrl, username, password] = await Promise.all([
    getAccountSecret(admin, accountId, 'quirocitas_base_url'),
    getAccountSecret(admin, accountId, 'quirocitas_username'),
    getAccountSecret(admin, accountId, 'quirocitas_password'),
  ])
  return baseUrl && username && password ? { baseUrl, username, password } : null
}

export function quirocitasClientFor(admin: SupabaseClient<Database>, accountId: string, login: QuirocitasLogin) {
  return new QuirocitasClient(login, {
    load: () => getAccountSecret(admin, accountId, 'quirocitas_session'),
    save: (cookie) => setAccountSecret(admin, accountId, 'quirocitas_session', cookie),
  })
}

/** https://quirocitas-<clinic>.es/chiro, however it was pasted. */
export function normaliseQuirocitasUrl(input: string): string | null {
  let u: URL
  try { u = new URL(input.trim()) } catch { return null }
  if (u.protocol !== 'https:') return null
  const path = u.pathname.replace(/\/[^/]*\.php$/i, '').replace(/\/+$/, '')
  return `${u.origin}${path || '/chiro'}`
}
