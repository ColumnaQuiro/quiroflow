import { quirocitasPhone } from '~/utils/quirocitasRows'

// What each record read out of QuiroHiro becomes in QuiroFlow, worked out
// without touching either database: the planner (utils/quirohiroImport.ts)
// compares these rows with what is already here and writes the difference.
//
// QuiroHiro is a white-labelled GoHighLevel, read through its v2 API
// (server/utils/quirohiro.ts). What a chiropractic clinic keeps there:
//
//   * Contacts, both leads and patients: `type` is "lead" or "paciente", set
//     by the clinic's own automations. Leads are most of them -- 2,292 of
//     3,573 at the first clinic -- so whether they come in is the clinic's
//     choice (QuirohiroWho).
//   * Appointments, one calendar per appointment type AND practitioner
//     ("Sesión de Ajuste Olga", "Primera Visita Olga"...), so the type is the
//     calendar's name with the practitioner's name taken off the end.
//   * The clinical record, as contact custom fields in folders of the
//     clinic's own making (Motivo de consulta, Antecedentes, Examen y
//     diagnóstico, Tratamiento, Plan de tratamiento, Bonos...). GoHighLevel's
//     own folders (Contact, Additional Info, General Info) are marked
//     `standard`; everything else is the clinic's.
//   * Visit notes, as contact notes written on the day of the visit: 93% of
//     the first clinic's fall on the same day as one of the patient's visits.
//   * No money: QuiroHiro's payments and invoices were empty, and three
//     patients had the bono fields filled in, which go into the record as
//     text rather than becoming bonos nobody paid for.

// --- the copy -------------------------------------------------------------------

export interface QuirohiroUser { id: string; name?: string | null; firstName?: string | null; lastName?: string | null; deleted?: boolean }
export interface QuirohiroCalendar { id: string; name: string; slotDuration?: number | null; slotDurationUnit?: string | null; teamMembers?: { userId: string }[] | null }
export interface QuirohiroField {
  id: string
  name: string
  fieldKey: string
  dataType: string
  parentId?: string | null
  position?: number | null
  /** SINGLE_OPTIONS lists plain strings; TEXTBOX_LIST lists the sub-fields, each with an id of its own. */
  picklistOptions?: (string | { id: string; label: string })[] | null
}
export interface QuirohiroFolder { id: string; name: string; position?: number | null; standard?: boolean }
export interface QuirohiroContact {
  id: string
  firstName?: string | null
  lastName?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  additionalPhones?: (string | { phone?: string | null })[] | null
  dateOfBirth?: string | null
  address1?: string | null
  city?: string | null
  postalCode?: string | null
  type?: string | null
  tags?: string[] | null
  source?: string | null
  dateAdded?: string | null
  dnd?: boolean | null
  assignedTo?: string | null
  customFields?: { id: string; value: unknown }[] | null
}
export interface QuirohiroEvent {
  id: string
  calendarId: string
  contactId?: string | null
  startTime: string
  endTime?: string | null
  appointmentStatus?: string | null
  assignedUserId?: string | null
  title?: string | null
  notes?: string | null
  rescheduledAt?: string | null
  deleted?: boolean | null
}
export interface QuirohiroNote { id: string; contactId: string; body?: string | null; bodyText?: string | null; dateAdded: string; userId?: string | null }

export interface QuirohiroSnapshot {
  readAt: string
  locationId: string
  users: QuirohiroUser[]
  calendars: QuirohiroCalendar[]
  fields: QuirohiroField[]
  folders: QuirohiroFolder[]
  contacts: QuirohiroContact[]
  events: QuirohiroEvent[]
  /** Only for the contacts the read was asked to bring (see quirohiroNoteTargets). */
  notes: QuirohiroNote[]
  /** QuiroHiro's invoices and payments: empty when the token cannot read them (see `money`). */
  invoices?: QuirohiroInvoice[]
  transactions?: QuirohiroTransaction[]
  /** Whether the read could see payments: they need two scopes a token made for an earlier version may not have. */
  money?: { read: boolean; reason?: string }
}

