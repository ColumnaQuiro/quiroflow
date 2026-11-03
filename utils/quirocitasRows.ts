// What a read of Quirocitas becomes in QuiroFlow: pure functions from the
// parsed pages (utils/quirocitasPages.ts) to the rows each import step writes.
// Kept free of Supabase and of Vue so the mapping can be tested on its own,
// and so every step agrees on the same references.
//
// Every row is stamped with an external_reference starting "QC-", never a
// bare number: PracticeHub's references are bare numbers under the same
// unique index, and a clinic could hold both.
import { wallClockToUtc } from './clinicClock'
import type { QuirocitasBonoType, QuirocitasHistory, QuirocitasInvoice, QuirocitasLedgerRow, QuirocitasListPatient, QuirocitasPatient } from './quirocitasPages'

export interface QuirocitasTechniques { left: { segment: string; technique: string }[]; right: { segment: string; technique: string }[] }

/** One patient as the Read step stores it. */
export interface QuirocitasRecord {
  list: QuirocitasListPatient
  ficha: QuirocitasPatient
  history: QuirocitasHistory
  invoices: QuirocitasInvoice[]
  /** By cita id; only visits with something marked. */
  techniques: Record<string, QuirocitasTechniques>
}

export interface QuirocitasLedgerMonth {
  month: string
  rows: number
  /** What the page printed under the month, and what its rows add up to. */
  printed: { cash: number | null; card: number | null; transfer: number | null }
  summed: { cash: number; card: number; transfer: number }
}

export interface QuirocitasSnapshot {
  baseUrl: string
  readAt: string
  bonoTypes: QuirocitasBonoType[]
  patients: Record<string, QuirocitasRecord>
  /** Patients the list named whose record could not be read, with why. */
  failed: Record<string, string>
  ledger: QuirocitasLedgerRow[]
  ledgerMonths: QuirocitasLedgerMonth[]
}

export const qcPatientRef = (id: string) => `QC-${id}`

// --- small conversions -------------------------------------------------------------

/** "23-01-1958" -> "1958-01-23", or null for anything that is not a real date. */
export function quirocitasDate(ddmmyyyy: string): string | null {
  const m = ddmmyyyy.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso || m[3] === '0000' ? null : iso
}

export function quirocitasInstant(ddmmyyyy: string, hhmm: string, timeZone: string): string | null {
  const date = quirocitasDate(ddmmyyyy)
  if (!date) return null
  const time = /^\d{1,2}:\d{2}$/.test(hhmm.trim()) ? hhmm.trim() : '12:00'
  return new Date(wallClockToUtc(date, time, timeZone)).toISOString()
}

// Quirocitas takes any date: a birth date in the future or before 1900 is a typo.
function plausibleBirthDate(iso: string | null): string | null {
  if (!iso) return null
  return iso >= '1900-01-01' && iso <= new Date().toISOString().slice(0, 10) ? iso : null
}

const cents = (euros: number | null | undefined) => Math.round((euros ?? 0) * 100)
const clean = (s: string | null | undefined) => (s ?? '').trim()

/** Quirocitas keeps one "nombre": the first word is the first name, the rest the surname. */
export function splitQuirocitasName(full: string): { first_name: string; last_name: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { first_name: parts[0] ?? '', last_name: null }
  return { first_name: parts[0]!, last_name: parts.slice(1).join(' ') }
}

// Spanish numbers are written bare ("629422444", "93 123 45 67"); the few
// foreign ones carry their prefix. Stored the way the app's own phone field
// stores them: the country apart, the number without it.
const PREFIXES: [string, string][] = [['351', 'PT'], ['376', 'AD'], ['34', 'ES'], ['44', 'GB'], ['33', 'FR'], ['49', 'DE'], ['39', 'IT'], ['41', 'CH'], ['32', 'BE'], ['31', 'NL'], ['1', 'US']]
export function quirocitasPhone(raw: string): { country_code: string; number: string } {
  const compact = raw.replace(/[^\d+]/g, '').replace(/^00/, '+')
  if (compact.startsWith('+')) {
    for (const [prefix, country] of PREFIXES) if (compact.startsWith(`+${prefix}`)) return { country_code: country, number: compact.slice(prefix.length + 1) }
    return { country_code: 'ES', number: compact }
  }
  return { country_code: 'ES', number: compact }
}

// --- patients -------------------------------------------------------------------

