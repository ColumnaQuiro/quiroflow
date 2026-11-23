// The patient's activity timeline on the record's Overview: what happened to
// them, newest first -- visits, messages both ways, calls logged from
// Recalls, care plans, home exercises, documents and invoices -- each with
// what kind of thing it was, the channel, and who did it (a team member, the
// patient, or the system). The PracticeHub patient timeline, from the rows
// QuiroFlow already keeps.
//
// Pure: usePatientTimeline fetches, this turns rows into events, so the
// wording and ordering are pinned in tests/unit/patient-timeline.test.ts.
import { carePlanCadenceLabel } from './carePlanCadence'

export type TimelineCategory = 'visit' | 'communication' | 'recall' | 'note' | 'plan' | 'exercise' | 'document' | 'billing'
export type TimelineActor = { kind: 'staff'; name: string } | { kind: 'patient' } | { kind: 'system' } | { kind: 'import' }

export interface TimelineEvent {
  key: string
  at: string
  category: TimelineCategory
  text: string
  /** WhatsApp, Email, Push... when it was a message. */
  channel?: string
  actor: TimelineActor
  tone?: 'success' | 'warning' | 'danger'
}

type T = (en: string, es: string) => string

export interface TimelineSources {
  now: Date
  timeZone: string
  staffNames: Record<string, string>
  appointments: { id: string; starts_at: string; created_at: string; status: string; appointment_types: { name: string } | null }[]
  sent: { id: string; channel: string; kind: string; status: string | null; preview: string | null; sent_at: string }[]
  received: { id: string; channel: string; at: string; preview: string | null }[]
  calls: { id: string; action: string; note: string | null; created_at: string; created_by: string | null; external_reference?: string | null }[]
  plans: { id: string; name: string; created_at: string; created_by: string | null; frequency_value: number; frequency_unit: string; visits_per_period?: number | null; total_visits: number | null }[]
  exercises: { id: string; created_at: string; ended_at: string | null; assigned_by: string | null; exercises: { name: string } | null }[]
  documents: { id: string; title: string; created_at: string; completed_at: string | null; created_by: string | null }[]
  invoices: { id: string; created_at: string; invoice_number: string | null; status: string }[]
}

// The importers bring a clinic's history from its previous software into
// contact_log -- the one patient-keyed table with free text and a date --
// as action 'other' with their own external_reference: a QuiroHiro record
// ("QH-ficha-") and its day notes ("QH-note-"), PracticeHub care plans and
// log entries ("PH-careplan-", "PH-log-"), Quirocitas' history, plans,
// anamnesis and invoice notes ("QC-..."). None of them is a recall and
// nobody was contacted, yet that is what an 'other' row read as. A
// Quirocitas call ("QC-call-") really was one, so it stays a call.
const IMPORT_SOURCES: Record<string, string> = { 'QH-': 'QuiroHiro', 'PH-': 'PracticeHub', 'QC-': 'Quirocitas' }

/** The system a contact-history row was imported from when it is a note brought over, not a call; null for anything logged here. */
export function importedNoteSource(row: { action: string; external_reference?: string | null }): string | null {
  const ref = row.external_reference
  if (row.action !== 'other' || !ref || ref.startsWith('QC-call-')) return null
  return IMPORT_SOURCES[ref.slice(0, 3)] ?? null
}

const CHANNELS: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', email: 'Email', app: 'App', push: 'Push' }