export interface QuirohiroInvoiceItem { name?: string | null; description?: string | null; amount?: number | null; qty?: number | null }
export interface QuirohiroInvoice {
  _id: string
  /** draft | sent | payment_processing | partially_paid | paid | void */
  status?: string | null
  liveMode?: boolean | null
  invoiceNumber?: string | number | null
  currency?: string | null
  contactDetails?: { id?: string | null } | null
  issueDate?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  /** In the currency's units (45.5 is 45,50 €), as are every amount below. */
  total?: number | null
  amountPaid?: number | null
  amountDue?: number | null
  invoiceItems?: QuirohiroInvoiceItem[] | null
}
export interface QuirohiroTransaction {
  _id: string
  contactId?: string | null
  /** succeeded | partially_refunded | refunded | failed | pending */
  status?: string | null
  liveMode?: boolean | null
  currency?: string | null
  amount?: number | null
  amountRefunded?: number | null
  /** What was paid for: "invoice" with entityId the invoice, or an order, a payment link... */
  entityType?: string | null
  entityId?: string | null
  entitySourceType?: string | null
  entitySourceName?: string | null
  paymentProviderType?: string | null
  createdAt?: string | null
}

/** Who becomes a patient here: only the clinic's patients, or every contact, leads included. */
export type QuirohiroWho = 'patients' | 'everyone'

// --- references ------------------------------------------------------------------

export const qhPatientRef = (contactId: string) => `QH-${contactId}`
export const qhAppointmentRef = (eventId: string) => `QH-appt-${eventId}`
export const qhNoteRef = (noteId: string) => `QH-note-${noteId}`
export const qhRecordRef = (contactId: string) => `QH-ficha-${contactId}`

const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '')
const personKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** A note's text: GoHighLevel keeps the HTML the editor wrote and, usually, a plain copy beside it. */
export function quirohiroText(html: string | null | undefined, plain?: string | null): string {
  if (clean(plain)) return clean(plain).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  return clean(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** A GoHighLevel event is deduplicated by id: the read walks month windows, and one starting near a boundary comes back in both. */
export function quirohiroEvents(s: Pick<QuirohiroSnapshot, 'events'>): QuirohiroEvent[] {
  return [...new Map(s.events.filter((e) => e.id && !e.deleted && e.contactId).map((e) => [e.id, e])).values()]
}

// --- which contacts come in --------------------------------------------------------

/** The folders the clinic made for itself: GoHighLevel's own are flagged `standard`. */
function clinicalFolderIds(s: Pick<QuirohiroSnapshot, 'folders'>) {
  return new Set(s.folders.filter((f) => !f.standard).map((f) => f.id))
}

/**
 * The contacts that become patients. "patients" is anyone QuiroHiro calls a
 * patient, anyone who has ever had an appointment, and anyone with something
 * in their clinical record -- a lead the chiropractor has already examined is
 * a patient whatever their type says.
 */
export function quirohiroPatients(s: Pick<QuirohiroSnapshot, 'contacts' | 'events' | 'fields' | 'folders'>, who: QuirohiroWho): QuirohiroContact[] {
  if (who === 'everyone') return s.contacts
  const booked = new Set(quirohiroEvents(s).map((e) => e.contactId))
  const clinical = clinicalFolderIds(s)
  const clinicalField = new Set(s.fields.filter((f) => f.parentId && clinical.has(f.parentId)).map((f) => f.id))
  // A TEXTBOX_LIST's values are stored under its sub-fields' ids, not its own.
  for (const f of s.fields) if (f.parentId && clinical.has(f.parentId)) for (const o of f.picklistOptions ?? []) if (typeof o === 'object' && o?.id) clinicalField.add(o.id)
  return s.contacts.filter((c) => c.type === 'paciente' || booked.has(c.id) || (c.customFields ?? []).some((v) => clinicalField.has(v.id) && hasValue(v.value)))
}

/** The contacts the read fetches notes for: one request each, so not the thousands of leads nobody chose to bring. */
export function quirohiroNoteTargets(s: Pick<QuirohiroSnapshot, 'contacts' | 'events' | 'fields' | 'folders'>, who: QuirohiroWho): string[] {
  return quirohiroPatients(s, who).map((c) => c.id)
}

const hasValue = (v: unknown) => v !== null && v !== undefined && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)

// --- people ------------------------------------------------------------------------

/** A team member's name as QuiroHiro shows it. */
export function quirohiroUserName(u: QuirohiroUser | undefined): string {
  if (!u) return ''
  return clean(u.name) || [clean(u.firstName), clean(u.lastName)].filter(Boolean).join(' ')
}

// Custom fields that are QuiroFlow columns rather than text in the record.
const COLUMN_FIELDS: Record<string, 'national_id' | 'occupation' | 'gender'> = {
  'contact.dninif': 'national_id',
  'contact.dni': 'national_id',
  'contact.nif': 'national_id',
  'contact.profesion': 'occupation',
  'contact.profesin': 'occupation',
  'contact.genero': 'gender',
  'contact.gnero': 'gender',
}

// Custom fields that are the patient's clinical snapshot here (the Clinical
// tab's chief complaint, working diagnosis and red flags). They stay in the
// record text too, where they sit among the rest of the history.
const CLINICAL_FIELDS: Record<string, 'chief_complaint' | 'diagnosis' | 'red_flags'> = {
  'contact.motivo_de_consulta': 'chief_complaint',
  'contact.diagnostico_de_trabajo': 'diagnosis',
  'contact.diagnstico_de_trabajo': 'diagnosis',
  'contact.bandejas_rojas': 'red_flags',
  'contact.banderas_rojas': 'red_flags',
}

// What the clinic's marketing automations write onto a contact: tracking ids
// and the pipeline's own counters. Not part of anyone's record.
const HIDDEN_FIELD = /^contact\.(qh_|utm_|lead_form_|lid$|pipeline_|canal_primera_respuesta|fbclid|gclid)/

/** Birth dates come as YYYY-MM-DD; one in the future or before 1900 is a typo. */
function plausibleBirthDate(raw: string | null | undefined): string | null {
  const iso = clean(raw).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  return iso >= '1900-01-01' && iso <= new Date().toISOString().slice(0, 10) ? iso : null
}

export interface QuirohiroPatientRow {
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
    referral_source: string | null
    tags: string[]
    reminder_channel: string
    confirmation_channel: string
  }
  /** The clinical snapshot, from the custom fields in CLINICAL_FIELDS; only ever fills a blank here. */
  clinical: Partial<Record<'chief_complaint' | 'diagnosis' | 'red_flags', string>>
  /** The QuiroHiro user the contact is assigned to, by name. */
  practitioner: string
  phones: { country_code: string; number: string }[]
  createdAt: string | null
}

