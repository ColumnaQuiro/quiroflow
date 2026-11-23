import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TablesInsert, TablesUpdate } from '~/types/database.types'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { matchIncomingAppointments, type HeldReason, type IncomingAppointment } from '~/utils/importAppointmentMatch'
import { quiroflowKeeps, type KeptReason } from '~/utils/importAppointmentGuard'
import { practiceHubAppointmentRows, practiceHubWallClock, type PHApiAppointment, type PHApiPatient, type PHNamed } from '~/utils/practicehubApiRows'
import { practiceHubList, type PracticeHubPlan, type PracticeHubStepPlanner } from '~/utils/practicehubImport/types'

// The Appointments step of a PracticeHub import, run on the server
// (server/utils/importJobs.ts) from the copy of PracticeHub's Classic API in
// import_snapshots. It is components/import/PracticeHubAppointmentsImporter.vue
// with the screen taken away: the same matching (utils/importAppointmentMatch.ts),
// the same guard (utils/importAppointmentGuard.ts), the same fields
// overwritten. Run twice, it finds what it wrote the first time by
// PracticeHub's appointment id and writes only what changed.
//
// The browser screen asks two things the server cannot: which team member
// each PracticeHub practitioner is, and which appointment type each type name
// is. The server takes a team member whose name is the same, ignoring case
// and outer spaces, and the type practiceHubTypeMatches gives: the one that
// type's visits already have here, else the same name. For a name with no
// match it takes what the screen leaves selected: the practitioner's name
// only (practitioner_name, no team member) and no type. The Appointment types
// step runs after this one and creates the missing types and points these
// visits at them, so nothing is lost by not creating them here.

// --- rules shared with the browser importer --------------------------------------

// A re-import matching an existing appointment overwrites these from
// PracticeHub -- unless QuiroFlow has acted on the visit (moved it, or
// recorded what happened at it), in which case QuiroFlow's version stands and
// the row is listed as kept (utils/importAppointmentGuard.ts). Deliberately never
// touched: `rescheduled` (keeps a detected time change silent -- no
// reschedule automation fires for a bulk historical sync), `note`,
// `external_reference`, `created_at`, `room_id`, and all QuiroFlow-native
// confirmation/reminder/check-in/flow timestamps. The one exception to
// `external_reference` is a visit adopted by a re-created PracticeHub
// appointment (utils/importAppointmentMatch.ts): it takes the new id, so the
// next run and the ledger import find it by id.
export const PRACTICEHUB_APPOINTMENT_OVERWRITE_FIELDS = ['starts_at', 'ends_at', 'status', 'practitioner_id', 'practitioner_name', 'appointment_type_id'] as const
export type AppointmentOverwritable = Pick<TablesInsert<'appointments'>, (typeof PRACTICEHUB_APPOINTMENT_OVERWRITE_FIELDS)[number]>

export const APPOINTMENT_DATE_FIELDS = new Set(['starts_at', 'ends_at'])

export interface FieldDiff { field: string; from: string; to: string }

/** PracticeHub's appointment status as QuiroFlow's. */
export function practiceHubAppointmentStatus(raw: string): string {
  switch (raw.trim().toLowerCase()) {
    case 'processed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    case 'missed':
      return 'no_show'
    default:
      return 'booked' // pending, arrived
  }
}

// starts_at/ends_at come back from Supabase as Postgres's own timestamptz
// serialization (e.g. "2023-11-06T15:00:00+00:00"), while the freshly-parsed
// CSV value here is JS's toISOString() format (e.g.
// "2023-11-06T15:00:00.000Z") -- same instant, different string, so a plain
// `!==` flagged every single appointment as changed regardless of whether
// its time actually moved.
export function appointmentValuesDiffer(field: string, value: unknown, existingValue: unknown): boolean {
  if (APPOINTMENT_DATE_FIELDS.has(field)) return new Date(value as string).getTime() !== new Date(existingValue as string).getTime()
  return value !== existingValue
}

/**
 * The fields PracticeHub would change on a visit already here, and how each
 * reads before and after (`shown` names a value the way the screen shows it).
 * A blank in PracticeHub never clears a value here.
 */