export function buildPatientTimeline(s: TimelineSources, t: T): TimelineEvent[] {
  const staff = (id: string | null): TimelineActor => (id && s.staffNames[id] ? { kind: 'staff', name: s.staffNames[id] } : { kind: 'system' })
  const day = (iso: string) => new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: s.timeZone })
  const out: TimelineEvent[] = []

  for (const a of s.appointments) {
    const type = a.appointment_types?.name ?? t('Visit', 'Visita')
    // Booked: when it was made, saying for when.
    out.push({ key: `appt-b-${a.id}`, at: a.created_at, category: 'visit', text: t(`${type} booked for ${day(a.starts_at)}`, `${type} reservada para el ${day(a.starts_at)}`), actor: { kind: 'system' } })
    // What happened, once it has.
    if (new Date(a.starts_at) <= s.now) {
      if (a.status === 'completed') out.push({ key: `appt-c-${a.id}`, at: a.starts_at, category: 'visit', text: t(`${type} attended`, `${type} realizada`), actor: { kind: 'patient' }, tone: 'success' })
      else if (a.status === 'no_show') out.push({ key: `appt-n-${a.id}`, at: a.starts_at, category: 'visit', text: t(`Missed ${type.toLowerCase()}`, `No asistió a ${type.toLowerCase()}`), actor: { kind: 'patient' }, tone: 'danger' })
    }
    if (a.status === 'cancelled') out.push({ key: `appt-x-${a.id}`, at: a.starts_at, category: 'visit', text: t(`${type} on ${day(a.starts_at)} cancelled`, `${type} del ${day(a.starts_at)} cancelada`), actor: { kind: 'system' }, tone: 'warning' })
  }

  for (const m of s.sent) {
    const failed = m.status === 'failed' || m.status === 'bounced'
    out.push({
      key: `sent-${m.channel}-${m.id}`,
      at: m.sent_at,
      category: 'communication',
      text: m.preview?.trim() || t('Message sent', 'Mensaje enviado'),
      channel: CHANNELS[m.channel] ?? m.channel,
      actor: { kind: 'system' },
      ...(failed ? { tone: 'danger' as const } : {}),
    })
  }
  for (const m of s.received) {
    out.push({ key: `recv-${m.channel}-${m.id}`, at: m.at, category: 'communication', text: m.preview?.trim() || t('Wrote to the clinic', 'Escribió a la clínica'), channel: CHANNELS[m.channel] ?? m.channel, actor: { kind: 'patient' } })
  }

  const CALLS: Record<string, [string, string]> = {
    called_no_answer: ['Called, no answer', 'Llamada sin respuesta'],
    called_left_message: ['Called and left a voicemail', 'Llamada, dejó un mensaje'],
    sent_whatsapp: ['Sent a WhatsApp', 'Envió un WhatsApp'],
    booked: ['Called and booked', 'Llamada y cita reservada'],
    other: ['Contacted', 'Contacto'],
  }
  for (const c of s.calls) {
    const source = importedNoteSource(c)
    if (source) {
      // The note whole, line breaks and all: ActivityTimeline keeps them.
      out.push({ key: `note-${c.id}`, at: c.created_at, category: 'note', text: c.note?.trim() || t('Imported note', 'Nota importada'), channel: source, actor: { kind: 'import' } })
      continue
    }
    const [en, es] = CALLS[c.action] ?? CALLS.other
    out.push({ key: `call-${c.id}`, at: c.created_at, category: 'recall', text: c.note ? `${t(en, es)} · ${c.note}` : t(en, es), actor: staff(c.created_by) })
  }

  for (const p of s.plans) {
    const length = p.total_visits === null ? t('no end', 'sin fin') : t(`${p.total_visits} visits`, `${p.total_visits} visitas`)
    out.push({ key: `plan-${p.id}`, at: p.created_at, category: 'plan', text: t(`Care plan "${p.name}" started: ${length}, ${carePlanCadenceLabel(p, t)}`, `Plan «${p.name}» iniciado: ${length}, ${carePlanCadenceLabel(p, t)}`), actor: staff(p.created_by) })
  }

  for (const e of s.exercises) {
    const name = e.exercises?.name ?? t('an exercise', 'un ejercicio')
    out.push({ key: `ex-a-${e.id}`, at: e.created_at, category: 'exercise', text: t(`Home exercise assigned: ${name}`, `Ejercicio para casa asignado: ${name}`), actor: staff(e.assigned_by) })
    if (e.ended_at) out.push({ key: `ex-e-${e.id}`, at: e.ended_at, category: 'exercise', text: t(`Home exercise stopped: ${name}`, `Ejercicio para casa retirado: ${name}`), actor: { kind: 'system' } })
  }

  for (const d of s.documents) {
    out.push({ key: `doc-s-${d.id}`, at: d.created_at, category: 'document', text: t(`Document sent: ${d.title}`, `Documento enviado: ${d.title}`), actor: staff(d.created_by) })
    if (d.completed_at) out.push({ key: `doc-c-${d.id}`, at: d.completed_at, category: 'document', text: t(`Document signed: ${d.title}`, `Documento firmado: ${d.title}`), actor: { kind: 'patient' }, tone: 'success' })
  }

  for (const i of s.invoices) {
    if (i.status === 'void') continue
    const n = i.invoice_number ?? ''
    out.push({ key: `inv-${i.id}`, at: i.created_at, category: 'billing', text: i.status === 'paid' ? t(`Invoice ${n} paid`, `Factura ${n} pagada`) : t(`Invoice ${n} issued`, `Factura ${n} emitida`), actor: { kind: 'system' }, ...(i.status === 'paid' ? { tone: 'success' as const } : {}) })
  }

  // Newest first; nothing from the future (a visit booked ahead shows as
  // booked, not as attended).
  return out.filter((e) => new Date(e.at) <= s.now).sort((a, b) => b.at.localeCompare(a.at))
}