export function quirohiroPatientRow(c: QuirohiroContact, s: Pick<QuirohiroSnapshot, 'fields' | 'users'>): QuirohiroPatientRow {
  const byId = new Map(s.fields.map((f) => [f.id, f]))
  const column: Partial<Record<'national_id' | 'occupation' | 'gender', string>> = {}
  const clinical: QuirohiroPatientRow['clinical'] = {}
  for (const v of c.customFields ?? []) {
    const fieldKey = byId.get(v.id)?.fieldKey ?? ''
    const text = typeof v.value === 'string' || typeof v.value === 'number' ? clean(String(v.value)) : ''
    if (!text) continue
    if (COLUMN_FIELDS[fieldKey]) column[COLUMN_FIELDS[fieldKey]] = text
    if (CLINICAL_FIELDS[fieldKey]) clinical[CLINICAL_FIELDS[fieldKey]] = text
  }
  let first = clean(c.firstName)
  let last = clean(c.lastName)
  if (!first && !last) {
    const parts = clean(c.contactName).split(/\s+/).filter(Boolean)
    first = parts[0] ?? ''
    last = parts.slice(1).join(' ')
  }
  const gender = /^(mujer|femenino|female|f)$/i.test(column.gender ?? '') ? 'female' : /^(hombre|masculino|male|m)$/i.test(column.gender ?? '') ? 'male' : null
  // The same number twice, as phone and again among the extra ones, is one number.
  const raw = [c.phone, ...(c.additionalPhones ?? []).map((p) => (typeof p === 'string' ? p : p?.phone))].map(clean).filter(Boolean)
  const phones = [...new Map(raw.map((p) => [p.replace(/\D/g, ''), quirocitasPhone(p)] as const)).values()]
  const users = new Map(s.users.map((u) => [u.id, u]))
  return {
    ref: qhPatientRef(c.id),
    name: [first, last].filter(Boolean).join(' ') || clean(c.email) || clean(c.phone),
    fields: {
      // A contact QuiroHiro holds only as a phone number still needs a name here.
      first_name: first || clean(c.email).split('@')[0] || clean(c.phone) || 'Sin nombre',
      last_name: last || null,
      email: clean(c.email).toLowerCase() || null,
      date_of_birth: plausibleBirthDate(c.dateOfBirth),
      national_id: column.national_id?.toUpperCase() ?? null,
      address: clean(c.address1) || null,
      postal_code: clean(c.postalCode) || null,
      city: clean(c.city) || null,
      occupation: column.occupation ?? null,
      gender,
      referral_source: clean(c.source).slice(0, 200) || null,
      tags: [...new Set((c.tags ?? []).map(clean).filter(Boolean))],
      // "Do not disturb" turns off what QuiroFlow would send on its own.
      // Always both keys: a bulk insert sends NULL for a key only some rows carry.
      reminder_channel: c.dnd ? 'none' : 'sms',
      confirmation_channel: c.dnd ? 'none' : 'sms',
    },
    clinical,
    practitioner: quirohiroUserName(users.get(c.assignedTo ?? '')),
    phones,
    createdAt: clean(c.dateAdded) || null,
  }
}