export function appointmentFieldUpdate(
  existing: AppointmentOverwritable,
  incoming: AppointmentOverwritable,
  shown: (field: string, value: unknown) => string,
): { updates: TablesUpdate<'appointments'>; diff: FieldDiff[] } {
  const updates: TablesUpdate<'appointments'> = {}
  const diff: FieldDiff[] = []
  for (const field of PRACTICEHUB_APPOINTMENT_OVERWRITE_FIELDS) {
    const value = incoming[field]
    if (value === null || value === undefined || value === '') continue
    const existingValue = existing[field]
    if (appointmentValuesDiffer(field, value, existingValue)) {
      ;(updates as Record<string, unknown>)[field] = value
      diff.push({ field, from: shown(field, existingValue), to: shown(field, value) })
    }
  }
  return { updates, diff }
}

/**
 * The browser screen's pre-selection for a name: the item whose name is the
 * same, ignoring case and the spaces around it. The first one wins when two
 * share a name, so callers pass them in a fixed order (and the Appointment
 * types step, reading types the same way, picks the same twin -- otherwise
 * each sync would move visits from one to the other and back).
 */
export function byExactName<T>(items: readonly T[], nameOf: (item: T) => string | null | undefined): (name: string | null | undefined) => T | undefined {
  const map = new Map<string, T>()
  for (const item of items) {
    const key = (nameOf(item) ?? '').trim().toLowerCase()
    if (key && !map.has(key)) map.set(key, item)
  }
  return (name) => {
    const key = (name ?? '').trim().toLowerCase()
    return key ? map.get(key) : undefined
  }
}

/**
 * Which type here each PracticeHub appointment type is, by PracticeHub's type
 * id. Pure.
 *
 * First the type its visits already have here: the one more than half of
 * them point at. Only a PracticeHub type with no such majority -- none of its
 * visits here yet, or spread between types -- falls back to the same name
 * (byExactName). A type renamed here keeps its visits that way: matched by
 * name alone, the next sync found no "Primera visita" once the clinic had
 * called it "Consulta inicial", created a second one and moved every visit
 * back to it. The same holds for two types merged here: the visits moved to
 * the survivor say which one it is.
 *
 * Both steps call this with the same inputs, and they must: the Appointments
 * step runs first in a full sync, and by name alone it would already have
 * cleared the type off those visits before the Appointment types step looked.
 */
export function practiceHubTypeMatches<T extends { id: string; name: string }>(input: {
  phTypes: readonly { id: number | string; name?: string | null }[]
  phAppointments: readonly { id: number | string; appointment_type_id?: number | string | null }[]
  /** In the order byExactName needs: a twin name resolves to the first. */
  typesHere: readonly T[]
  visitsHere: readonly { external_reference: string | null; appointment_type_id: string | null }[]
}): Map<string, T | undefined> {
  const typeById = new Map(input.typesHere.map((ty) => [ty.id, ty]))
  const typeNamed = byExactName(input.typesHere, (ty) => ty.name)

  // Ids arrive as numbers from one list and strings from another, so they
  // are compared as text.
  const typesOfRef = new Map<string, string[]>()
  for (const v of input.visitsHere) {
    if (!v.external_reference || !v.appointment_type_id || !typeById.has(v.appointment_type_id)) continue
    const list = typesOfRef.get(v.external_reference)
    if (list) list.push(v.appointment_type_id)
    else typesOfRef.set(v.external_reference, [v.appointment_type_id])
  }
  const tally = new Map<string, Map<string, number>>()
  for (const appt of input.phAppointments) {
    const phTypeId = appt.appointment_type_id == null ? '' : String(appt.appointment_type_id)
    const ours = phTypeId ? typesOfRef.get(String(appt.id)) : undefined
    if (!ours) continue
    const counts = tally.get(phTypeId) ?? new Map<string, number>()
    for (const id of ours) counts.set(id, (counts.get(id) ?? 0) + 1)
    tally.set(phTypeId, counts)
  }

  const matches = new Map<string, T | undefined>()
  for (const phType of input.phTypes) {
    const phTypeId = String(phType.id)
    const counts = tally.get(phTypeId)
    let leader: string | undefined
    if (counts) {
      const total = [...counts.values()].reduce((sum, n) => sum + n, 0)
      for (const [id, n] of counts) if (n * 2 > total) leader = id
    }
    matches.set(phTypeId, leader ? typeById.get(leader) : typeNamed(phType.name))
  }
  return matches
}

// --- the plan, without the database ----------------------------------------------

/** A visit already here, as the step reads it. */
export interface AppointmentHereRow {
  id: string
  external_reference: string | null
  patient_id: string
  clinic_id: string | null
  starts_at: string
  ends_at: string
  status: string
  rescheduled: boolean
  checked_in_at: string | null
  practitioner_id: string | null
  practitioner_name: string | null
  appointment_type_id: string | null
}