export interface QuirocitasPatientRow {
  ref: string
  name: string
  fields: {
    first_name: string
    last_name: string | null
    email: string | null
    date_of_birth: string | null
    national_id: string | null
    address: string | null
    postal_code: string | null
    city: string | null
    occupation: string | null
    gender: string | null
    preferred_language: string
    referral_source: string | null
    notes: string | null
    tags: string[]
    marketing_channels: string[]
    reminder_channel: string
    confirmation_channel: string
  }
  /** The practitioner's name as Quirocitas has it; matched to the team by the importer. */
  practitioner: string
  phones: string[]
  /** The first day the record shows them at the clinic, for created_at. */
  firstSeen: string | null
}

export function quirocitasPatientRow(r: QuirocitasRecord): QuirocitasPatientRow {
  const f = r.ficha
  const { first_name, last_name } = splitQuirocitasName(f.name || r.list.name)
  // Catalan is the language of most of the first clinic's patients and is not
  // one QuiroFlow sends messages in; Spanish is the closest it has, and the
  // tag keeps who asked for Catalan findable.
  const tags = f.language === 'Català' ? ['Català'] : []
  const notes = [
    clean(f.notes),
    f.company ? `Facturar a: ${[f.company.name, f.company.nif, f.company.address, [f.company.postcode, f.company.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}` : '',
  ].filter(Boolean).join('\n\n')
  const dates = [...f.appointments.map((a) => quirocitasDate(a.date)), ...f.visits.map((v) => quirocitasDate(v.date))].filter((d): d is string => !!d).sort()
  // The same number is often on the record twice, spaced differently.
  const phones = [...new Map([f.preferredPhone, ...f.phones, ...r.list.phones].map((p) => clean(p)).filter(Boolean).map((p) => [p.replace(/\D/g, ''), p] as const)).values()]
  return {
    ref: qcPatientRef(f.id),
    name: f.name || r.list.name,
    fields: {
      first_name,
      last_name,
      email: clean(f.email) || null,
      date_of_birth: plausibleBirthDate(quirocitasDate(f.birthDate)),
      national_id: clean(f.nif).toUpperCase() || null,
      address: clean(f.address) || null,
      postal_code: clean(f.postcode) || null,
      city: clean(f.city) || null,
      occupation: clean(f.occupation) || null,
      gender: f.gender === 'femenino' ? 'female' : f.gender === 'masculino' ? 'male' : null,
      preferred_language: f.language === 'English' ? 'en' : 'es',
      referral_source: clean(f.referralSource) || null,
      notes: notes || null,
      tags,
      // Consent to marketing needs both the RGPD box and "No enviar mailings" unticked.
      marketing_channels: f.consentRgpd && !f.noMailings ? ['email'] : [],
      // "No enviar mensajes" turns off what QuiroFlow would send on its own,
      // without the red "do not contact" flag: staff still call these people.
      // Always both keys, at the columns' own default where Quirocitas says
      // nothing: a bulk insert sends NULL for a key only some rows carry.
      reminder_channel: f.messages === 'none' ? 'none' : f.messages === 'email' ? 'email' : 'sms',
      confirmation_channel: f.messages === 'none' ? 'none' : 'sms',
    },
    // "Cualquiera" is Quirocitas' "any of them", not a person.
    practitioner: /^cualquiera$/i.test(clean(f.chiro)) ? '' : clean(f.chiro),
    phones,
    firstSeen: dates[0] ? `${dates[0]}T00:00:00Z` : null,
  }
}

// --- appointments, visit notes and calls ---------------------------------------------

/** "Charla" is how Quirocitas books a phone call to a patient: a reminder, not a visit. */
export const QUIROCITAS_CALL_TYPE = 'Charla'

export interface QuirocitasAppointmentRow {
  ref: string
  patientRef: string
  citaId: string | null
  type: string | null
  practitioner: string
  startsAt: string
  status: 'booked' | 'completed' | 'cancelled' | 'no_show'
  rescheduled: boolean
  note: string | null
}

export interface QuirocitasCallRow { ref: string; patientRef: string; at: string; answered: boolean; note: string }

const STATUS: Record<string, QuirocitasAppointmentRow['status']> = { pasado: 'completed', ausencia: 'no_show', futuro: 'booked', presente: 'booked', cancelacion: 'cancelled', anulacion: 'cancelled', cambio: 'cancelled' }