// --- the clinical record ------------------------------------------------------------

/** One custom field's value as text, or '' when there is nothing to say. */
function fieldText(f: QuirohiroField, value: unknown): string {
  if (!hasValue(value)) return ''
  switch (f.dataType) {
    case 'DATE': {
      // Midnight UTC of the day picked, in milliseconds (a string in older records).
      const at = typeof value === 'number' ? value : Date.parse(String(value))
      return Number.isFinite(at) ? new Date(at).toLocaleDateString('es-ES', { timeZone: 'UTC' }) : clean(String(value))
    }
    case 'FILE_UPLOAD':
    case 'SIGNATURE':
      return ''
    default:
      if (Array.isArray(value)) return value.map((x) => clean(String(x))).filter(Boolean).join(', ')
      if (typeof value === 'object') return ''
      return clean(String(value))
  }
}

export interface QuirohiroRecordSection { title: string; lines: string[] }

/**
 * The contact's custom fields as the sections of a record: one per folder the
 * clinic made, in QuiroHiro's order, then "Otros datos" for the clinic's own
 * fields kept in GoHighLevel's folders (the lead form's answers, "Primera vez
 * con la quiropráctica"...). Columns of their own here (DNI, profession,
 * gender) and the marketing automations' tracking fields are left out.
 */
export function quirohiroRecordSections(c: QuirohiroContact, s: Pick<QuirohiroSnapshot, 'fields' | 'folders'>): QuirohiroRecordSection[] {
  const values = new Map((c.customFields ?? []).map((v) => [v.id, v.value]))
  const folders = [...s.folders].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const custom = folders.filter((f) => !f.standard)
  const standard = new Set(folders.filter((f) => f.standard).map((f) => f.id))
  const linesOf = (fields: QuirohiroField[]) => [...fields]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .flatMap((f) => {
      if (f.dataType === 'TEXTBOX_LIST') {
        // Each line of the list is a sub-field with its own id and label.
        const items = (f.picklistOptions ?? []).flatMap((o) => (typeof o === 'object' && o?.id && hasValue(values.get(o.id)) ? [`${o.label}: ${clean(String(values.get(o.id)))}`] : []))
        return items.length ? [`${f.name.trim()}:`, ...items.map((i) => `  · ${i}`)] : []
      }
      const text = fieldText(f, values.get(f.id))
      if (!text) return []
      return text.includes('\n') ? [`${f.name.trim()}:`, text] : [`${f.name.trim()}: ${text}`]
    })
  const sections: QuirohiroRecordSection[] = custom
    .map((folder) => ({ title: folder.name.trim(), lines: linesOf(s.fields.filter((f) => f.parentId === folder.id)) }))
    .filter((x) => x.lines.length)
  const other = linesOf(s.fields.filter((f) => (!f.parentId || standard.has(f.parentId)) && !COLUMN_FIELDS[f.fieldKey] && !HIDDEN_FIELD.test(f.fieldKey)))
  if (other.length) sections.push({ title: 'Otros datos', lines: other })
  return sections
}