export interface PlannedInsert { ref: string; startsAt: string; appointment: TablesInsert<'appointments'>; note: string | null }
export interface PlannedUpdate { id: string; ref: string; startsAt: string; adopted: boolean; updates: TablesUpdate<'appointments'>; diff: FieldDiff[]; note: string | null }
export interface PlannedHeld { ref: string; patientRef: string; startsAt: string; reason: HeldReason }
export interface PlannedKept { ref: string; here: { startsAt: string; status: string }; practiceHub: { startsAt: string; status: string }; reason: KeptReason }

export interface AppointmentRowsPlan {
  inserts: PlannedInsert[]
  updates: PlannedUpdate[]
  held: PlannedHeld[]
  kept: PlannedKept[]
  skippedNoPatient: number
  skippedUnchanged: number
  skippedInvalidDate: number
}

/**
 * What the step would do with each PracticeHub appointment row (the CSV
 * export's shape, practiceHubAppointmentRows): insert it, update the visit it
 * is, keep QuiroFlow's version, hold it back, or skip it. Pure; the planner
 * reads the database and writes.
 */
export function planPracticeHubAppointmentRows(input: {
  rows: Record<string, string>[]
  /** patients.external_reference -> patients.id */
  patientByRef: Map<string, string>
  /** Every appointment in the account, not only imported ones. */
  existing: AppointmentHereRow[]
  accountId: string
  clinicId: string
  timeZone: string
  practitionerIdFor: (name: string) => string | null
  /** The type for a row's type name; `ref` is its PracticeHub appointment id. */
  typeIdFor: (name: string, ref: string) => string | null
  shown?: (field: string, value: unknown) => string
}): AppointmentRowsPlan {
  const { rows, patientByRef, accountId, clinicId, timeZone } = input
  const shown = input.shown ?? ((_f: string, v: unknown) => (v === null || v === undefined ? '' : String(v)))
  const existingById = new Map(input.existing.map((a) => [a.id, a]))
  const existingRefs = new Set(input.existing.map((a) => a.external_reference).filter(Boolean))

  const plan: AppointmentRowsPlan = { inserts: [], updates: [], held: [], kept: [], skippedNoPatient: 0, skippedUnchanged: 0, skippedInvalidDate: 0 }

  const refOf = (row: Record<string, string>) => row['Internal Appt ID']?.trim() || row['Imported Appt ID']?.trim() || ''
  // Every id PracticeHub still has, including rows that cannot be used: a row
  // with a bad date still proves its id is live.
  const refsInFile = new Set(rows.map(refOf).filter(Boolean))

  const parsed: { index: number; row: Record<string, string>; extRef: string; patientId: string | undefined; start: Date; end: Date }[] = []
  rows.forEach((row, index) => {
    const extRef = refOf(row)
    const patientRef = row['Patient Number']?.trim()
    const patientId = patientRef ? patientByRef.get(patientRef) : undefined
    if (!existingRefs.has(extRef) && !patientId) {
      plan.skippedNoPatient++
      return
    }
    // The clinic's wall clock, read in the clinic's time zone -- not the
    // server's (UTC), which would put every visit an hour or two out.
    const start = practiceHubWallClock(row['Start'], timeZone)
    const end = practiceHubWallClock(row['End'], timeZone)
    if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
      plan.skippedInvalidDate++
      return
    }
    parsed.push({ index, row, extRef, patientId, start, end })
  })

  const incoming: IncomingAppointment[] = parsed.map((p) => ({
    key: p.index,
    ref: p.extRef || null,
    patientId: p.patientId ?? null,
    startsAt: p.start.toISOString(),
    endsAt: p.end.toISOString(),
    status: practiceHubAppointmentStatus(p.row['Status'] || ''),
  }))
  const matches = matchIncomingAppointments(incoming, input.existing.map((a) => ({
    id: a.id,
    patientId: a.patient_id,
    clinicId: a.clinic_id,
    externalReference: a.external_reference,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    status: a.status,
  })), refsInFile, clinicId, timeZone)

  for (const { index, row, extRef, patientId, start, end } of parsed) {
    const match = matches.get(index)!
    if (match.kind === 'held') {
      plan.held.push({ ref: extRef, patientRef: row['Patient Number']?.trim() || '', startsAt: start.toISOString(), reason: match.reason })
      continue
    }
    const existing = match.kind === 'insert' ? undefined : existingById.get(match.existingId)

    const practName = row['Practitioner']?.trim() || ''
    const typeName = row['Appointment Type']?.trim() || ''
    const note = row['Note']?.trim() || null
    const status = practiceHubAppointmentStatus(row['Status'] || '')

    if (!existing) {
      plan.inserts.push({
        ref: extRef,
        startsAt: start.toISOString(),
        note,
        appointment: {
          account_id: accountId,
          clinic_id: clinicId,
          patient_id: patientId!,
          practitioner_id: (practName && input.practitionerIdFor(practName)) || null,
          practitioner_name: practName || null,
          appointment_type_id: (typeName && input.typeIdFor(typeName, extRef)) || null,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          status,
          external_reference: extRef || null,
        },
      })
      continue
    }

    const incomingFields: AppointmentOverwritable = {
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status,
      practitioner_id: (practName && input.practitionerIdFor(practName)) || null,
      practitioner_name: practName || null,
      appointment_type_id: (typeName && input.typeIdFor(typeName, extRef)) || null,
    }
    let { updates, diff } = appointmentFieldUpdate(existing, incomingFields, shown)
    const keptReason = quiroflowKeeps(
      { status: existing.status, rescheduled: existing.rescheduled, checkedInAt: existing.checked_in_at },
      diff.map((d) => d.field),
    )
    if (keptReason) {
      plan.kept.push({
        ref: extRef,
        here: { startsAt: existing.starts_at, status: existing.status },
        practiceHub: { startsAt: start.toISOString(), status },
        reason: keptReason,
      })
      updates = {}
      diff = []
    }
    // An adopted visit still takes the new id when its fields are kept, so
    // the next run and the ledger import find it.
    const adopted = match.kind === 'adopt'
    if (adopted) {
      updates.external_reference = extRef
      diff.unshift({ field: 'external_reference', from: shown('external_reference', existing.external_reference), to: extRef })
    }
    if (Object.keys(updates).length === 0) {
      if (!keptReason) plan.skippedUnchanged++
      continue
    }
    plan.updates.push({ id: existing.id, ref: extRef, startsAt: start.toISOString(), adopted, updates, diff, note })
  }
  return plan
}