/**
 * Appointments and calls for one patient.
 *
 * The search list carries each appointment's id and real type, for every one
 * that took place, was missed, or is still to come. Cancelled, annulled and
 * moved ones are missing from it and appear only in the record's own visit
 * list, where the type column holds the status instead -- so those come in
 * as cancelled with no type, keyed by when they were.
 */
export function quirocitasAppointmentRows(r: QuirocitasRecord, timeZone: string) {
  const patientRef = qcPatientRef(r.ficha.id)
  const reasonAt = new Map<string, string>()
  for (const v of r.ficha.visits) if (clean(v.reason)) reasonAt.set(`${v.date} ${v.time}`, clean(v.reason))

  const appointments: QuirocitasAppointmentRow[] = []
  const calls: QuirocitasCallRow[] = []
  for (const a of r.ficha.appointments) {
    const at = quirocitasInstant(a.date, a.time, timeZone)
    if (!at) continue
    const reason = reasonAt.get(`${a.date} ${a.time}`) ?? ''
    if (a.type === QUIROCITAS_CALL_TYPE) {
      const answered = a.status !== 'ausencia'
      calls.push({ ref: `QC-call-${a.id}`, patientRef, at, answered, note: [a.status === 'futuro' || a.status === 'presente' ? 'Llamada prevista' : 'Llamada', reason].filter(Boolean).join(' · ') })
      continue
    }
    appointments.push({ ref: `QC-${a.id}`, patientRef, citaId: a.id, type: clean(a.type) || null, practitioner: clean(a.chiro), startsAt: at, status: STATUS[a.status] ?? 'completed', rescheduled: false, note: reason || null })
  }
  const seen = new Map<string, number>()
  for (const v of r.ficha.visits) {
    if (!['cancelacion', 'anulacion', 'cambio'].includes(v.status)) continue
    const at = quirocitasInstant(v.date, v.time, timeZone)
    if (!at) continue
    const key = `${quirocitasDate(v.date)!.replace(/-/g, '')}${v.time.replace(':', '')}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    appointments.push({ ref: `QC-${r.ficha.id}-${key}-${n}`, patientRef, citaId: null, type: null, practitioner: clean(v.chiro), startsAt: at, status: 'cancelled', rescheduled: v.status === 'cambio', note: clean(v.reason) || null })
  }
  return { appointments, calls }
}

export function quirocitasTechniquesText(t: QuirocitasTechniques | undefined): string {
  if (!t) return ''
  const side = (list: QuirocitasTechniques['left'], label: string) => list.length ? `${label}: ${list.map((s) => `${s.segment} (${s.technique})`).join(', ')}` : ''
  return ['Segmentos ajustados', side(t.left, 'izquierda'), side(t.right, 'derecha')].filter(Boolean).join(' · ').replace('ajustados · ', 'ajustados — ')
}

export interface QuirocitasVisitNote { citaId: string; patientRef: string; appointmentRef: string; at: string | null; body: string }

/** The note written at each visit, with the segments adjusted at it. */
export function quirocitasVisitNotes(r: QuirocitasRecord, timeZone: string): QuirocitasVisitNote[] {
  const timeOf = new Map(r.ficha.appointments.map((a) => [a.id, a]))
  return r.history.visits.map((v) => {
    const body = [clean(v.notes), quirocitasTechniquesText(r.techniques[v.citaId])].filter(Boolean).join('\n\n')
    const a = timeOf.get(v.citaId)
    return { citaId: v.citaId, patientRef: qcPatientRef(r.ficha.id), appointmentRef: `QC-${v.citaId}`, at: quirocitasInstant(v.date, a?.time ?? '12:00', timeZone), body }
  }).filter((n) => n.body && n.citaId)
}

export interface QuirocitasLogRow { ref: string; patientRef: string; at: string | null; note: string }

/** What the record holds that is not tied to a visit: the history's summary, plans, anamnesis. */
export function quirocitasClinicalLogs(r: QuirocitasRecord): QuirocitasLogRow[] {
  const patientRef = qcPatientRef(r.ficha.id)
  const out: QuirocitasLogRow[] = []
  // None of these has a date in Quirocitas. Dated to the first visit, they
  // open the patient's history, rather than topping it as "today".
  const at = quirocitasPatientRow(r).firstSeen
  if (clean(r.history.generalNotes)) out.push({ ref: `QC-history-${r.ficha.id}`, patientRef, at, note: `[Historial Quirocitas]\n${clean(r.history.generalNotes)}` })
  if (r.ficha.plans.length) {
    out.push({ ref: `QC-plan-${r.ficha.id}`, patientRef, at, note: `[Plan de tratamiento Quirocitas]\n${r.ficha.plans.map((p) => `${p.times} ${p.per} durante ${p.during}`).join('\n')}` })
  }
  const bio = r.history.biomechanics
  const anam = Object.entries(r.history.anamnesis)
  if (bio.segments.length || Object.keys(bio.fields).length || anam.length) {
    const lines = [
      ...bio.segments.map((s) => `${s.segment}: ${[s.left && 'izquierda', s.right && 'derecha'].filter(Boolean).join(' y ')}`),
      ...Object.entries(bio.fields).map(([k, v]) => `${k}: ${v}`),
      ...anam.map(([k, v]) => `${k}: ${v}`),
    ]
    out.push({ ref: `QC-anamnesis-${r.ficha.id}`, patientRef, at, note: `[Anamnesis y biomecánica Quirocitas]\n${lines.join('\n')}` })
  }
  return out
}

// --- bonos ---------------------------------------------------------------------------

export interface QuirocitasBonoRow {
  ref: string
  bonoId: string
  ownerRef: string
  sharedWithRefs: string[]
  name: string
  sessionsTotal: number
  sessionsUsed: number
  priceCents: number
  owedCents: number
  purchasedAt: string
  isClosed: boolean
  /** Whether the purchase date comes from the payment in the cash ledger, or was worked back from the expiry. */
  dateFromLedger: boolean
}

/** Owners of each cita id and each (unique) name, for placing ledger rows on a patient. */
export function quirocitasOwners(s: QuirocitasSnapshot) {
  const byCita = new Map<string, string>()
  const byName = new Map<string, string[]>()
  for (const r of Object.values(s.patients)) {
    for (const a of r.ficha.appointments) byCita.set(a.id, r.ficha.id)
    const n = (r.ficha.name || r.list.name).trim().toLowerCase()
    byName.set(n, [...(byName.get(n) ?? []), r.ficha.id])
  }
  return {
    byCita,
    /** The patient a ledger row belongs to: by its visit, else by a name only one patient has. */
    of(row: QuirocitasLedgerRow): string | null {
      if (row.citaId) return byCita.get(row.citaId) ?? null
      const ids = byName.get(row.name.trim().toLowerCase())
      return ids?.length === 1 ? ids[0]! : null
    },
  }
}

const ledgerAmount = (r: QuirocitasLedgerRow) => (r.cash ?? 0) + (r.card ?? 0) + (r.transfer ?? 0)

/**
 * Each bono once, however many family members' records list it.
 *
 * A shared bono shows in every member's record and is paid once, under the
 * payer's name in the cash ledger -- so the owner is whoever the ledger says
 * paid for it, and everyone else who holds it shares it.
 */
export function quirocitasBonoRows(s: QuirocitasSnapshot, timeZone: string) {
  const owners = quirocitasOwners(s)
  const types = new Map(s.bonoTypes.map((t) => [t.name.toLowerCase(), t]))
  const holders = new Map<string, { bono: QuirocitasPatient['bonos'][number]; ids: string[] }>()
  for (const r of Object.values(s.patients)) {
    for (const b of r.ficha.bonos) {
      const h = holders.get(b.id) ?? { bono: b, ids: [] }
      h.ids.push(r.ficha.id)
      holders.set(b.id, h)
    }
  }
  // Sales in the ledger: rows whose note names a bono, by patient.
  const sales = new Map<string, { row: QuirocitasLedgerRow; used: boolean }[]>()
  for (const row of s.ledger) {
    if (!row.note || ledgerAmount(row) + (row.debt ?? 0) <= 0) continue
    const owner = owners.of(row)
    if (owner) sales.set(owner, [...(sales.get(owner) ?? []), { row, used: false }])
  }

  const rows: QuirocitasBonoRow[] = []
  const skippedDebt: string[] = []
  /** The ledger row each bono was sold on, for the payment to point at its bono. */
  const bonoOfSale = new Map<QuirocitasLedgerRow, string>()
  for (const [bonoId, { bono, ids }] of [...holders].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const type = types.get(bono.name.toLowerCase())
    if (type?.kind === 'debt') { skippedDebt.push(bonoId); continue }
    const total = type?.sessions || Number(bono.name.match(/(\d+)\s*$/)?.[1]) || bono.remaining
    const expires = quirocitasDate(bono.expires)
    const amount = cents(bono.paid + bono.owed)
    // The sale: a ledger row naming this bono, for one of its holders, on or
    // before the day it expires -- the one closest to a year (its validity)
    // before that, with the same amount when there is one.
    let sale: { row: QuirocitasLedgerRow; used: boolean; owner: string } | undefined
    const validFor = (type?.expiresInDays ?? 365) * 86_400_000
    for (const id of ids) {
      for (const cand of sales.get(id) ?? []) {
        if (cand.used || !cand.row.note.toLowerCase().includes(bono.name.toLowerCase())) continue
        const at = quirocitasDate(cand.row.date)
        if (!at || (expires && at > expires)) continue
        const score = (c: typeof cand) => (cents(ledgerAmount(c.row) + (c.row.debt ?? 0)) === amount ? 0 : 1e13) + (expires ? Math.abs(Date.parse(expires) - validFor - Date.parse(quirocitasDate(c.row.date)!)) : 0)
        if (!sale || score(cand) < score(sale)) sale = { ...cand, owner: id }
      }
    }
    if (sale) {
      sales.get(sale.owner)!.find((x) => x.row === sale!.row)!.used = true
      bonoOfSale.set(sale.row, `QC-bono-${bonoId}`)
    }
    const owner = sale?.owner ?? ids[0]!
    const purchasedAt = sale
      ? quirocitasInstant(sale.row.date, '12:00', timeZone)!
      : expires ? new Date(Date.parse(`${expires}T12:00:00Z`) - validFor).toISOString() : new Date(0).toISOString()
    rows.push({
      ref: `QC-bono-${bonoId}`,
      bonoId,
      ownerRef: qcPatientRef(owner),
      sharedWithRefs: ids.filter((i) => i !== owner).map(qcPatientRef),
      name: bono.name,
      sessionsTotal: Math.max(total, bono.remaining),
      sessionsUsed: Math.max(0, Math.max(total, bono.remaining) - bono.remaining),
      priceCents: amount,
      owedCents: cents(bono.owed),
      purchasedAt,
      isClosed: bono.remaining <= 0 || bono.status === 'pasado',
      dateFromLedger: !!sale,
    })
  }
  return { rows, skippedDebt, bonoOfSale }
}

// --- the ledger: invoices and payments -------------------------------------------------------

export interface QuirocitasChargeRow {
  ref: string
  patientRef: string
  appointmentRef: string
  number: string
  totalCents: number
  status: 'paid' | 'unpaid'
  at: string
  /** The invoice Quirocitas issued for this visit, when it did. */
  invoice: QuirocitasInvoice | null
}

export interface QuirocitasPaymentRow {
  ref: string
  patientRef: string
  method: 'cash' | 'card' | 'transfer'
  amountCents: number
  paidAt: string
  /** The visit charge it pays, or the bono it buys. */
  chargeRef: string | null
  bonoRef: string | null
}

export interface QuirocitasInvoiceNote { ref: string; patientRef: string; at: string | null; note: string }

/**
 * The cash ledger as QuiroFlow models money: a visit is a charge for what it
 * was worth (for a bono visit, the bono's per-session value), money taken is
 * a payment, and a bono sale is a payment with no charge -- QuiroFlow raises
 * none for a bono on purpose, since each of its visits is charged as it is
 * used, and charging the sale too would bill the patient twice. A patient's
 * balance -- payments less charges -- then comes out as Quirocitas has it:
 * what is left on their bonos, less what they owe.
 *
 * Quirocitas' own numbered invoices ride on that: one issued for a visit
 * becomes that visit's charge, under its Quirocitas number. One issued for a
 * bono sale has no charge to sit on, for the reason above, so it comes across
 * as a note on the patient with every detail of the invoice -- as does one on
 * a visit the ledger gives no value.
 */
export function quirocitasLedgerRows(s: QuirocitasSnapshot, bonoOfSale: Map<QuirocitasLedgerRow, string>, timeZone: string) {
  const owners = quirocitasOwners(s)
  const invoiceByCita = new Map<string, QuirocitasInvoice>()
  const invoiceByBonoPayment = new Map<string, QuirocitasInvoice>()
  for (const r of Object.values(s.patients)) {
    for (const inv of r.invoices) {
      if (inv.citaId) invoiceByCita.set(inv.citaId, inv)
      else if (inv.bonoPaymentId) invoiceByBonoPayment.set(inv.bonoPaymentId, inv)
    }
  }
  const timeOfCita = new Map<string, string>()
  for (const r of Object.values(s.patients)) for (const a of r.ficha.appointments) timeOfCita.set(a.id, a.time)

  const charges: QuirocitasChargeRow[] = []
  const payments: QuirocitasPaymentRow[] = []
  const invoiceNotes: QuirocitasInvoiceNote[] = []
  const charged = new Set<string>()
  const invoiceNote = (ref: string, patientRef: string, inv: QuirocitasInvoice): QuirocitasInvoiceNote => ({
    ref,
    patientRef,
    at: quirocitasInstant(inv.date, '12:00', timeZone),
    note: [
      `[Factura Quirocitas ${inv.number}/${inv.year ?? ''}] ${inv.date}`,
      `${inv.name ?? ''}${inv.nif ? ` · NIF ${inv.nif}` : ''}`,
      [inv.address, [inv.postcode, inv.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      inv.concept,
      `IVA ${inv.vat}% · IRPF ${inv.irpf}% · Total ${inv.total} €`,
    ].filter((l) => clean(l)).join('\n'),
  })
  const unplaced: QuirocitasLedgerRow[] = []
  const perCita = new Map<string, number>()

  for (const row of s.ledger) {
    const owner = owners.of(row)
    if (!owner) { unplaced.push(row); continue }
    const patientRef = qcPatientRef(owner)
    const at = quirocitasInstant(row.date, row.citaId ? timeOfCita.get(row.citaId) ?? '12:00' : '12:00', timeZone)!
    // A cita can sit on more than one row (a payment added later on the same
    // day); each keeps its own key.
    const key = row.citaId ? `${row.citaId}${(perCita.get(row.citaId) ?? 0) ? `-${perCita.get(row.citaId)}` : ''}` : `pb${row.bonoPaymentId}`
    if (row.citaId) perCita.set(row.citaId, (perCita.get(row.citaId) ?? 0) + 1)

    let chargeRef: string | null = null
    if (row.citaId && (row.value ?? 0) > 0) {
      const invoice = key === row.citaId ? invoiceByCita.get(row.citaId) ?? null : null
      if (invoice) charged.add(row.citaId)
      chargeRef = `QC-inv-${key}`
      charges.push({
        ref: chargeRef,
        patientRef,
        appointmentRef: `QC-${row.citaId}`,
        number: invoice ? `QC-${invoice.number}/${invoice.year ?? row.date.slice(6)}` : `QC-V${key}`,
        totalCents: cents(row.value),
        status: (row.debt ?? 0) > 0 ? 'unpaid' : 'paid',
        at,
        invoice,
      })
    }
    // Which bono a sale bought, from the matching done for the bonos.
    const bonoRef = bonoOfSale.get(row) ?? null
    for (const method of ['cash', 'card', 'transfer'] as const) {
      const amount = cents(row[method])
      if (amount <= 0) continue
      payments.push({ ref: `QC-pay-${key}-${method}`, patientRef, method, amountCents: amount, paidAt: at, chargeRef, bonoRef })
    }
    if (row.bonoPaymentId && invoiceByBonoPayment.has(row.bonoPaymentId)) invoiceNotes.push(invoiceNote(`QC-factura-pb${row.bonoPaymentId}`, patientRef, invoiceByBonoPayment.get(row.bonoPaymentId)!))
  }
  // An invoice on a visit the ledger gives no value -- a bono bought at that
  // visit, or a 0.00 invoice -- has no charge to sit on either.
  for (const [citaId, inv] of invoiceByCita) {
    if (charged.has(citaId)) continue
    const owner = owners.byCita.get(citaId)
    if (owner) invoiceNotes.push(invoiceNote(`QC-factura-c${citaId}`, qcPatientRef(owner), inv))
  }
  return { charges, payments, invoiceNotes, unplaced }
}

// --- files ----------------------------------------------------------------------------------

export interface QuirocitasFileRow { ref: string; patientRef: string; quirocitasId: string; testId: string; src: string; fileName: string; isXray: boolean; description: string }

export function quirocitasFileRows(r: QuirocitasRecord): QuirocitasFileRow[] {
  return r.history.tests.filter((t) => t.src && t.id).map((t) => ({
    ref: `QC-test-${t.id}`,
    patientRef: qcPatientRef(r.ficha.id),
    quirocitasId: r.ficha.id,
    testId: t.id,
    src: t.src!,
    fileName: t.file,
    isXray: /\b(rx|radiograf|x-?ray)/i.test(`${t.file} ${t.description}`),
    description: t.description,
  }))
}