/** The record as the one text that goes on the patient's history. Empty when QuiroHiro holds nothing clinical. */
export function quirohiroRecordText(c: QuirohiroContact, s: Pick<QuirohiroSnapshot, 'fields' | 'folders'>): string {
  const sections = quirohiroRecordSections(c, s)
  if (!sections.length) return ''
  return ['Ficha de QuiroHiro', ...sections.map((x) => `\n${x.title.toUpperCase()}\n${x.lines.join('\n')}`)].join('\n')
}

/** How many file and signature values a contact has: not copied yet, so the step says so. */
export function quirohiroFileCount(c: QuirohiroContact, s: Pick<QuirohiroSnapshot, 'fields'>): number {
  const files = new Set(s.fields.filter((f) => f.dataType === 'FILE_UPLOAD' || f.dataType === 'SIGNATURE').map((f) => f.id))
  return (c.customFields ?? []).filter((v) => files.has(v.id) && hasValue(v.value)).length
}

// --- appointments --------------------------------------------------------------------

export type QuirohiroStatus = 'booked' | 'completed' | 'cancelled' | 'no_show'

export interface QuirohiroAppointmentRow {
  ref: string
  patientRef: string
  type: string
  practitioner: string
  startsAt: string
  minutes: number
  status: QuirohiroStatus
  /** Past, and still "confirmed" in QuiroHiro: nobody marked whether they came. Comes in as attended. */
  unmarked: boolean
  rescheduled: boolean
  note: string | null
}

/**
 * The appointment type a calendar stands for. Each practitioner has a
 * calendar per type -- "Sesión de Ajuste Olga" -- so the names of the
 * calendar's team members are taken off its end.
 */
export function quirohiroCalendarType(cal: QuirohiroCalendar, users: QuirohiroUser[]): string {
  const byId = new Map(users.map((u) => [u.id, u]))
  const team = (cal.teamMembers ?? []).map((m) => byId.get(m.userId)).filter((u): u is QuirohiroUser => !!u)
  const nameWords = new Set((team.length ? team : users).flatMap((u) => personKey(quirohiroUserName(u)).split(' ')).filter((w) => w.length > 1))
  const words = cal.name.trim().split(/\s+/)
  while (words.length > 1 && nameWords.has(personKey(words[words.length - 1]!))) words.pop()
  return words.join(' ').replace(/[\s\-–·|]+$/, '').trim() || cal.name.trim()
}

/** A calendar's slot in minutes: GoHighLevel keeps the number and its unit apart. */
function slotMinutes(cal: QuirohiroCalendar | undefined): number {
  const n = Number(cal?.slotDuration)
  if (!Number.isFinite(n) || n <= 0) return 30
  return (cal?.slotDurationUnit ?? '').startsWith('hour') ? n * 60 : n
}

export function quirohiroAppointmentRows(s: Pick<QuirohiroSnapshot, 'events' | 'calendars' | 'users'>, now = new Date().toISOString()): QuirohiroAppointmentRow[] {
  const calendars = new Map(s.calendars.map((c) => [c.id, c]))
  const types = new Map(s.calendars.map((c) => [c.id, quirohiroCalendarType(c, s.users)]))
  const users = new Map(s.users.map((u) => [u.id, u]))
  return quirohiroEvents(s).map((e) => {
    const startsAt = new Date(e.startTime).toISOString()
    const ends = e.endTime ? Date.parse(e.endTime) : NaN
    const cal = calendars.get(e.calendarId)
    const minutes = Number.isFinite(ends) && ends > Date.parse(startsAt) ? Math.round((ends - Date.parse(startsAt)) / 60000) : slotMinutes(cal)
    const raw = (e.appointmentStatus ?? '').toLowerCase()
    const past = startsAt < now
    const status: QuirohiroStatus = raw === 'showed' ? 'completed'
      : raw === 'noshow' ? 'no_show'
        : raw === 'cancelled' || raw === 'invalid' ? 'cancelled'
          : past ? 'completed' : 'booked'
    const assigned = users.get(e.assignedUserId ?? '') ?? users.get(cal?.teamMembers?.[0]?.userId ?? '')
    return {
      ref: qhAppointmentRef(e.id),
      patientRef: qhPatientRef(e.contactId!),
      type: types.get(e.calendarId) || clean(e.title) || 'Cita',
      practitioner: quirohiroUserName(assigned),
      startsAt,
      minutes,
      status,
      unmarked: past && status === 'completed' && raw !== 'showed',
      rescheduled: !!e.rescheduledAt,
      note: quirohiroText(e.notes) || null,
    }
  })
}