// --- reading and writing ----------------------------------------------------------

type Admin = SupabaseClient<Database>

export const PRACTICEHUB_PAGE = 1000

export async function withConcurrency<T>(items: T[], n: number, run: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (let x; (x = queue.shift()) !== undefined;) await run(x) }))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Where each of `n` equal slices of the uuid space begins. Postgres orders uuids as their hex reads, so these compare as ids do. */
export function uuidSliceStarts(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${Math.floor((i * 2 ** 32) / n).toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`)
}

/**
 * Every row of `table` in the account, 1,000 at a time (PostgREST stops at
 * 1,000 without saying so), in id order. Service role: the account filter is
 * the only thing keeping another clinic's rows out.
 *
 * A table that fits in one page is one request. A larger one is NOT read with
 * `offset`: Postgres has to fetch every row an offset skips before it can
 * skip it, so page sixty of a clinic's appointments read sixty thousand rows
 * to return a thousand -- ~70,000 buffers a page on production, six pages at
 * a time, and the heaviest thing the database did (23 Nov 2026). Ids are
 * random uuids, so the id space is cut into equal slices of roughly a page
 * each instead, and every slice is read from where it starts: each request
 * touches the rows it returns and no others, and they still go several at a
 * time. A slice that holds more than a page is continued from its last id, so
 * nothing depends on the ids actually being evenly spread -- only the number
 * of requests does.
 */
export async function readAllForAccount<T>(
  supabase: Admin,
  accountId: string,
  table: string,
  columns: string,
  refine?: (q: any) => any,
): Promise<T[]> {
  // Slices are continued from the last id read, so the id is always asked for
  // and taken off again when the caller did not.
  const asksForId = columns.split(',').some((c) => c.trim() === 'id')
  const selected = asksForId ? columns : `id, ${columns}`
  const strip = (rows: any[]): T[] => (asksForId ? rows : rows.map(({ id: _id, ...rest }) => rest)) as T[]
  const query = (count: boolean) => {
    const q = (supabase.from(table as never) as any).select(selected, count ? { count: 'exact' } : undefined).eq('account_id', accountId)
    return refine ? refine(q) : q
  }
  const page = async (from: number, count: boolean) => {
    const { data, error, count: total } = await query(count).order('id').range(from, from + PRACTICEHUB_PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    return { rows: (data ?? []) as any[], total: total as number | null | undefined }
  }
  const first = await page(0, true)
  if (first.rows.length < PRACTICEHUB_PAGE) return strip(first.rows)

  // No count, or ids that are not uuids: by offset, as before.
  if (first.total == null || !UUID.test(String(first.rows[0]?.id))) {
    const pages: any[][] = [first.rows]
    if (first.total == null) {
      for (let from = PRACTICEHUB_PAGE; ; from += PRACTICEHUB_PAGE) {
        const next = await page(from, false)
        pages.push(next.rows)
        if (next.rows.length < PRACTICEHUB_PAGE) break
      }
      return strip(pages.flat())
    }
    const starts: number[] = []
    for (let from = PRACTICEHUB_PAGE; from < first.total; from += PRACTICEHUB_PAGE) starts.push(from)
    await withConcurrency(starts, 6, async (from) => { pages[from / PRACTICEHUB_PAGE] = (await page(from, false)).rows })
    return strip(pages.flat())
  }

  // Aim under a page per slice, so that most slices are one request.
  const starts = uuidSliceStarts(Math.ceil(first.total / (PRACTICEHUB_PAGE * 0.7)))
  const slices: any[][] = []
  await withConcurrency(starts.map((_, i) => i), 6, async (i) => {
    const rows: any[] = []
    for (let after: string | null = null; ;) {
      let q = query(false)
      q = after ? q.gt('id', after) : q.gte('id', starts[i])
      if (i + 1 < starts.length) q = q.lt('id', starts[i + 1])
      const { data, error } = await q.order('id').limit(PRACTICEHUB_PAGE)
      if (error) throw new Error(`${table}: ${error.message}`)
      rows.push(...(data ?? []))
      if (!data || data.length < PRACTICEHUB_PAGE) break
      after = String(data[data.length - 1].id)
    }
    slices[i] = rows
  })
  return strip(slices.flat())
}

/** The clinic's time zone, which PracticeHub's appointment times are the wall clock of. */
export async function practiceHubClinicZone(supabase: Admin, accountId: string, clinicId: string | null): Promise<string> {
  if (!clinicId) return DEFAULT_CLINIC_TIMEZONE
  const { data, error } = await supabase.from('clinics').select('timezone').eq('id', clinicId).eq('account_id', accountId).maybeSingle()
  if (error) throw new Error(`clinics: ${error.message}`)
  return data?.timezone || DEFAULT_CLINIC_TIMEZONE
}

/** Appointment types here, oldest id first so a twin name always resolves to the same one. */
export async function practiceHubTypesHere(supabase: Admin, accountId: string) {
  const { data, error } = await supabase.from('appointment_types').select('id, name, default_price_cents').eq('account_id', accountId).order('id')
  // Read wrong, every type here would look new and be created a second time.
  if (error) throw new Error(`appointment_types: ${error.message}`)
  return data ?? []
}

const errText = (e: unknown) => (e as { message?: string })?.message ?? String(e)

export const planAppointments: PracticeHubStepPlanner = async (ctx, snapshot): Promise<PracticeHubPlan> => {
  const { supabase, accountId, clinicId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')

  const phAppointments = practiceHubList<PHApiAppointment>(snapshot, '/appointments')
  const rows = practiceHubAppointmentRows(phAppointments, {
    patients: practiceHubList<PHApiPatient>(snapshot, '/patients'),
    practitioners: practiceHubList<PHNamed>(snapshot, '/practitioners'),
    appointmentTypes: practiceHubList<PHNamed>(snapshot, '/appointment_types'),
  })

  const [zone, teamRes, typeRows, patients, existing] = await Promise.all([
    practiceHubClinicZone(supabase, accountId, clinicId),
    supabase.from('team_members').select('id, full_name, deleted_at').eq('account_id', accountId).order('id'),
    practiceHubTypesHere(supabase, accountId),
    readAllForAccount<{ id: string; external_reference: string }>(supabase, accountId, 'patients', 'id, external_reference', (q) => q.not('external_reference', 'is', null)),
    // Every appointment, not only imported ones: a visit entered here carries
    // no PracticeHub id and can still be the one a re-created appointment
    // describes.
    readAllForAccount<AppointmentHereRow>(supabase, accountId, 'appointments', 'id, external_reference, patient_id, clinic_id, starts_at, ends_at, status, rescheduled, checked_in_at, practitioner_id, practitioner_name, appointment_type_id'),
  ])
  if (teamRes.error) throw new Error(`team_members: ${teamRes.error.message}`)
  // Someone on the team now wins a shared name over someone who has left.
  const team = [...(teamRes.data ?? [])].sort((a, b) => Number(!!a.deleted_at) - Number(!!b.deleted_at))
  const memberNamed = byExactName(team, (m) => m.full_name)
  // By PracticeHub's type id, the same answer the Appointment types step gets,
  // so a type renamed or merged here is not cleared off its visits.
  const typeMatches = practiceHubTypeMatches({
    phTypes: practiceHubList<PHNamed>(snapshot, '/appointment_types'),
    phAppointments,
    typesHere: typeRows,
    visitsHere: existing,
  })
  const phTypeOfRef = new Map(phAppointments.map((a) => [String(a.id), a.appointment_type_id == null ? '' : String(a.appointment_type_id)]))
  const typeNamed = byExactName(typeRows, (ty) => ty.name)
  const typeFor = (name: string, ref: string) => {
    const phTypeId = phTypeOfRef.get(ref)
    return phTypeId && typeMatches.has(phTypeId) ? typeMatches.get(phTypeId) : typeNamed(name)
  }
  const teamName = new Map(team.map((m) => [m.id, m.full_name]))
  const typeName = new Map(typeRows.map((ty) => [ty.id, ty.name]))
  const patientByRef = new Map(patients.map((p) => [p.external_reference, p.id]))

  const when = (at: string) => new Date(at).toLocaleString('es-ES', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' })
  const statusLabel = (status: string) =>
    status === 'completed' ? t('completed', 'completada') : status === 'cancelled' ? t('cancelled', 'cancelada') : status === 'no_show' ? t('no-show', 'no presentado') : t('booked', 'reservada')
  const blank = () => t('(blank)', '(vacío)')
  const shown = (field: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return blank()
    if (APPOINTMENT_DATE_FIELDS.has(field)) return when(value as string)
    if (field === 'status') return statusLabel(String(value))
    if (field === 'practitioner_id') return teamName.get(value as string) ?? String(value)
    if (field === 'appointment_type_id') return typeName.get(value as string) ?? String(value)
    return String(value)
  }
  const fieldLabel = (field: string) => {
    switch (field) {
      case 'starts_at': return t('Start', 'Inicio')
      case 'ends_at': return t('End', 'Fin')
      case 'status': return t('Status', 'Estado')
      case 'practitioner_id': return t('Team member', 'Miembro del equipo')
      case 'practitioner_name': return t('Practitioner', 'Profesional')
      case 'appointment_type_id': return t('Appointment type', 'Tipo de cita')
      case 'external_reference': return t('PracticeHub reference', 'Referencia de PracticeHub')
      default: return field
    }
  }
  const keptReasonLabel = (reason: KeptReason) =>
    reason === 'moved_here' ? t('Moved in QuiroFlow', 'Movida en QuiroFlow') : t('Already checked in, completed, missed or cancelled here', 'Ya registrada, completada, no presentada o cancelada aquí')
  const heldReasonLabel = (reason: HeldReason) =>
    reason === 'several' ? t('Several visits here that day could be this one', 'Varias visitas de ese día podrían ser esta')
      : reason === 'contested' ? t('Another PracticeHub appointment matches the same visit', 'Otra cita de PracticeHub coincide con la misma visita')
        : t("PracticeHub moved this visit's id to another day or patient and re-created the visit", 'PracticeHub movió el id de esta visita a otro día o paciente y recreó la visita')

  const plan = planPracticeHubAppointmentRows({
    rows,
    patientByRef,
    existing,
    accountId,
    clinicId: clinicId ?? '',
    timeZone: zone,
    practitionerIdFor: (name) => memberNamed(name)?.id ?? null,
    typeIdFor: (name, ref) => typeFor(name, ref)?.id ?? null,
    shown,
  })

  // visit_notes are additive-only on an update -- never overwrite a note a
  // practitioner already wrote for this appointment. Only the updates
  // carrying a note need asking about.
  const withNote = plan.updates.filter((u) => u.note).map((u) => u.id)
  const noted = new Set<string>()
  for (let i = 0; i < withNote.length; i += 200) {
    const { data, error } = await supabase.from('visit_notes').select('appointment_id').eq('account_id', accountId).in('appointment_id', withNote.slice(i, i + 200))
    if (error) throw new Error(`visit_notes: ${error.message}`)
    for (const n of data ?? []) noted.add(n.appointment_id)
  }
  for (const u of plan.updates) if (noted.has(u.id)) u.note = null

  // Names this clinic has no team member or type for, and how many of
  // PracticeHub's appointments carry each.
  const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  const unlinkedPractitioners = new Map<string, number>()
  const untypedNames = new Map<string, number>()
  for (const r of rows) {
    const p = r['Practitioner']?.trim()
    if (p && !memberNamed(p)) count(unlinkedPractitioners, p)
    const ty = r['Appointment Type']?.trim()
    if (ty && !typeFor(ty, r['Internal Appt ID']?.trim() || '')) count(untypedNames, ty)
  }

  const adopted = plan.updates.filter((u) => u.adopted).length
  const noClinic = !clinicId
  const { inserts, updates, held, kept } = plan

  return {
    stats: [
      { label: t('Will import', 'Se importarán'), value: nf.format(inserts.length), tone: 'good' },
      { label: t('Will update', 'Se actualizarán'), value: nf.format(updates.length), tone: 'good' },
      { label: t('Re-created in PracticeHub, already here', 'Recreadas en PracticeHub, ya aquí'), value: nf.format(adopted) },
      { label: t('QuiroFlow version kept', 'Se conserva la versión de QuiroFlow'), value: nf.format(kept.length) },
      { label: t('Held for review', 'Apartadas para revisar'), value: nf.format(held.length) },
      { label: t('No matching patient', 'Sin paciente coincidente'), value: nf.format(plan.skippedNoPatient) },
      { label: t('Already up to date', 'Ya al día'), value: nf.format(plan.skippedUnchanged) },
      ...(plan.skippedInvalidDate ? [{ label: t('Unreadable date', 'Fecha ilegible'), value: nf.format(plan.skippedInvalidDate) }] : []),
    ],
    columns: [
      { key: 'when', label: t('Date', 'Fecha') },
      { key: 'ref', label: t('PracticeHub id', 'Id de PracticeHub') },
      { key: 'change', label: t('Change', 'Cambio') },
      { key: 'detail', label: t('Detail', 'Detalle'), wrap: true },
    ],
    rows: [
      // The ones a person should look at first, so the preview's sample shows them.
      ...held.map((h) => ({
        when: when(h.startsAt),
        ref: h.ref,
        change: t('Held for review: not imported and not changed', 'Apartada para revisar: ni se importa ni se cambia'),
        detail: `${heldReasonLabel(h.reason)}${h.patientRef ? ` · ${t('Patient number', 'Nº de paciente')} ${h.patientRef}` : ''}`,
      })),
      ...kept.map((k) => ({
        when: when(k.practiceHub.startsAt),
        ref: k.ref,
        change: t('QuiroFlow version kept', 'Se conserva la versión de QuiroFlow'),
        detail: [
          `${t('In QuiroFlow', 'En QuiroFlow')}: ${when(k.here.startsAt)} · ${statusLabel(k.here.status)}`,
          `${t('In PracticeHub', 'En PracticeHub')}: ${when(k.practiceHub.startsAt)} · ${statusLabel(k.practiceHub.status)}`,
          keptReasonLabel(k.reason),
        ].join('\n'),
      })),
      ...updates.map((u) => ({
        when: when(u.startsAt),
        ref: u.ref,
        change: u.adopted ? t('Re-created in PracticeHub, already here', 'Recreada en PracticeHub, ya aquí') : t('Updated', 'Actualizada'),
        detail: [...u.diff.map((d) => `${fieldLabel(d.field)}: ${d.from} → ${d.to}`), ...(u.note ? [t('+ visit note', '+ nota de visita')] : [])].join('\n'),
      })),
      ...inserts.map((i) => ({
        when: when(i.startsAt),
        ref: i.ref,
        change: t('New', 'Nueva'),
        detail: [i.appointment.practitioner_name ?? t('N/A', 'N/D'), statusLabel(i.appointment.status ?? 'booked'), ...(i.note ? [t('with a visit note', 'con nota de visita')] : [])].join(' · '),
      })),
    ],
    warnings: [
      ...(noClinic ? [t('Choose the clinic these appointments belong to before applying.', 'Elige la clínica de estas citas antes de aplicar.')] : []),
      ...(plan.skippedNoPatient ? [t(
        `${nf.format(plan.skippedNoPatient)} appointments belong to patients not imported yet and are skipped: run Patients first.`,
        `${nf.format(plan.skippedNoPatient)} citas son de pacientes aún no importados y se omiten: ejecuta Pacientes antes.`,
      )] : []),
      ...(held.length ? [t(
        `${nf.format(held.length)} appointments are held for review: they may be a visit already here, and it is not certain which. They are neither imported nor changed; check them in the list.`,
        `${nf.format(held.length)} citas se apartan para revisar: pueden ser una visita que ya está aquí y no es seguro cuál. Ni se importan ni se cambian; revísalas en la lista.`,
      )] : []),
      ...(kept.length ? [t(
        `${nf.format(kept.length)} visits keep their QuiroFlow version: they were moved here, or already checked in, completed, missed or cancelled here, and PracticeHub has them differently.`,
        `${nf.format(kept.length)} visitas conservan su versión de QuiroFlow: se movieron aquí, o ya se registraron, completaron, no se presentaron o cancelaron aquí, y PracticeHub las tiene de otra forma.`,
      )] : []),
      ...[...unlinkedPractitioners].map(([name, n]) => t(
        `${name} (${nf.format(n)} appointments in PracticeHub) is not on this clinic's team: their visits come in with the name only, which still shows who saw the patient. Add them under Settings → Team with the same name and sync again to link them.`,
        `${name} (${nf.format(n)} citas en PracticeHub) no está en el equipo: sus visitas llegan solo con el nombre, que sigue mostrando quién atendió al paciente. Añádelo en Ajustes → Equipo con el mismo nombre y vuelve a sincronizar para enlazarlas.`,
      )),
      ...(untypedNames.size ? [t(
        `${nf.format(untypedNames.size)} appointment types are not here yet (${[...untypedNames.keys()].join(', ')}): their visits come in with no type, and the Appointment types step creates them and links the visits.`,
        `${nf.format(untypedNames.size)} tipos de cita aún no existen aquí (${[...untypedNames.keys()].join(', ')}): sus visitas llegan sin tipo, y el paso Tipos de cita los crea y enlaza las visitas.`,
      )] : []),
    ],
    total: inserts.length + updates.length,
    async apply(progress, shouldStop) {
      if (noClinic) return { written: 0, errors: [t('Nothing was written: no clinic is chosen (see above).', 'No se escribió nada: no hay clínica elegida (ver arriba).')] }
      const errors: string[] = []
      let written = 0
      let done = 0

      const CHUNK = 100
      for (let i = 0; i < inserts.length; i += CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = inserts.slice(i, i + CHUNK)
        const span = `${chunk[0]!.ref}–${chunk[chunk.length - 1]!.ref}`
        const { data: inserted, error } = await supabase.from('appointments').insert(chunk.map((c) => c.appointment)).select('id, external_reference')
        if (error) {
          errors.push(t(`PracticeHub appointments ${span} were not imported: ${error.message}`, `Las citas de PracticeHub ${span} no se importaron: ${error.message}`))
        } else {
          written += inserted.length
          const idOf = new Map(inserted.map((r) => [r.external_reference, r.id]))
          const noteRows = chunk.flatMap((c, idx) => {
            const id = (c.ref && idOf.get(c.ref)) || inserted[idx]?.id
            return c.note && id ? [{ account_id: accountId, appointment_id: id, body: c.note }] : []
          })
          if (noteRows.length) {
            const { error: noteError } = await supabase.from('visit_notes').insert(noteRows)
            if (noteError) errors.push(t(`Visit notes for PracticeHub appointments ${span} were not saved: ${noteError.message}`, `No se guardaron las notas de visita de las citas de PracticeHub ${span}: ${noteError.message}`))
          }
        }
        done += chunk.length
        progress(done)
      }

      await withConcurrency(updates, 8, async (u) => {
        if (shouldStop()) return
        try {
          const { error } = await supabase.from('appointments').update(u.updates).eq('id', u.id).eq('account_id', accountId)
          if (error) {
            errors.push(t(`PracticeHub appointment ${u.ref} was not updated: ${error.message}`, `La cita de PracticeHub ${u.ref} no se actualizó: ${error.message}`))
            return
          }
          written++
          if (u.note) {
            const { error: noteError } = await supabase.from('visit_notes').insert({ account_id: accountId, appointment_id: u.id, body: u.note })
            if (noteError) errors.push(t(`The visit note for PracticeHub appointment ${u.ref} was not saved: ${noteError.message}`, `No se guardó la nota de visita de la cita de PracticeHub ${u.ref}: ${noteError.message}`))
          }
        } catch (e) {
          errors.push(`${u.ref}: ${errText(e)}`)
        } finally {
          progress(++done)
        }
      })
      return { written, errors }
    },
  }
}
