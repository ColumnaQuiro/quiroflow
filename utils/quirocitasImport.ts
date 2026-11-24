import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TablesInsert, TablesUpdate } from '~/types/database.types'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { quiroflowKeeps } from '~/utils/importAppointmentGuard'
import { readAllForAccount } from '~/utils/practicehubImport/appointments'
import {
  qcPatientRef,
  quirocitasAppointmentRows,
  quirocitasBonoRows,
  quirocitasClinicalLogs,
  quirocitasFileRows,
  quirocitasLedgerMismatches,
  quirocitasLedgerRows,
  quirocitasNamesChiropractors,
  quirocitasPatientRow,
  quirocitasPhone,
  quirocitasPractitionerMatcher,
  quirocitasRecordsReadThisPass,
  quirocitasVisitNotes,
  type QuirocitasAppointmentRow,
  type QuirocitasSnapshot,
} from '~/utils/quirocitasRows'

// What each Quirocitas import step will write, worked out from the copy the
// Read step made and what is already here -- then written on Apply. Every row
// carries a "QC-" external_reference, so a step run twice finds what it wrote
// the first time and writes only what is missing.
//
// That is also what lets the server run a step in slices
// (server/utils/importJobs.ts): a slice that runs out of time stops between
// chunks, and the next one plans again and finds only what is still missing.
//
// It runs on the server only, with the service role, so every read here is
// scoped to the account by hand: RLS is not there to do it. The preview the
// step screens show comes from /api/import/quirocitas-preview, which plans
// with this same code and never applies.
//
// Order matters the same way it does for PracticeHub: everything is matched
// to its patient by the patient's reference, appointments must exist before
// their notes and their charges, and bonos before the payments that bought
// them. A step run too early says what it is waiting for instead of guessing.

export type QuirocitasStepKind = 'patients' | 'appointments' | 'clinical' | 'bonos' | 'ledger' | 'files'

// The order a full import runs them in. Files go last: they are the slowest by
// far (some are videos), and everything else is useful to the clinic sooner.
export const QUIROCITAS_STEPS: QuirocitasStepKind[] = ['patients', 'appointments', 'clinical', 'bonos', 'ledger', 'files']

export interface QuirocitasPlan {
  stats: { label: string; value: number | string; tone?: 'good' | 'plain' }[]
  columns: { key: string; label: string; wrap?: boolean }[]
  rows: Record<string, string>[]
  warnings: string[]
  /** Units of work Apply will do, for its progress bar. */
  total: number
  apply(progress: (done: number) => void, shouldStop: () => boolean): Promise<{ written: number; errors: string[] }>
}

export interface QuirocitasFileResult { storagePath?: string; size?: number; contentType?: string; missing?: true; blank?: true }

export interface QuirocitasImportContext {
  supabase: SupabaseClient<Database>
  accountId: string
  /** The clinic appointments are booked into. */
  clinicId: string | null
  t: (en: string, es: string) => string
  /** Copies one photo or attached test from Quirocitas into Storage. */
  fetchFile(body: { patientId: string; src: string; kind: 'photo' | 'test'; testId?: string }): Promise<QuirocitasFileResult>
  /** Re-encodes a stored file and makes its thumbnail (processStoredPatientFile). */
  compressFile(fileId: string): Promise<unknown>
}

const CHUNK = 200
// The share of the cash ledger's visits that may match no appointment before
// the ledger is refused. A handful is a deleted visit or a typo'd name; more
// is a page this reader does not understand.
export const VISITLESS_LIMIT = 0.05

async function inChunks<T>(items: T[], size: number, run: (chunk: T[]) => Promise<void>, progress: (n: number) => void, shouldStop: () => boolean) {
  let done = 0
  for (let i = 0; i < items.length; i += size) {
    if (shouldStop()) break
    const chunk = items.slice(i, i + size)
    await run(chunk)
    done += chunk.length
    progress(done)
  }
  return done
}

async function withConcurrency<T>(items: T[], n: number, run: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: n }, async () => { for (let x; (x = queue.shift()) !== undefined;) await run(x) }))
}