// --- notes -------------------------------------------------------------------------------

export interface QuirohiroNoteRow {
  ref: string
  patientRef: string
  at: string
  text: string
  /** The visit it was written at -- the same day, in the clinic's time -- or null for one written on a day with no visit. */
  appointmentRef: string | null
}

const dayIn = (iso: string, timeZone: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone })

/**
 * Each note, placed on the visit of the day it was written. A clinic writes
 * its visit notes in the contact's notes on the day; one written on a day
 * with no visit goes on the patient's history instead. With two visits that
 * day: one that took place over one that did not, then the last to start
 * before the note was written.
 */
export function quirohiroNoteRows(s: Pick<QuirohiroSnapshot, 'notes' | 'events'>, timeZone: string): QuirohiroNoteRow[] {
  const visits = new Map<string, QuirohiroEvent[]>()
  for (const e of quirohiroEvents(s)) {
    const k = `${e.contactId}|${dayIn(e.startTime, timeZone)}`
    visits.set(k, [...(visits.get(k) ?? []), e])
  }
  const rank = (e: QuirohiroEvent) => (e.appointmentStatus === 'showed' ? 0 : e.appointmentStatus === 'cancelled' || e.appointmentStatus === 'invalid' ? 2 : 1)
  return s.notes.flatMap((n) => {
    const text = quirohiroText(n.body, n.bodyText)
    if (!text || !n.contactId) return []
    const at = new Date(n.dateAdded).toISOString()
    // QuiroHiro's AI receptionist leaves a note when it hands a conversation
    // to a person ("🤖 Laura transfirió la conversación a un humano…"): a
    // record of the conversation, not of the visit that day.
    if (text.startsWith('🤖')) return [{ ref: qhNoteRef(n.id), patientRef: qhPatientRef(n.contactId), at, text, appointmentRef: null }]
    const written = Date.parse(at)
    const sameDay = visits.get(`${n.contactId}|${dayIn(at, timeZone)}`) ?? []
    const best = [...sameDay].sort((a, b) => {
      const byStatus = rank(a) - rank(b)
      if (byStatus) return byStatus
      const after = (e: QuirohiroEvent) => (Date.parse(e.startTime) <= written ? 0 : 1)
      return after(a) - after(b) || Math.abs(written - Date.parse(a.startTime)) - Math.abs(written - Date.parse(b.startTime))
    })[0]
    return [{ ref: qhNoteRef(n.id), patientRef: qhPatientRef(n.contactId), at, text, appointmentRef: best ? qhAppointmentRef(best.id) : null }]
  })
}

// --- money ---------------------------------------------------------------------------------
//
// A clinic that charges through QuiroHiro has its invoices and its payments
// (GoHighLevel "transactions") there; the first clinic charged outside it and
// had neither. They come in as QuiroFlow keeps money: charges (invoices) and
// payments side by side, a patient's balance being what they paid less what
// they were charged. So both sides come in or neither does, and:
//
//   * a QuiroHiro invoice (not a draft, not voided) is a charge, paid or not
//     as QuiroHiro has it;
//   * a payment is a payment, net of what was refunded, on its invoice;
//   * a payment that settles no invoice -- a payment link, an order -- gets a
//     paid receipt of its own, or the patient would read as in credit by it;
//   * an invoice QuiroHiro calls paid by more than the payments it lists (a
//     payment recorded by hand there) gets a payment for the difference;
//   * a line or a payment named "bono" with a number of sessions is a bono
//     charged when it was sold (package_purchases.charged_at_purchase), so
//     the sessions drawn from it charge nothing more.
//
// Only live euros: GoHighLevel keeps test-mode payments beside real ones.

export interface QuirohiroChargeRow {
  ref: string
  patientRef: string
  number: string
  totalCents: number
  createdAt: string
  status: 'paid' | 'unpaid'
  what: string
}
export interface QuirohiroPaymentRow {
  ref: string
  patientRef: string
  amountCents: number
  method: 'card' | 'cash' | 'transfer' | 'other'
  paidAt: string
  chargeRef: string | null
  bonoRef: string | null
}
export interface QuirohiroBonoRow {
  ref: string
  patientRef: string
  name: string
  priceCents: number
  sessionsTotal: number
  purchasedAt: string
  chargeRef: string
}
export interface QuirohiroLedger {
  charges: QuirohiroChargeRow[]
  payments: QuirohiroPaymentRow[]
  bonos: QuirohiroBonoRow[]
  /** Bono lines whose number of sessions the name does not say: charged, but no bono to draw from. */
  bonosWithoutSessions: string[]
  skipped: { notEuro: number; test: number; noContact: number }
  /** Transactions counted in cents rather than euros, worked out from the invoices they paid. */
  transactionsInCents: boolean
}

