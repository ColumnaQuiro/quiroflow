// What a read of Quirocitas becomes in QuiroFlow: pure functions from the
// parsed pages (utils/quirocitasPages.ts) to the rows each import step writes.
// Kept free of Supabase and of Vue so the mapping can be tested on its own,
// and so every step agrees on the same references.
//
// Every row is stamped with an external_reference starting "QC-", never a
// bare number: PracticeHub's references are bare numbers under the same
// unique index, and a clinic could hold both.
import { wallClockToUtc } from './clinicClock'
import type { QuirocitasBonoType, QuirocitasCajaLayout, QuirocitasHistory, QuirocitasInvoice, QuirocitasLedgerRow, QuirocitasListPatient, QuirocitasPatient } from './quirocitasPages'

export interface QuirocitasTechniques { left: { segment: string; technique: string }[]; right: { segment: string; technique: string }[] }

/** One patient as the Read step stores it. */
export interface QuirocitasRecord {
  list: QuirocitasListPatient
  ficha: QuirocitasPatient
  history: QuirocitasHistory
  invoices: QuirocitasInvoice[]
  /** By cita id; only visits with something marked. */
  techniques: Record<string, QuirocitasTechniques>
  /** When this record was fetched. Missing on copies made before it was kept. */
  readAt?: string
}

export interface QuirocitasLedgerMonth {
  month: string
  rows: number
  /** What the page printed under the month, and what its rows add up to. */
  printed: { cash: number | null; card: number | null; transfer: number | null }
  summed: { cash: number; card: number; transfer: number }
  /**
   * Where its columns were read from (parseQuirocitasCajaMonth's layout), so a
   * clinic whose page is laid out differently says how without anyone needing
   * its login. The header and the row's inputs are kept on the newest month
   * only. Absent on copies read before this was kept.
   */
  columns?: QuirocitasCajaLayout['columns']
  fromTotals?: QuirocitasCajaLayout['fromTotals']
  header?: string[]
  inputs?: string[]
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
  /** When the read this copy belongs to began; a record older than it is read again. */
  passStartedAt?: string
  /** How many patients Quirocitas' list named when the read began. Absent on copies from before it was recorded. */
  listTotal?: number
  /** Which reader made this copy (QUIROCITAS_COPY_VERSION). Absent on copies from before it was recorded. */
  version?: number
  /**
   * Why the cash ledger could not be read, on a pass that read every patient.
   * Such a copy has no months, like one that stopped part way, but its
   * patients are all there: everything except payments can be imported from it.
   */
  ledgerError?: string
}

/**
 * Raised when the reader starts parsing a page differently, so that records
 * stored by an older reader are fetched again instead of being carried on
 * from. 2: a clinic with a single chiropractor has no chiropractor column,
 * and every record read before that was understood has an empty visit list.
 */
export const QUIROCITAS_COPY_VERSION = 2

export const qcPatientRef = (id: string) => `QC-${id}`

/**
 * Whether a copy is the whole clinic, or a read that stopped part way.
 *
 * The ledger is read last and is cleared while a pass runs, so a copy without
 * months is unfinished, whatever its patient count says. That is what an
 * import step has to refuse by default: a clinic's read stopped at 1,200 of
 * its patients (a reload, a closed tab, a laptop asleep), every step imported
 * from that copy without a word, and the calendar was missing every visit of
 * every patient never read -- most of that day's agenda. `read` counts records
 * fetched in the current pass, so a stopped "read again" says how far it got.
 */
export function quirocitasReadState(s: QuirocitasSnapshot) {
  const finished = s.ledgerMonths.length > 0
  const records = Object.values(s.patients)
  const pass = s.passStartedAt
  const read = finished || !pass ? records.length : records.filter((r) => (r.readAt ?? '') >= pass).length
  return { finished, read, total: s.listTotal ?? null }
}