export function quirocitasImporter(ctx: QuirocitasImportContext) {
  const { supabase, accountId, clinicId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')
  // Previews name statuses and payment methods in words, not by their keys.
  const statusName = (status: string) =>
    status === 'completed' ? t('Completed', 'Completada') : status === 'cancelled' ? t('Cancelled', 'Cancelada') : status === 'no_show' ? t('Missed', 'No presentado') : t('Booked', 'Reservada')
  const methodName = (method: string) =>
    method === 'cash' ? t('Cash', 'Efectivo') : method === 'card' ? t('Card', 'Tarjeta') : method === 'transfer' ? t('Transfer', 'Transferencia') : method
  // Formatters are built once and reused. `toLocaleString` with options
  // builds a new one on every call, and a large clinic's plan formats a
  // hundred thousand rows. A clinic with 85,000 appointments spent 4.7 s of
  // a 5.5 s plan in `when` alone on a laptop; on a server slice's slower CPU
  // the plan never finished inside the function, so nothing was ever written.
  const eurFormat = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const eur = (c: number) => `${eurFormat.format(c / 100)} €`

  // Every row of one of the account's tables; readAllForAccount says how.
  async function readAll<T>(table: string, columns: string, refPrefix?: string): Promise<T[]> {
    return readAllForAccount<T>(supabase, accountId, table, columns, refPrefix ? (q) => q.like('external_reference', `${refPrefix}%`) : undefined)
  }

  async function patientIds() {
    const rows = await readAll<{ id: string; external_reference: string }>('patients', 'id, external_reference', 'QC-')
    return new Map(rows.map((r) => [r.external_reference, r.id]))
  }

  async function clinicZone() {
    if (!clinicId) return DEFAULT_CLINIC_TIMEZONE
    const { data } = await supabase.from('clinics').select('timezone').eq('id', clinicId).maybeSingle()
    return data?.timezone || DEFAULT_CLINIC_TIMEZONE
  }

  // Who Quirocitas means by each chiropractor's name (quirocitasPractitionerMatcher
  // says how, and why it is not a plain comparison). `nobody` is a copy that
  // names no chiropractor and a team with more than one: there is no telling
  // whose each appointment is, and the step says so.
  async function team(s: QuirocitasSnapshot) {
    const { data } = await supabase.from('team_members').select('id, full_name, is_practitioner').eq('account_id', accountId).is('deleted_at', null)
    const members = data ?? []
    const practitioners = members.some((m) => m.is_practitioner) ? members.filter((m) => m.is_practitioner) : members
    const named = quirocitasNamesChiropractors(s)
    const sole = !named && practitioners.length === 1 ? practitioners[0]!.id : null
    return { of: quirocitasPractitionerMatcher(members, sole), nobody: !named && !sole }
  }

  const errText = (e: unknown) => (e as { message?: string })?.message ?? String(e)

  // --- 1 · Patients ---------------------------------------------------------------

  async function planPatients(s: QuirocitasSnapshot): Promise<QuirocitasPlan> {
    const { of: practitioner } = await team(s)
    const OVERWRITE = ['first_name', 'last_name', 'email', 'date_of_birth', 'national_id', 'address', 'postal_code', 'city', 'occupation', 'gender', 'referral_source'] as const
    type Existing = { id: string; external_reference: string | null; email: string | null; notes: string | null; tags: string[] | null; default_practitioner_id: string | null } & Record<(typeof OVERWRITE)[number], string | null>
    const existing = await readAll<Existing>('patients', `id, external_reference, email, notes, tags, default_practitioner_id, ${OVERWRITE.join(', ')}`)
    const byRef = new Map(existing.filter((p) => p.external_reference).map((p) => [p.external_reference!, p]))
    // Someone already added by hand before the import is the same person, by
    // e-mail -- but only a record no import has claimed yet.
    const byEmail = new Map(existing.filter((p) => !p.external_reference && p.email).map((p) => [p.email!.toLowerCase(), p]))

    const inserts: { row: TablesInsert<'patients'>; phones: ReturnType<typeof quirocitasPhone>[] }[] = []
    const updates: { id: string; label: string; changes: TablesUpdate<'patients'>; diff: string[]; phones: ReturnType<typeof quirocitasPhone>[] }[] = []
    const unmatched = new Map<string, number>()
    let unchanged = 0
    for (const r of Object.values(s.patients)) {
      const m = quirocitasPatientRow(r)
      const practitionerId = practitioner(m.practitioner)
      if (m.practitioner && !practitionerId) unmatched.set(m.practitioner, (unmatched.get(m.practitioner) ?? 0) + 1)
      const phones = m.phones.map(quirocitasPhone)
      const found = byRef.get(m.ref) ?? (m.fields.email ? byEmail.get(m.fields.email.toLowerCase()) : undefined)
      if (!found) {
        inserts.push({
          row: { ...m.fields, account_id: accountId, clinic_id: clinicId ?? null, external_reference: m.ref, default_practitioner_id: practitionerId, created_at: m.firstSeen ?? new Date().toISOString() },
          phones,
        })
        continue
      }
      const changes: TablesUpdate<'patients'> = {}
      const diff: string[] = []
      for (const k of OVERWRITE) {
        const to = m.fields[k] ?? null
        if (to !== null && to !== found[k]) { (changes as Record<string, unknown>)[k] = to; diff.push(`${k}: ${found[k] ?? '—'} → ${to}`) }
      }
      if (!found.external_reference) { changes.external_reference = m.ref; diff.push(`reference → ${m.ref}`) }
      if (practitionerId && practitionerId !== found.default_practitioner_id) { changes.default_practitioner_id = practitionerId; diff.push('practitioner') }
      if (m.fields.notes && !found.notes) { changes.notes = m.fields.notes; diff.push('notes') }
      const tags = [...new Set([...(found.tags ?? []), ...m.fields.tags])]
      if (tags.length !== (found.tags ?? []).length) { changes.tags = tags; diff.push(`tags + ${m.fields.tags.join(', ')}`) }
      if (!diff.length && !phones.length) { unchanged++; continue }
      updates.push({ id: found.id, label: m.name, changes, diff, phones })
    }

    // Numbers are only ever added, never replaced.
    const have = new Map<string, Set<string>>()
    const ids = updates.map((u) => u.id)
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data } = await supabase.from('patient_contact_numbers').select('patient_id, number').in('patient_id', ids.slice(i, i + CHUNK))
      for (const n of data ?? []) have.set(n.patient_id, (have.get(n.patient_id) ?? new Set()).add(n.number.replace(/\D/g, '')))
    }
    for (const u of updates) {
      u.phones = u.phones.filter((p) => !have.get(u.id)?.has(p.number.replace(/\D/g, '')))
      for (const p of u.phones) u.diff.push(`phone + ${p.number}`)
    }
    const changed = updates.filter((u) => u.diff.length)
    unchanged += updates.length - changed.length

    const warnings = [...unmatched].map(([name, n]) => t(
      `${name} is ${nf.format(n)} patients' chiropractor in Quirocitas and is not on this clinic's team yet: add them under Settings → Team with the same name, then prepare the preview again to link them.`,
      `${name} es el quiropráctico de ${nf.format(n)} pacientes en Quirocitas y aún no está en el equipo: añádelo en Ajustes → Equipo con el mismo nombre y vuelve a preparar la vista previa para enlazarlos.`,
    ))
    if (Object.keys(s.failed).length) warnings.push(t(`${nf.format(Object.keys(s.failed).length)} patients could not be read from Quirocitas and are not included. Read again to retry them.`, `${nf.format(Object.keys(s.failed).length)} pacientes no se pudieron leer de Quirocitas y no se incluyen. Vuelve a leer para reintentarlo.`))

    return {
      stats: [
        { label: t('New', 'Nuevos'), value: nf.format(inserts.length), tone: 'good' },
        { label: t('Updated', 'Actualizados'), value: nf.format(changed.length), tone: 'good' },
        { label: t('Already up to date', 'Ya al día'), value: nf.format(unchanged) },
        { label: t('With a phone', 'Con teléfono'), value: nf.format(inserts.filter((i) => i.phones.length).length) },
      ],
      columns: [{ key: 'name', label: t('Patient', 'Paciente') }, { key: 'what', label: t('Change', 'Cambio'), wrap: true }],
      rows: [
        ...inserts.map((i) => ({ name: `${i.row.first_name} ${i.row.last_name ?? ''}`.trim(), what: [t('New', 'Nuevo'), i.row.email, i.row.date_of_birth, i.phones.map((p) => p.number).join(', ')].filter(Boolean).join(' · ') })),
        ...changed.map((u) => ({ name: u.label, what: u.diff.join('\n') })),
      ],
      warnings,
      total: inserts.length + changed.length,
      async apply(progress, shouldStop) {
        const errors: string[] = []
        let written = 0
        await inChunks(inserts, CHUNK, async (chunk) => {
          const { data, error } = await supabase.from('patients').insert(chunk.map((c) => c.row)).select('id, external_reference')
          if (error) { errors.push(error.message); return }
          written += data.length
          const idOf = new Map(data.map((d) => [d.external_reference, d.id]))
          const numbers = chunk.flatMap((c) => c.phones.map((p) => ({ account_id: accountId, patient_id: idOf.get(c.row.external_reference!)!, number: p.number, country_code: p.country_code, is_whatsapp: false })))
          if (numbers.length) { const { error: e } = await supabase.from('patient_contact_numbers').insert(numbers); if (e) errors.push(e.message) }
        }, progress, shouldStop)
        let done = inserts.length
        await withConcurrency(changed, 8, async (u) => {
          if (shouldStop()) return
          if (Object.keys(u.changes).length) { const { error } = await supabase.from('patients').update(u.changes).eq('id', u.id); if (error) errors.push(`${u.label}: ${error.message}`); else written++ }
          if (u.phones.length) await supabase.from('patient_contact_numbers').insert(u.phones.map((p) => ({ account_id: accountId, patient_id: u.id, number: p.number, country_code: p.country_code, is_whatsapp: false })))
          progress(++done)
        })
        return { written, errors }
      },
    }
  }

  // --- 2 · Appointments -------------------------------------------------------------

  async function planAppointments(s: QuirocitasSnapshot, opts: { quietUpcoming: boolean }): Promise<QuirocitasPlan> {
    const zone = await clinicZone()
    const patients = await patientIds()
    const { of: practitioner, nobody } = await team(s)
    const { data: typeRows } = await supabase.from('appointment_types').select('id, name, duration_minutes').eq('account_id', accountId)
    const types = new Map((typeRows ?? []).map((ty) => [ty.name.trim().toLowerCase(), ty]))
    const existing = await readAll<{ id: string; external_reference: string; patient_id: string; status: string; starts_at: string; ends_at: string; practitioner_id: string | null; checked_in_at: string | null; rescheduled: boolean; note: string | null; deleted_at: string | null }>('appointments', 'id, external_reference, patient_id, status, starts_at, ends_at, practitioner_id, checked_in_at, rescheduled, note, deleted_at', 'QC-')
    const byRef = new Map(existing.map((a) => [a.external_reference, a]))

    const all = Object.values(s.patients).flatMap((r) => quirocitasAppointmentRows(r, zone).appointments)
    const waiting = all.filter((a) => !patients.has(a.patientRef))
    const ready = all.filter((a) => patients.has(a.patientRef))
    const newTypes = [...new Set(ready.map((a) => a.type).filter((n): n is string => !!n && !types.has(n.toLowerCase())))]
    const updates: { id: string; changes: TablesUpdate<'appointments'> }[] = []
    let kept = 0

    // Appointments Quirocitas no longer has. Its search list drops one the
    // moment it is cancelled, annulled or moved there: the cita id is simply
    // gone, and the record's visit list gains an entry with no id at the same
    // time. Nothing here used to look at a row the copy had stopped naming,
    // so one cancelled there after it was imported stayed booked here, with a
    // second, cancelled row beside it.
    //
    // "Gone" is asked of the whole copy, not of one record, and acted on only
    // for a patient whose record was fetched in a pass that read everyone
    // (quirocitasRecordsReadThisPass): an older record, or one that failed
    // this time, cannot say what Quirocitas has stopped listing.
    const isCita = (ref: string) => /^QC-\d+$/.test(ref)
    const listed = new Set(Object.values(s.patients).flatMap((r) => r.ficha.appointments.map((a) => a.id)))
    const recordOf = new Map(Object.values(s.patients).map((r) => [qcPatientRef(r.ficha.id), r]))
    const refOf = new Map([...patients].map(([ref, id]) => [id, ref]))
    const readThisPass = quirocitasRecordsReadThisPass(s)
    const gone = existing.filter((a) => isCita(a.external_reference) && !a.deleted_at && !listed.has(a.external_reference.slice(3)))
    // A visit that took place never leaves the list. So a record naming no
    // appointment at all, for someone whose visits were imported from it, is
    // a list that was not shown, not one that was emptied.
    const seenHere = new Set(existing.filter((a) => isCita(a.external_reference) && (a.status === 'completed' || a.status === 'no_show')).map((a) => a.patient_id))
    const slot = (patientId: string, at: string) => `${patientId}|${Date.parse(at)}`
    const cancels: { id: string; slot: string; startsAt: string; noteHere: string | null; changes: TablesUpdate<'appointments'> }[] = []
    const noList = new Set<string>()
    for (const a of gone) {
      if (a.status !== 'booked') continue
      const record = recordOf.get(refOf.get(a.patient_id) ?? '')
      if (!record || !readThisPass.has(record.ficha.id)) continue
      if (!record.ficha.appointments.length && (seenHere.has(a.patient_id) || !listed.size)) { noList.add(a.patient_id); continue }
      // Moved or checked in here: the visit is QuiroFlow's now.
      if (quiroflowKeeps({ status: a.status, checkedInAt: a.checked_in_at, rescheduled: a.rescheduled }, ['status'])) { kept++; continue }
      cancels.push({ id: a.id, slot: slot(a.patient_id, a.starts_at), startsAt: a.starts_at, noteHere: a.note, changes: { status: 'cancelled' } })
    }

    // One cancelled row for each cancellation Quirocitas lists at a time, and
    // no more. The visit list's entry carries no id, so it is written under a
    // reference of its own -- a second row for the appointment just cancelled
    // above, or for one cancelled here by hand when the desk cancelled it in
    // both. So an entry is written only for what the cancelled rows already
    // at that time do not account for.
    const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
    const standing = new Map<string, number>()
    for (const a of gone) if (a.status === 'cancelled') count(standing, slot(a.patient_id, a.starts_at))
    const cancelling = new Map<string, typeof cancels>()
    for (const c of cancels) { count(standing, c.slot); cancelling.set(c.slot, [...(cancelling.get(c.slot) ?? []), c]) }
    const entries = new Map<string, number>()
    const entriesHere = new Map<string, number>()
    const slotOf = (a: QuirocitasAppointmentRow) => slot(patients.get(a.patientRef)!, a.startsAt)
    for (const a of ready) if (!a.citaId) { count(entries, slotOf(a)); if (byRef.has(a.ref)) count(entriesHere, slotOf(a)) }
    const room = new Map<string, number>()
    const inserts: QuirocitasAppointmentRow[] = []
    for (const a of ready) {
      if (byRef.has(a.ref)) continue
      if (a.citaId) { inserts.push(a); continue }
      const at = slotOf(a)
      const left = room.get(at) ?? Math.max(0, entries.get(at)! - (standing.get(at) ?? 0) - (entriesHere.get(at) ?? 0))
      room.set(at, Math.max(0, left - 1))
      if (left > 0) { inserts.push(a); continue }
      // The row standing for it takes what the entry would have said: that it
      // was a move, and why.
      const c = cancelling.get(at)?.shift()
      if (c && a.rescheduled) c.changes.rescheduled = true
      if (c && a.note && !c.noteHere) c.changes.note = a.note
    }
    // Appointments already here with no practitioner, whose only change is
    // gaining one: by practitioner, so they are written many at a time. A
    // clinic imported before its chiropractor's name was matched has tens of
    // thousands of them, and an appointment with no practitioner shows on
    // nobody's tab in the calendar.
    const assigns = new Map<string, string[]>()
    const unmatched = new Map<string, number>()
    for (const a of ready) {
      const practitionerId = practitioner(a.practitioner)
      const here = byRef.get(a.ref)
      // Counted over what is still to come: those are the ones missed on the calendar.
      if (!practitionerId && !here?.practitioner_id && a.practitioner && a.status === 'booked') unmatched.set(a.practitioner, (unmatched.get(a.practitioner) ?? 0) + 1)
      if (!here) continue
      const changes: TablesUpdate<'appointments'> = {}
      const changing = [here.status !== a.status && 'status', Date.parse(here.starts_at) !== Date.parse(a.startsAt) && 'starts_at'].filter(Boolean) as string[]
      if (changing.length && quiroflowKeeps({ status: here.status, checkedInAt: here.checked_in_at, rescheduled: here.rescheduled }, changing)) kept++
      else if (changing.length) Object.assign(changes, { status: a.status, starts_at: a.startsAt })
      // An appointment moves whole. Only its start used to be written, so one
      // moved to later was left ending before it began.
      const startsAt = Date.parse(changes.starts_at ?? here.starts_at)
      const length = Date.parse(here.ends_at) - Date.parse(here.starts_at)
      if (changes.starts_at || Date.parse(here.ends_at) < startsAt) changes.ends_at = new Date(startsAt + (length > 0 ? length : 15 * 60000)).toISOString()
      // Only ever fills a blank: a practitioner chosen in QuiroFlow stands.
      const assign = !here.practitioner_id && practitionerId ? practitionerId : null
      if (!Object.keys(changes).length) {
        // Added to the list in place. Copying the list for each one, as this
        // did at first, is nothing for a few and minutes for 39,000: a
        // clinic's plan never ended inside its slice, so nothing was written.
        if (assign) { const ids = assigns.get(assign); if (ids) ids.push(here.id); else assigns.set(assign, [here.id]) }
        continue
      }
      updates.push({ id: here.id, changes: assign ? { ...changes, practitioner_id: assign } : changes })
    }
    const assigned = [...assigns.values()].reduce((a, ids) => a + ids.length, 0)
    const now = new Date().toISOString()
    const noClinic = !clinicId
    const upcoming = inserts.filter((a) => a.status === 'booked' && a.startsAt > now).length
    const whenFormat = new Intl.DateTimeFormat('es-ES', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' })
    const when = (at: string) => whenFormat.format(new Date(at))

    return {
      stats: [
        { label: t('New', 'Nuevas'), value: nf.format(inserts.length), tone: 'good' },
        { label: t('Updated', 'Actualizadas'), value: nf.format(updates.length + assigned), tone: 'good' },
        { label: t('Upcoming', 'Próximas'), value: nf.format(upcoming) },
        { label: t('Kept as QuiroFlow has them', 'Se mantienen como en QuiroFlow'), value: nf.format(kept) },
        ...(cancels.length ? [{ label: t('Cancelled in Quirocitas', 'Canceladas en Quirocitas'), value: nf.format(cancels.length) }] : []),
      ],
      columns: [{ key: 'when', label: t('When', 'Cuándo') }, { key: 'type', label: t('Type', 'Tipo') }, { key: 'status', label: t('Status', 'Estado') }, { key: 'note', label: t('Note', 'Nota'), wrap: true }],
      rows: [
        // First, so the preview's sample always shows them.
        ...cancels.map((c) => ({ when: when(c.startsAt), type: '—', status: `${statusName('booked')} → ${statusName('cancelled')}` + (c.changes.rescheduled ? ` (${t('moved', 'cambiada')})` : ''), note: c.changes.note ?? c.noteHere ?? '' })),
        ...inserts.map((a) => ({ when: when(a.startsAt), type: a.type ?? '—', status: statusName(a.status) + (a.rescheduled ? ` (${t('moved', 'cambiada')})` : ''), note: a.note ?? '' })),
      ],
      warnings: [
        ...(cancels.length ? [t(
          `${nf.format(cancels.length)} appointments still booked here are no longer in Quirocitas, where they were cancelled or moved after being imported: they are cancelled here too (${nf.format(cancels.filter((c) => c.startsAt > now).length)} of them still to come).`,
          `${nf.format(cancels.length)} citas que aquí siguen reservadas ya no están en Quirocitas, donde se cancelaron o cambiaron después de importarlas: se cancelan también aquí (${nf.format(cancels.filter((c) => c.startsAt > now).length)} de ellas aún por venir).`,
        )] : []),
        ...(noList.size ? [t(
          `Quirocitas showed no appointment list for ${nf.format(noList.size)} patients with appointments here, so none of theirs was cancelled. Read again to check them.`,
          `Quirocitas no mostró la lista de citas de ${nf.format(noList.size)} pacientes con citas aquí, así que no se canceló ninguna de las suyas. Vuelve a leer para comprobarlo.`,
        )] : []),
        ...(noClinic ? [t('Choose the clinic these appointments belong to, in the clinic switcher in the sidebar, before applying.', 'Elige la clínica de estas citas en el selector de clínica de la barra lateral antes de aplicar.')] : []),
        ...(waiting.length ? [t(`${nf.format(waiting.length)} appointments belong to patients not imported yet: run Patients first.`, `${nf.format(waiting.length)} citas son de pacientes aún no importados: ejecuta Pacientes antes.`)] : []),
        ...(newTypes.length ? [t(`Creates ${newTypes.length} appointment types (${newTypes.join(', ')}) of 15 minutes; adjust their length and price under Settings → Appointment types afterwards.`, `Crea ${newTypes.length} tipos de cita (${newTypes.join(', ')}) de 15 minutos; ajusta su duración y precio en Ajustes → Tipos de cita después.`)] : []),
        ...[...unmatched].map(([name, n]) => t(
          `${nf.format(n)} upcoming appointments are with ${name}, who is not on this clinic's team: they come in with no practitioner, and the calendar shows them only under "All" or "Unassigned". Add them under Settings → Team with that name and run this step again to link them.`,
          `${nf.format(n)} citas próximas son con ${name}, que no está en el equipo: llegan sin quiropráctico y el calendario solo las muestra en «Todos» o «Sin asignar». Añádelo en Ajustes → Equipo con ese nombre y vuelve a ejecutar este paso para enlazarlas.`,
        )),
        ...(nobody ? [t(
          'Quirocitas does not say which chiropractor each appointment is with, and this clinic has more than one: they come in with no practitioner, and the calendar shows them only under "All" or "Unassigned".',
          'Quirocitas no dice con qué quiropráctico es cada cita y esta clínica tiene más de uno: llegan sin quiropráctico y el calendario solo las muestra en «Todos» o «Sin asignar».',
        )] : []),
      ],
      total: inserts.length + updates.length + cancels.length + assigned,
      async apply(progress, shouldStop) {
        if (noClinic) return { written: 0, errors: [t('Nothing was written: no clinic is chosen (see above).', 'No se escribió nada: no hay clínica elegida (ver arriba).')] }
        const errors: string[] = []
        for (const name of newTypes) {
          const { data, error } = await supabase.from('appointment_types').insert({ account_id: accountId, name, duration_minutes: 15 }).select('id, name, duration_minutes').single()
          if (error) errors.push(`${name}: ${error.message}`)
          else types.set(name.toLowerCase(), data)
        }
        let written = 0
        await inChunks(inserts, CHUNK, async (chunk) => {
          const rows: TablesInsert<'appointments'>[] = chunk.map((a) => {
            const type = a.type ? types.get(a.type.toLowerCase()) : undefined
            const quiet = opts.quietUpcoming && a.status === 'booked' && a.startsAt > now
            return {
              account_id: accountId,
              clinic_id: clinicId!,
              patient_id: patients.get(a.patientRef)!,
              appointment_type_id: type?.id ?? null,
              practitioner_id: practitioner(a.practitioner),
              practitioner_name: a.practitioner || null,
              starts_at: a.startsAt,
              ends_at: new Date(Date.parse(a.startsAt) + (type?.duration_minutes ?? 15) * 60000).toISOString(),
              status: a.status,
              rescheduled: a.rescheduled,
              note: a.note,
              external_reference: a.ref,
              // Quirocitas is still reminding these patients while both run.
              ...(quiet ? { reminder_sent_at: now, confirmation_sent_at: now, same_day_info_sent_at: now } : {}),
            }
          })
          const { error } = await supabase.from('appointments').insert(rows)
          if (error) errors.push(error.message)
          else written += rows.length
        }, progress, shouldStop)
        let done = inserts.length
        await withConcurrency(updates, 8, async (u) => {
          if (shouldStop()) return
          const { error } = await supabase.from('appointments').update(u.changes).eq('id', u.id)
          if (error) errors.push(error.message); else written++
          progress(++done)
        })
        await withConcurrency(cancels, 8, async (c) => {
          if (shouldStop()) return
          // Only while it is still as it was planned: someone may have moved
          // it or checked the patient in meanwhile.
          const { data, error } = await supabase.from('appointments').update(c.changes).eq('id', c.id).eq('status', 'booked').eq('rescheduled', false).is('checked_in_at', null).select('id')
          if (error) errors.push(error.message); else written += data?.length ?? 0
          progress(++done)
        })
        for (const [practitionerId, ids] of assigns) {
          const before = done
          // Still blank when it is written: someone may have chosen one meanwhile.
          done += await inChunks(ids, CHUNK, async (chunk) => {
            const { error } = await supabase.from('appointments').update({ practitioner_id: practitionerId }).in('id', chunk).is('practitioner_id', null)
            if (error) errors.push(error.message); else written += chunk.length
          }, (n) => progress(before + n), shouldStop)
        }
        return { written, errors }
      },
    }
  }

  // --- 3 · Clinical history and calls -------------------------------------------------

  async function planClinical(s: QuirocitasSnapshot): Promise<QuirocitasPlan> {
    const zone = await clinicZone()
    const patients = await patientIds()
    const appts = await readAll<{ id: string; external_reference: string }>('appointments', 'id, external_reference', 'QC-')
    const apptId = new Map(appts.map((a) => [a.external_reference, a.id]))
    const logged = new Set((await readAll<{ external_reference: string }>('contact_log', 'external_reference', 'QC-')).map((l) => l.external_reference))
    // Visit notes carry no reference of their own: one is already here when
    // its visit already has a note with the same text.
    const noteIds = new Set(appts.map((a) => a.id))
    const existingNotes = new Set((await readAll<{ appointment_id: string; body: string }>('visit_notes', 'appointment_id, body')).filter((n) => noteIds.has(n.appointment_id)).map((n) => `${n.appointment_id}|${n.body.trim()}`))

    const notes = Object.values(s.patients).flatMap((r) => quirocitasVisitNotes(r, zone))
    const noteRows = notes.filter((n) => apptId.has(n.appointmentRef)).map((n) => ({ ...n, appointmentId: apptId.get(n.appointmentRef)! })).filter((n) => !existingNotes.has(`${n.appointmentId}|${n.body.trim()}`))
    const notesWaiting = notes.filter((n) => !apptId.has(n.appointmentRef)).length
    const calls = Object.values(s.patients).flatMap((r) => quirocitasAppointmentRows(r, zone).calls)
    const logs = [
      ...Object.values(s.patients).flatMap((r) => quirocitasClinicalLogs(r)).map((l) => ({ ...l, action: 'other' })),
      ...calls.map((c) => ({ ref: c.ref, patientRef: c.patientRef, at: c.at, note: c.note, action: c.answered ? 'other' : 'called_no_answer' })),
    ]
    const logRows = logs.filter((l) => patients.has(l.patientRef) && !logged.has(l.ref))
    const logsWaiting = logs.filter((l) => !patients.has(l.patientRef)).length

    return {
      stats: [
        { label: t('Visit notes', 'Notas de visita'), value: nf.format(noteRows.length), tone: 'good' },
        { label: t('With segments adjusted', 'Con segmentos ajustados'), value: nf.format(noteRows.filter((n) => n.body.includes('Segmentos ajustados')).length) },
        { label: t('Calls', 'Llamadas'), value: nf.format(logRows.filter((l) => l.ref.startsWith('QC-call-')).length), tone: 'good' },
        { label: t('History, plans, anamnesis', 'Historial, planes, anamnesis'), value: nf.format(logRows.filter((l) => !l.ref.startsWith('QC-call-')).length), tone: 'good' },
      ],
      columns: [{ key: 'kind', label: t('What', 'Qué') }, { key: 'body', label: t('Text', 'Texto'), wrap: true }],
      rows: [
        ...noteRows.map((n) => ({ kind: t('Visit note', 'Nota de visita'), body: n.body })),
        ...logRows.map((l) => ({ kind: l.ref.startsWith('QC-call-') ? t('Call', 'Llamada') : t('Record', 'Ficha'), body: l.note })),
      ],
      warnings: notesWaiting + logsWaiting ? [t(`${nf.format(notesWaiting + logsWaiting)} entries wait for their patient or appointment: run Patients and Appointments first.`, `${nf.format(notesWaiting + logsWaiting)} entradas esperan a su paciente o cita: ejecuta Pacientes y Citas antes.`)] : [],
      total: noteRows.length + logRows.length,
      async apply(progress, shouldStop) {
        const errors: string[] = []
        let written = 0
        await inChunks(noteRows, CHUNK, async (chunk) => {
          const { error } = await supabase.from('visit_notes').insert(chunk.map((n) => ({ account_id: accountId, appointment_id: n.appointmentId, body: n.body, created_at: n.at ?? new Date().toISOString() })))
          if (error) errors.push(error.message); else written += chunk.length
        }, progress, shouldStop)
        await inChunks(logRows, CHUNK, async (chunk) => {
          const { error } = await supabase.from('contact_log').insert(chunk.map((l) => ({ account_id: accountId, patient_id: patients.get(l.patientRef)!, action: l.action, note: l.note, external_reference: l.ref, created_at: l.at ?? new Date().toISOString() })))
          if (error) errors.push(error.message); else written += chunk.length
        }, (n) => progress(noteRows.length + n), shouldStop)
        return { written, errors }
      },
    }
  }

  // --- 4 · Bonos ------------------------------------------------------------------------

  async function planBonos(s: QuirocitasSnapshot): Promise<QuirocitasPlan> {
    const zone = await clinicZone()
    const patients = await patientIds()
    const { rows } = quirocitasBonoRows(s, zone)
    const existing = await readAll<{ id: string; external_reference: string; patient_id: string; sessions_used: number; is_closed: boolean; owed_cents: number | null }>('package_purchases', 'id, external_reference, patient_id, sessions_used, is_closed, owed_cents', 'QC-bono-')
    const byRef = new Map(existing.map((p) => [p.external_reference, p]))
    const ready = rows.filter((b) => patients.has(b.ownerRef))
    const inserts = ready.filter((b) => !byRef.has(b.ref))
    // Everyone whose record lists a bono that is already here, and is neither
    // its owner nor linked to it yet. Holders used to be linked only when the
    // bono was created, so a holder whose record was read on a later pass --
    // one clinic's first read stopped part way -- was never linked: 106 links
    // missing, and the money paid for a family's bono sat on one member while
    // the others' sessions read as owed (20,494 EUR across 58 patients).
    const linked = new Set((await readAll<{ package_purchase_id: string; patient_id: string }>('package_purchase_shares', 'package_purchase_id, patient_id')).map((s) => `${s.package_purchase_id}|${s.patient_id}`))
    const missingLinks = ready.filter((b) => byRef.has(b.ref)).flatMap((b) => {
      const here = byRef.get(b.ref)!
      return [b.ownerRef, ...b.sharedWithRefs]
        .map((r) => patients.get(r))
        .filter((pid): pid is string => !!pid && pid !== here.patient_id && !linked.has(`${here.id}|${pid}`))
        .map((pid) => ({ account_id: accountId, package_purchase_id: here.id, patient_id: pid }))
    }).filter((link, i, all) => all.findIndex((x) => x.package_purchase_id === link.package_purchase_id && x.patient_id === link.patient_id) === i)
    // A session used here is not undone by a re-run: the count only rises. So
    // a bono Quirocitas still has open, and whose last sessions were used
    // here, stays closed.
    const closed = (b: (typeof rows)[number], here: (typeof existing)[number]) => b.isClosed || here.sessions_used >= b.sessionsTotal
    const updates = ready.filter((b) => byRef.has(b.ref)).map((b) => ({ b, here: byRef.get(b.ref)! })).filter(({ b, here }) => b.sessionsUsed > here.sessions_used || closed(b, here) !== here.is_closed || b.owedCents !== (here.owed_cents ?? 0))

    return {
      stats: [
        { label: t('New bonos', 'Bonos nuevos'), value: nf.format(inserts.length), tone: 'good' },
        { label: t('Updated', 'Actualizados'), value: nf.format(updates.length), tone: 'good' },
        { label: t('Still running', 'En curso'), value: nf.format(inserts.filter((b) => !b.isClosed).length) },
        { label: t('Shared with family', 'Compartidos'), value: nf.format(inserts.filter((b) => b.sharedWithRefs.length).length) },
        ...(missingLinks.length ? [{ label: t('Family links added', 'Familiares enlazados'), value: nf.format(missingLinks.length), tone: 'good' as const }] : []),
      ],
      columns: [{ key: 'bono', label: 'Bono' }, { key: 'sessions', label: t('Sessions', 'Sesiones') }, { key: 'price', label: t('Price', 'Precio') }, { key: 'bought', label: t('Bought', 'Comprado') }, { key: 'state', label: t('State', 'Estado') }],
      rows: inserts.map((b) => ({ bono: b.name, sessions: `${b.sessionsUsed}/${b.sessionsTotal}`, price: eur(b.priceCents) + (b.owedCents ? ` (${t('owes', 'debe')} ${eur(b.owedCents)})` : ''), bought: b.purchasedAt.slice(0, 10) + (b.dateFromLedger ? '' : ' *'), state: (b.isClosed ? t('Closed', 'Cerrado') : t('Running', 'En curso')) + (b.sharedWithRefs.length ? ` · ${t('shared', 'compartido')} ×${b.sharedWithRefs.length}` : '') })),
      warnings: [
        ...(rows.length > ready.length ? [t(`${nf.format(rows.length - ready.length)} bonos belong to patients not imported yet: run Patients first.`, `${nf.format(rows.length - ready.length)} bonos son de pacientes aún no importados: ejecuta Pacientes antes.`)] : []),
        ...(inserts.some((b) => !b.dateFromLedger) ? [t('* No sale for this bono in the cash ledger: its purchase date is worked back from when it expires.', '* No hay venta de este bono en la caja: su fecha de compra se calcula desde su caducidad.')] : []),
      ],
      total: inserts.length + updates.length + missingLinks.length,
      async apply(progress, shouldStop) {
        const errors: string[] = []
        let written = 0
        await inChunks(inserts, CHUNK, async (chunk) => {
          const { data, error } = await supabase.from('package_purchases').insert(chunk.map((b) => ({
            account_id: accountId, patient_id: patients.get(b.ownerRef)!, package_name: b.name, price_cents: b.priceCents,
            sessions_total: b.sessionsTotal, sessions_used: b.sessionsUsed, purchased_at: b.purchasedAt, owed_cents: b.owedCents, is_closed: b.isClosed, external_reference: b.ref,
          }))).select('id, external_reference')
          if (error) { errors.push(error.message); return }
          written += data.length
          const idOf = new Map(data.map((d) => [d.external_reference, d.id]))
          const shares = chunk.flatMap((b) => b.sharedWithRefs.filter((r) => patients.has(r)).map((r) => ({ account_id: accountId, package_purchase_id: idOf.get(b.ref)!, patient_id: patients.get(r)! })))
          if (shares.length) { const { error: e } = await supabase.from('package_purchase_shares').insert(shares); if (e) errors.push(e.message) }
        }, progress, shouldStop)
        let done = inserts.length
        await withConcurrency(updates, 8, async ({ b, here }) => {
          if (shouldStop()) return
          const { error } = await supabase.from('package_purchases').update({ sessions_used: Math.max(b.sessionsUsed, here.sessions_used), is_closed: closed(b, here), owed_cents: b.owedCents }).eq('id', here.id)
          if (error) errors.push(error.message); else written++
          progress(++done)
        })
        await inChunks(missingLinks, CHUNK, async (chunk) => {
          const { error } = await supabase.from('package_purchase_shares').insert(chunk)
          if (error) errors.push(error.message); else written += chunk.length
        }, (n) => progress(inserts.length + updates.length + n), shouldStop)
        return { written, errors }
      },
    }
  }

  // --- 5 · Payments and invoices ---------------------------------------------------------

  async function planLedger(s: QuirocitasSnapshot): Promise<QuirocitasPlan> {
    // Nothing is worked out from a copy whose cash ledger was not read. Every
    // charge and payment comes from it, and what would be left to write --
    // each Quirocitas invoice as a note, for want of a charge to sit on --
    // would be wrong the day the ledger is read.
    if (!s.ledgerMonths.length) {
      return {
        stats: [], columns: [], rows: [], total: 0,
        warnings: [t(
          `The cash ledger has not been read from Quirocitas${s.ledgerError ? ` (${s.ledgerError})` : ''}, so there are no payments or invoices to import yet.`,
          `La caja de Quirocitas no se ha leído${s.ledgerError ? ` (${s.ledgerError})` : ''}, así que aún no hay pagos ni facturas que importar.`,
        )],
        apply: async () => ({ written: 0, errors: [] }),
      }
    }
    const zone = await clinicZone()
    const patients = await patientIds()
    const appts = new Map((await readAll<{ id: string; external_reference: string }>('appointments', 'id, external_reference', 'QC-')).map((a) => [a.external_reference, a.id]))
    const bonoIds = new Map((await readAll<{ id: string; external_reference: string }>('package_purchases', 'id, external_reference', 'QC-bono-')).map((b) => [b.external_reference, b.id]))
    const haveInvoices = new Map((await readAll<{ id: string; external_reference: string }>('invoices', 'id, external_reference', 'QC-inv-')).map((i) => [i.external_reference, i.id]))
    const havePayments = new Set((await readAll<{ external_reference: string }>('payments', 'external_reference', 'QC-pay-')).map((p) => p.external_reference))
    const logged = new Set((await readAll<{ external_reference: string }>('contact_log', 'external_reference', 'QC-factura-')).map((l) => l.external_reference))
    const { data: methods } = await supabase.from('payment_methods').select('key').eq('account_id', accountId)
    const missingMethods = (['cash', 'card', 'transfer'] as const).filter((k) => !(methods ?? []).some((m) => m.key === k))

    const { bonoOfSale } = quirocitasBonoRows(s, zone)
    const ledger = quirocitasLedgerRows(s, bonoOfSale, zone)
    const charges = ledger.charges.filter((c) => patients.has(c.patientRef) && appts.has(c.appointmentRef) && !haveInvoices.has(c.ref))
    const chargesWaiting = ledger.charges.filter((c) => !patients.has(c.patientRef) || !appts.has(c.appointmentRef)).length
    const payments = ledger.payments.filter((p) => patients.has(p.patientRef) && !havePayments.has(p.ref) && (!p.chargeRef || haveInvoices.has(p.chargeRef) || charges.some((c) => c.ref === p.chargeRef)))
    const paymentsWaiting = ledger.payments.filter((p) => !havePayments.has(p.ref)).length - payments.length
    const invoiceNotes = ledger.invoiceNotes.filter((n) => patients.has(n.patientRef) && !logged.has(n.ref))
    const bonosMissing = payments.filter((p) => p.bonoRef && !bonoIds.has(p.bonoRef)).length

    // What it leaves each patient with: payments less charges, as the
    // patient list will show it.
    const balance = new Map<string, number>()
    for (const p of ledger.payments) balance.set(p.patientRef, (balance.get(p.patientRef) ?? 0) + p.amountCents)
    for (const c of ledger.charges) balance.set(c.patientRef, (balance.get(c.patientRef) ?? 0) - c.totalCents)
    const credit = [...balance.values()].filter((v) => v > 0)
    const owing = [...balance.values()].filter((v) => v < 0)
    // Two things stop the ledger being written at all, rather than written
    // wrong. A month whose rows do not add up to what Quirocitas printed
    // under it was read with its columns in the wrong place: one clinic's
    // whole ledger came in with its cash as transfers and its card payments
    // as debt, and the import only warned. And a ledger whose visits mostly
    // cannot be found would bring in every payment without the visits they
    // paid for, leaving each patient in credit by everything they ever paid
    // (403,536.90 EUR across 1,046 patients, read that way).
    const mismatched = quirocitasLedgerMismatches(s)
    const monthList = (ms: { month: string }[]) => ms.slice(0, 6).map((m) => m.month).join(', ') + (ms.length > 6 ? '…' : '')
    const visitRows = ledger.charges.length + ledger.visitless.length
    const tooVisitless = visitRows > 0 && ledger.visitless.length / visitRows > VISITLESS_LIMIT
    const blocked = [
      ...(mismatched.length ? [t(
        `Nothing will be written: ${nf.format(mismatched.length)} months of the cash ledger do not add up to the totals Quirocitas printed (${monthList(mismatched)}), so its columns were not read where they are.`,
        `No se escribirá nada: ${nf.format(mismatched.length)} meses de la caja no suman lo que Quirocitas imprime (${monthList(mismatched)}), así que sus columnas no se han leído donde están.`,
      )] : []),
      ...(tooVisitless ? [t(
        `Nothing will be written: ${nf.format(ledger.visitless.length)} of ${nf.format(visitRows)} visits in the cash ledger match no appointment in the patient's record, so their payments would come in without the visits they paid for.`,
        `No se escribirá nada: ${nf.format(ledger.visitless.length)} de ${nf.format(visitRows)} visitas de la caja no coinciden con ninguna cita de la ficha del paciente, así que sus pagos llegarían sin las visitas que pagaron.`,
      )] : []),
    ]

    return {
      stats: [
        { label: t('Visit charges', 'Cargos de visita'), value: nf.format(charges.length), tone: 'good' },
        { label: t('Payments', 'Pagos'), value: nf.format(payments.length), tone: 'good' },
        { label: t('Quirocitas invoices', 'Facturas de Quirocitas'), value: nf.format(charges.filter((c) => c.invoice).length + invoiceNotes.length) },
        { label: t('Money in', 'Cobrado'), value: eur(payments.reduce((a, p) => a + p.amountCents, 0)) },
      ],
      columns: [{ key: 'when', label: t('Date', 'Fecha') }, { key: 'what', label: t('What', 'Qué') }, { key: 'amount', label: t('Amount', 'Importe') }],
      rows: [
        ...charges.filter((c) => c.invoice).map((c) => ({ when: c.at.slice(0, 10), what: `${t('Invoice', 'Factura')} ${c.number}`, amount: eur(c.totalCents) })),
        ...payments.map((p) => ({ when: p.paidAt.slice(0, 10), what: `${t('Payment', 'Pago')} · ${methodName(p.method)}${p.bonoRef ? ' · bono' : ''}`, amount: eur(p.amountCents) })),
      ],
      warnings: [
        t(
          `Afterwards ${nf.format(credit.length)} patients hold ${eur(credit.reduce((a, v) => a + v, 0))} paid ahead (mostly bono sessions not used yet) and ${nf.format(owing.length)} show ${eur(-owing.reduce((a, v) => a + v, 0))} more charged than paid: largely family members whose visits came off a relative's bono, which QuiroFlow pools when it settles a visit. Only charges Quirocitas still shows as owed come in unpaid; every other one is marked paid, so nobody is chased for it.`,
          `Después, ${nf.format(credit.length)} pacientes tienen ${eur(credit.reduce((a, v) => a + v, 0))} pagados por adelantado (sobre todo sesiones de bono sin usar) y ${nf.format(owing.length)} muestran ${eur(-owing.reduce((a, v) => a + v, 0))} más cargado que pagado: en su mayoría familiares cuyas visitas salieron del bono de un pariente, que QuiroFlow suma al saldar una visita. Solo llegan pendientes los cargos que Quirocitas aún muestra como debidos; el resto queda pagado, así que no se reclama a nadie por ellos.`,
        ),
        t('Invoices Quirocitas issued for a bono sale come in as a note on the patient with all their details: QuiroFlow charges a bono by its visits, so an invoice for the sale itself would bill the patient twice.', 'Las facturas que Quirocitas emitió por la venta de un bono llegan como nota en el paciente con todos sus datos: QuiroFlow cobra el bono visita a visita, y una factura por la venta lo cobraría dos veces.'),
        ...blocked,
        ...(!tooVisitless && ledger.visitless.length ? [t(
          `${nf.format(ledger.visitless.length)} visits in the cash ledger match no appointment in the patient's record: their payments come in, their charges do not.`,
          `${nf.format(ledger.visitless.length)} visitas de la caja no coinciden con ninguna cita de la ficha del paciente: llegan sus pagos, no sus cargos.`,
        )] : []),
        ...(chargesWaiting || paymentsWaiting ? [t(`${nf.format(chargesWaiting + paymentsWaiting)} entries wait for their patient or appointment: run Patients and Appointments first.`, `${nf.format(chargesWaiting + paymentsWaiting)} entradas esperan a su paciente o cita: ejecuta Pacientes y Citas antes.`)] : []),
        ...(bonosMissing ? [t(`${nf.format(bonosMissing)} bono payments will not be linked to their bono: run Bonos first.`, `${nf.format(bonosMissing)} pagos de bono no quedarán enlazados a su bono: ejecuta Bonos antes.`)] : []),
        ...(missingMethods.length ? [t(`This clinic has no payment method for ${missingMethods.map(methodName).join(', ')}: add it under Settings → Payments → Payment methods first.`, `Esta clínica no tiene método de pago para ${missingMethods.map(methodName).join(', ')}: añádelo antes en Ajustes → Pagos → Métodos de pago.`)] : []),
      ],
      total: charges.length + payments.length + invoiceNotes.length,
      async apply(progress, shouldStop) {
        if (blocked.length) return { written: 0, errors: blocked }
        if (missingMethods.length) return { written: 0, errors: [t('Nothing was written: a payment method is missing (see above).', 'No se escribió nada: falta un método de pago (ver arriba).')] }
        const errors: string[] = []
        let written = 0
        await inChunks(charges, CHUNK, async (chunk) => {
          const { data, error } = await supabase.from('invoices').insert(chunk.map((c) => ({
            account_id: accountId, patient_id: patients.get(c.patientRef)!, appointment_id: appts.get(c.appointmentRef)!,
            invoice_number: c.number, total_cents: c.totalCents, status: c.status, created_at: c.at, external_reference: c.ref,
          }))).select('id, external_reference')
          if (error) { errors.push(error.message); return }
          for (const d of data) haveInvoices.set(d.external_reference!, d.id)
          written += data.length
        }, progress, shouldStop)
        await inChunks(payments, CHUNK, async (chunk) => {
          const { error } = await supabase.from('payments').insert(chunk.map((p) => ({
            account_id: accountId, patient_id: patients.get(p.patientRef)!, amount_cents: p.amountCents, method: p.method, paid_at: p.paidAt,
            invoice_id: p.chargeRef ? haveInvoices.get(p.chargeRef) ?? null : null, package_purchase_id: p.bonoRef ? bonoIds.get(p.bonoRef) ?? null : null, external_reference: p.ref,
          })))
          if (error) errors.push(error.message); else written += chunk.length
        }, (n) => progress(charges.length + n), shouldStop)
        await inChunks(invoiceNotes, CHUNK, async (chunk) => {
          const { error } = await supabase.from('contact_log').insert(chunk.map((n) => ({ account_id: accountId, patient_id: patients.get(n.patientRef)!, action: 'other', note: n.note, external_reference: n.ref, created_at: n.at ?? new Date().toISOString() })))
          if (error) errors.push(error.message); else written += chunk.length
        }, (n) => progress(charges.length + payments.length + n), shouldStop)
        return { written, errors }
      },
    }
  }

  // --- 6 · Files and photos ----------------------------------------------------------------

  async function planFiles(s: QuirocitasSnapshot): Promise<QuirocitasPlan> {
    const patients = await patientIds()
    const stored = new Set((await readAll<{ external_reference: string; storage_path: string | null }>('patient_files', 'external_reference, storage_path', 'QC-test-')).filter((f) => f.storage_path).map((f) => f.external_reference))
    const photoless = new Set((await readAll<{ external_reference: string; photo_storage_path: string | null }>('patients', 'external_reference, photo_storage_path', 'QC-')).filter((p) => !p.photo_storage_path).map((p) => p.external_reference))
    const files = Object.values(s.patients).flatMap((r) => quirocitasFileRows(r)).filter((f) => patients.has(f.patientRef) && !stored.has(f.ref))
    const photos = Object.values(s.patients).filter((r) => r.ficha.hasPhoto && photoless.has(qcPatientRef(r.ficha.id))).map((r) => ({ ref: qcPatientRef(r.ficha.id), id: r.ficha.id, name: r.ficha.name }))
    const waiting = Object.values(s.patients).flatMap((r) => quirocitasFileRows(r)).filter((f) => !patients.has(f.patientRef)).length

    return {
      stats: [
        { label: t('Files', 'Archivos'), value: nf.format(files.length), tone: 'good' },
        { label: t('X-rays', 'Radiografías'), value: nf.format(files.filter((f) => f.isXray).length) },
        { label: t('Photos to check', 'Fotos a revisar'), value: nf.format(photos.length), tone: 'good' },
      ],
      columns: [{ key: 'file', label: t('File', 'Archivo') }, { key: 'description', label: t('Description', 'Descripción'), wrap: true }],
      rows: files.map((f) => ({ file: f.fileName, description: f.description })),
      warnings: [
        t('Photos are copied only where Quirocitas has a real one: many records hold a blank placeholder image, which is skipped.', 'Las fotos solo se copian cuando Quirocitas tiene una de verdad: muchas fichas guardan una imagen en blanco, que se omite.'),
        ...(waiting ? [t(`${nf.format(waiting)} files belong to patients not imported yet: run Patients first.`, `${nf.format(waiting)} archivos son de pacientes aún no importados: ejecuta Pacientes antes.`)] : []),
      ],
      total: files.length + photos.length,
      async apply(progress, shouldStop) {
        const errors: string[] = []
        let written = 0
        let done = 0
        let missing = 0
        // Files go through the server into Storage one at a time each: some are
        // videos of tens of megabytes.
        await withConcurrency(files, 3, async (f) => {
          if (shouldStop()) return
          try {
            const res = await ctx.fetchFile({ patientId: patients.get(f.patientRef)!, src: f.src, kind: 'test', testId: f.testId })
            if (res.missing || !res.storagePath) { missing++; return }
            // The reference's unique index is partial (where not null), which
            // PostgREST's upsert cannot target: look first, then write.
            const row = { file_name: f.fileName, file_type: res.contentType ?? null, size_bytes: res.size ?? null, storage_path: res.storagePath, is_xray: f.isXray }
            const { data: here } = await supabase.from('patient_files').select('id').eq('account_id', accountId).eq('external_reference', f.ref).maybeSingle()
            // A re-run has just written the original over the compressed copy,
            // so the row must stop saying it was compressed and resized.
            const { data, error } = here
              ? await supabase.from('patient_files').update({ ...row, compressed_at: null, resized_at: null }).eq('id', here.id).select('id').single()
              : await supabase.from('patient_files').insert({ ...row, account_id: accountId, patient_id: patients.get(f.patientRef)!, external_reference: f.ref }).select('id').single()
            if (error) throw error
            written++
            await ctx.compressFile(data.id).catch(() => {})
          } catch (e) {
            errors.push(`${f.fileName}: ${errText(e)}`)
          } finally {
            progress(++done)
          }
        })
        await withConcurrency(photos, 3, async (p) => {
          if (shouldStop()) return
          try {
            const res = await ctx.fetchFile({ patientId: patients.get(p.ref)!, src: `${p.id}/photo.jpg`, kind: 'photo' })
            if (res.storagePath) {
              const { error } = await supabase.from('patients').update({ photo_storage_path: res.storagePath }).eq('id', patients.get(p.ref)!)
              if (error) throw error
              written++
            }
          } catch (e) {
            errors.push(`${p.name}: ${errText(e)}`)
          } finally {
            progress(++done)
          }
        })
        if (missing) errors.unshift(t(`${missing} files are listed in Quirocitas but missing on its server (they do not open there either).`, `${missing} archivos aparecen en Quirocitas pero faltan en su servidor (allí tampoco se abren).`))
        return { written, errors }
      },
    }
  }

  return {
    plan(kind: QuirocitasStepKind, s: QuirocitasSnapshot, opts: { quietUpcoming?: boolean } = {}): Promise<QuirocitasPlan> {
      switch (kind) {
        case 'patients': return planPatients(s)
        case 'appointments': return planAppointments(s, { quietUpcoming: opts.quietUpcoming ?? true })
        case 'clinical': return planClinical(s)
        case 'bonos': return planBonos(s)
        case 'ledger': return planLedger(s)
        case 'files': return planFiles(s)
      }
    },
  }
}