const cents = (amount: number | null | undefined) => Math.round((Number(amount) || 0) * 100)

/** "Bono 10 sesiones", "BONO 5 ajustes", "Bono de 8": how many sessions a bono's name says it holds. */
export function quirohiroBonoSessions(name: string): number | null | undefined {
  if (!/\bbono/i.test(name)) return undefined
  const n = name.match(/(\d{1,3})\s*(?:x\s*)?(?:ses(?:i[oó]n|iones)?|sesiones|citas?|visitas?|ajustes?|sessions?|visits?)\b/i) ?? name.match(/\bbono\s+(?:de\s+)?(\d{1,3})\b/i)
  const sessions = n ? Number(n[1]) : NaN
  return sessions >= 2 && sessions <= 100 ? sessions : null
}

/** How a QuiroHiro payment was taken, as one of the methods every clinic here has. */
export function quirohiroPaymentMethod(t: Pick<QuirohiroTransaction, 'paymentProviderType' | 'entitySourceName'>): QuirohiroPaymentRow['method'] {
  const provider = (t.paymentProviderType ?? '').toLowerCase()
  if (/stripe|square|authorize|nmi|card|tarjeta/.test(provider)) return 'card'
  if (/cash|efectivo/.test(provider)) return 'cash'
  if (/bank|transfer|ach|sepa/.test(provider)) return 'transfer'
  return 'other'
}