/**
 * The patients (by Quirocitas id) whose record says what Quirocitas holds as
 * of the copy's own read, so that something MISSING from it is missing there.
 *
 * Everything else an import step does adds or corrects what a record names,
 * and a stale record only makes that late. Acting on what a record no longer
 * names is the opposite: a record kept from an earlier pass, or a pass that
 * stopped part way, would call a real appointment gone. So this is empty
 * unless the pass read every patient (it has its ledger, or ended at a ledger
 * it could not read), and it leaves out anyone whose record failed this time
 * -- theirs is the earlier copy -- or was not fetched in this pass at all.
 * A copy from before passes were recorded names nobody.
 */
export function quirocitasRecordsReadThisPass(s: QuirocitasSnapshot): Set<string> {
  const pass = s.passStartedAt
  const everyone = s.ledgerMonths.length > 0 || !!s.ledgerError
  if (!pass || !everyone || (s.version ?? 1) < QUIROCITAS_COPY_VERSION) return new Set()
  return new Set(Object.values(s.patients).filter((r) => !(r.ficha.id in s.failed) && (r.readAt ?? '') >= pass).map((r) => r.ficha.id))
}

/**
 * Which patients a read has to fetch from Quirocitas.
 *
 * A finished copy (its ledger is read last, so it has months) is out of date
 * the moment the clinic books anything in Quirocitas, so pressing Read again
 * starts a new pass over EVERY patient: a new appointment, a cancellation or
 * a move only shows in a record that is fetched again. It used to fetch only
 * patients the copy did not have, so "Read again for changes" brought new
 * patients and nothing else, and the Appointments step then found nothing to
 * import for anyone already imported.
 *
 * A pass that stopped part way (the ledger is cleared until the pass ends)
 * carries on: only records not yet fetched in that pass are read. A copy from
 * before passes were recorded has no start, and carries on as it always did,
 * with the patients it does not have.
 *
 * Two copies without months are not a pass to carry on. One whose ledger
 * could not be read (`ledgerError`) did read every patient, so the next read
 * is a new pass like any other: carrying on from it would fetch nobody, ever
 * again, while the clinic goes on booking in Quirocitas. And one made by an
 * older reader holds records parsed the old way, which only fetching them
 * again puts right.
 */
export function quirocitasReadQueue(previous: QuirocitasSnapshot | null, listIds: string[], now: string) {
  const resuming = previous && previous.ledgerMonths.length === 0 && !previous.ledgerError && (previous.version ?? 1) >= QUIROCITAS_COPY_VERSION
  const passStartedAt = resuming ? previous.passStartedAt ?? '' : now
  const queue = listIds.filter((id) => {
    if (!resuming) return true
    const rec = previous.patients[id]
    return !rec || (rec.readAt ?? '') < passStartedAt
  })
  return { passStartedAt, queue }
}

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

// --- who saw them --------------------------------------------------------------------

const personKey = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(dr|dra|d)\./g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Finds the team member Quirocitas means by a chiropractor's name.
 *
 * An appointment that names nobody on the team comes in with no practitioner,
 * and the calendar opens on one person's tab: it is in the database and on
 * nobody's screen. Two clinics reported "not every appointment is there" for
 * exactly that, for two different reasons, and both are answered here.
 *
 * - The names differ by more than case. Quirocitas has "Oriol Demo" and the
 *   team has "Oriol Demo Prueba", so a match is the same name, or one name
 *   wholly contained in the other and starting the same way, when only one
 *   member fits. Sharing a surname is not enough.
 * - Quirocitas names nobody at all. A clinic with a single chiropractor has no
 *   chiropractor column to read, so every name is blank; `sole` then says who
 *   that one person is. It is passed only when the whole copy names nobody,
 *   never for the odd blank in a clinic that does name its chiropractors.
 */
export function quirocitasPractitionerMatcher(team: { id: string; full_name: string }[], sole: string | null = null) {
  const members = team.map((m) => ({ id: m.id, key: personKey(m.full_name), words: new Set(personKey(m.full_name).split(' ')) })).filter((m) => m.key)
  const found = new Map<string, string | null>()
  return (name: string): string | null => {
    const key = personKey(name)
    if (!key || key === 'cualquiera') return key ? null : sole
    if (found.has(key)) return found.get(key)!
    const words = key.split(' ')
    const exact = members.filter((m) => m.key === key)
    const within = members.filter((m) => m.key.split(' ')[0] === words[0] && (words.every((w) => m.words.has(w)) || [...m.words].every((w) => words.includes(w))))
    const id = exact.length === 1 ? exact[0]!.id : exact.length === 0 && within.length === 1 ? within[0]!.id : null
    found.set(key, id)
    return id
  }
}

/** Whether a copy names a chiropractor anywhere. One from a single-chiropractor clinic never does. */
export function quirocitasNamesChiropractors(s: Pick<QuirocitasSnapshot, 'patients'>) {
  return Object.values(s.patients).some((r) => clean(r.ficha.chiro) || r.ficha.appointments.some((a) => clean(a.chiro)) || r.ficha.visits.some((v) => clean(v.chiro)))
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
export function quirocitasBonoRows(s: QuirocitasSnapshot, timeZone: string, today = new Date().toISOString().slice(0, 10)) {
  const owners = quirocitasOwners(s)
  const byId = s.patients
  // The last visit each patient paid for with a bono ("B" in their visit list).
  const lastBonoVisit = (id: string) => (byId[id]?.ficha.visits ?? []).filter((v) => v.bono).map((v) => quirocitasDate(v.date)).filter((d): d is string => !!d).sort().pop() ?? ''
  const yearAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10)
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

  // Quirocitas greys a bono out the day it expires ("pasado") and goes on
  // taking visits off it for as long as the clinic lets the patient use it.
  // Closing every expired bono hid the ones still in use: a patient with two
  // sessions left, last used a month before, had no bono to pay with at the
  // desk. So an expired bono stays open while it is the one its holders are
  // on -- none of them holds a later one with sessions left -- and one of them
  // has paid a visit with it since it expired, within the last year. One that
  // expired and was never touched again stays closed.
  const stillUsed = (bonoId: string, bono: QuirocitasPatient['bonos'][number], ids: string[]) => {
    const expires = quirocitasDate(bono.expires)
    if (!expires) return false
    const later = ids.some((id) => (byId[id]?.ficha.bonos ?? []).some((b) => b.id !== bonoId && b.remaining > 0 && (quirocitasDate(b.expires) ?? '') > expires))
    if (later) return false
    const last = ids.map(lastBonoVisit).sort().pop() ?? ''
    return last > expires && last >= yearAgo
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
      isClosed: bono.remaining <= 0 || (bono.status === 'pasado' && !stillUsed(bonoId, bono, ids)),
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
  /** Rows worth something (a visit) that no visit could be found for: their charge is not raised. */
  const visitless: QuirocitasLedgerRow[] = []
  const perCita = new Map<string, number>()
  const perRow = new Map<string, number>()

  // A cash page with no invoicing column carries no visit id on its rows (one
  // clinic's: all 53,815 of them). The visit is then the one the patient's own
  // record has on that day -- an attended one first -- each taken once.
  const visitsOn = new Map<string, string[]>()
  const attended = (status: string) => status === 'pasado' || status === 'presente'
  for (const r of Object.values(s.patients)) {
    const ordered = [...r.ficha.appointments].sort((a, b) => Number(attended(b.status)) - Number(attended(a.status)) || a.time.localeCompare(b.time))
    for (const a of ordered) {
      // Not yet, or never: a cancelled or moved visit was not what was paid for.
      if (a.status === 'futuro' || STATUS[a.status] === 'cancelled') continue
      const k = `${r.ficha.id}|${quirocitasDate(a.date)}`
      visitsOn.set(k, [...(visitsOn.get(k) ?? []), a.id])
    }
  }
  const takenCitas = new Set(s.ledger.map((r) => r.citaId).filter((c): c is string => !!c))
  const visitOf = (row: QuirocitasLedgerRow, owner: string): string | null => {
    if (row.citaId) return row.citaId
    if ((row.value ?? 0) <= 0) return null
    const free = (visitsOn.get(`${owner}|${quirocitasDate(row.date)}`) ?? []).find((c) => !takenCitas.has(c))
    if (free) takenCitas.add(free)
    return free ?? null
  }

  for (const row of s.ledger) {
    const owner = owners.of(row)
    if (!owner) { unplaced.push(row); continue }
    const patientRef = qcPatientRef(owner)
    const citaId = visitOf(row, owner)
    const at = quirocitasInstant(row.date, citaId ? timeOfCita.get(citaId) ?? '12:00' : '12:00', timeZone)!
    // A cita can sit on more than one row (a payment added later on the same
    // day); each keeps its own key. A row with neither a visit nor a bono
    // sale is keyed by what it says, so a re-read finds the same reference
    // and a second row identical to it gets the next one. They all used to
    // share "pbnull", and the whole ledger was refused as duplicates.
    let key: string
    if (citaId) {
      key = `${citaId}${(perCita.get(citaId) ?? 0) ? `-${perCita.get(citaId)}` : ''}`
      perCita.set(citaId, (perCita.get(citaId) ?? 0) + 1)
    } else if (row.bonoPaymentId) key = `pb${row.bonoPaymentId}`
    else {
      const what = `r${(quirocitasDate(row.date) ?? row.date).replace(/-/g, '')}-${owner}-${fnv([row.name, row.note, row.cash, row.card, row.transfer, row.debt, row.value].join('|'))}`
      const n = perRow.get(what) ?? 0
      perRow.set(what, n + 1)
      key = n ? `${what}-${n}` : what
    }

    let chargeRef: string | null = null
    if ((row.value ?? 0) > 0 && !citaId) visitless.push(row)
    if (citaId && (row.value ?? 0) > 0) {
      const invoice = key === citaId ? invoiceByCita.get(citaId) ?? null : null
      if (invoice) charged.add(citaId)
      chargeRef = `QC-inv-${key}`
      charges.push({
        ref: chargeRef,
        patientRef,
        appointmentRef: `QC-${citaId}`,
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
  return { charges, payments, invoiceNotes, unplaced, visitless }
}

// A short, stable digest of a ledger row, for its reference when the page
// gives it no id. FNV-1a: no crypto needed, only the same answer every read.
function fnv(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
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

/** Months whose rows do not add up to what Quirocitas printed under them. */
//
// Cash is checked against cash. The other methods are checked as a set: the
// page totals them by slot (its second and third payment method), and copies
// read before the slots were matched to the header's columns stored slot 2
// as "card" whatever it was -- one clinic's transfers, every month. What
// matters is that every euro the page printed was read into some column; the
// header, not the footer, says which method that column is.
export function quirocitasLedgerMismatches(s: Pick<QuirocitasSnapshot, 'ledgerMonths'>) {
  const off = (a: number, b: number) => Math.abs(a - b) > 0.011
  const nonZero = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && Math.abs(x) > 0.011).sort((a, b) => a - b)
  return s.ledgerMonths.filter((m) => {
    if (m.printed.cash !== null && off(m.printed.cash, m.summed.cash)) return true
    // A page that prints no method totals at all has nothing to check them by.
    if (m.printed.card === null && m.printed.transfer === null) return false
    const printed = nonZero([m.printed.card, m.printed.transfer])
    const summed = nonZero([m.summed.card, m.summed.transfer])
    return printed.length !== summed.length || printed.some((p, i) => off(p, summed[i]!))
  })
}