export function quirohiroLedgerRows(s: Pick<QuirohiroSnapshot, 'invoices' | 'transactions'>): QuirohiroLedger {
  const skipped = { notEuro: 0, test: 0, noContact: 0 }
  const usable = <T extends { liveMode?: boolean | null; currency?: string | null }>(x: T) => {
    if (x.liveMode === false) { skipped.test++; return false }
    if (x.currency && x.currency.toUpperCase() !== 'EUR') { skipped.notEuro++; return false }
    return true
  }
  const invoices = (s.invoices ?? []).filter((i) => i.status !== 'draft' && i.status !== 'void' && usable(i))
  const invoiceById = new Map(invoices.map((i) => [i._id, i]))
  const transactions = (s.transactions ?? []).filter((t) => (t.status === 'succeeded' || t.status === 'partially_refunded') && usable(t))

  // GoHighLevel's docs give every amount in the currency's units, but a
  // payment read in cents would make each one a hundred times too large. The
  // invoices say which: a payment of a whole invoice matches its total.
  const ratios = transactions.flatMap((t) => {
    const inv = t.entityType === 'invoice' ? invoiceById.get(t.entityId ?? '') : undefined
    return inv?.total && t.amount ? [t.amount / inv.total] : []
  }).sort((a, b) => a - b)
  const transactionsInCents = ratios.length > 0 && ratios[Math.floor(ratios.length / 2)]! > 50
  const txCents = (amount: number | null | undefined) => (transactionsInCents ? Math.round(Number(amount) || 0) : cents(amount))

  const charges: QuirohiroChargeRow[] = []
  const payments: QuirohiroPaymentRow[] = []
  const bonos: QuirohiroBonoRow[] = []
  const bonosWithoutSessions: string[] = []
  const bonoFrom = (name: string, priceCents: number, patientRef: string, purchasedAt: string, chargeRef: string, key: string) => {
    const sessions = quirohiroBonoSessions(name)
    if (sessions === undefined || priceCents <= 0) return null
    if (sessions === null) { bonosWithoutSessions.push(name); return null }
    const bono: QuirohiroBonoRow = { ref: `QH-bono-${key}`, patientRef, name: name.trim(), priceCents, sessionsTotal: sessions, purchasedAt, chargeRef }
    bonos.push(bono)
    return bono
  }

  const paidOn = new Map<string, number>()
  for (const t of transactions) {
    const inv = t.entityType === 'invoice' ? invoiceById.get(t.entityId ?? '') : undefined
    const contact = t.contactId ?? inv?.contactDetails?.id
    if (!contact) { skipped.noContact++; continue }
    const amountCents = txCents(t.amount) - txCents(t.amountRefunded)
    if (amountCents <= 0) continue
    const paidAt = new Date(t.createdAt ?? Date.now()).toISOString()
    let chargeRef: string
    let bonoRef: string | null = null
    if (inv) {
      chargeRef = `QH-inv-${inv._id}`
      paidOn.set(inv._id, (paidOn.get(inv._id) ?? 0) + amountCents)
    } else {
      // Paid with no invoice to settle: its own paid receipt.
      chargeRef = `QH-sale-${t._id}`
      const what = clean(t.entitySourceName) || clean(t.entitySourceType) || 'QuiroHiro'
      charges.push({ ref: chargeRef, patientRef: qhPatientRef(contact), number: `QHV-${t._id.slice(-8).toUpperCase()}`, totalCents: amountCents, createdAt: paidAt, status: 'paid', what })
      bonoRef = bonoFrom(what, amountCents, qhPatientRef(contact), paidAt, chargeRef, `sale-${t._id}`)?.ref ?? null
    }
    payments.push({ ref: `QH-pay-${t._id}`, patientRef: qhPatientRef(contact), amountCents, method: quirohiroPaymentMethod(t), paidAt, chargeRef, bonoRef })
  }

  for (const inv of invoices) {
    const contact = inv.contactDetails?.id
    if (!contact) { skipped.noContact++; continue }
    const totalCents = cents(inv.total)
    const createdAt = new Date(inv.issueDate ?? inv.createdAt ?? Date.now()).toISOString()
    const ref = `QH-inv-${inv._id}`
    const items = inv.invoiceItems ?? []
    const paid = inv.status === 'paid' || (totalCents > 0 && inv.amountDue != null && cents(inv.amountDue) <= 0)
    charges.push({
      ref, patientRef: qhPatientRef(contact), number: `QHI-${clean(String(inv.invoiceNumber ?? '')) || inv._id.slice(-8).toUpperCase()}`,
      totalCents, createdAt, status: paid ? 'paid' : 'unpaid', what: items.map((i) => clean(i.name)).filter(Boolean).join(', ') || 'QuiroHiro',
    })
    items.forEach((item, n) => bonoFrom(clean(item.name), cents(item.amount) * Math.max(1, Number(item.qty) || 1), qhPatientRef(contact), createdAt, ref, `${inv._id}-${n}`))
    // Paid by more than the payments QuiroHiro lists for it: the rest was recorded by hand.
    const gap = cents(inv.amountPaid) - (paidOn.get(inv._id) ?? 0)
    if (gap > 0) payments.push({ ref: `QH-invpay-${inv._id}`, patientRef: qhPatientRef(contact), amountCents: gap, method: 'other', paidAt: new Date(inv.updatedAt ?? createdAt).toISOString(), chargeRef: ref, bonoRef: null })
  }
  return { charges, payments, bonos, bonosWithoutSessions, skipped, transactionsInCents }
}

/**
 * How many of a bono's sessions are gone: the patient's visits that took
 * place from the day it was bought, each patient's bonos used up oldest
 * first. QuiroHiro keeps no count of its own, so this is the best there is,
 * and the step says so.
 */
export function quirohiroBonoSessionsUsed(bonos: QuirohiroBonoRow[], visits: { patientRef: string; startsAt: string; status: string }[]): Map<string, number> {
  const used = new Map<string, number>()
  const byPatient = new Map<string, QuirohiroBonoRow[]>()
  for (const b of [...bonos].sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt))) byPatient.set(b.patientRef, [...(byPatient.get(b.patientRef) ?? []), b])
  for (const [patientRef, list] of byPatient) {
    const attended = visits.filter((v) => v.patientRef === patientRef && v.status === 'completed').map((v) => v.startsAt).sort()
    for (const at of attended) {
      const bono = list.find((b) => b.purchasedAt.slice(0, 10) <= at.slice(0, 10) && (used.get(b.ref) ?? 0) < b.sessionsTotal)
      if (bono) used.set(bono.ref, (used.get(bono.ref) ?? 0) + 1)
    }
  }
  return used
}
