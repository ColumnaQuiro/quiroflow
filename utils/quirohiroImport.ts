import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TablesInsert, TablesUpdate } from '~/types/database.types'
import { quiroflowKeeps } from '~/utils/importAppointmentGuard'
import { quirocitasPractitionerMatcher } from '~/utils/quirocitasRows'
import type { QuirocitasPlan } from '~/utils/quirocitasImport'
import { practiceHubClinicZone, readAllForAccount, withConcurrency } from '~/utils/practicehubImport/appointments'
import {
  quirohiroAppointmentRows,
  quirohiroFileCount,
  quirohiroNoteRows,
  quirohiroPatientRow,
  quirohiroPatients,
  quirohiroRecordText,
  qhRecordRef,
  type QuirohiroSnapshot,
  type QuirohiroWho,
} from '~/utils/quirohiroRows'

// What each QuiroHiro import step will write, planned from the copy the read
// made (server/utils/quirohiroImportJob.ts) against what is already here, and
// written on apply -- the shape Quirocitas' and PracticeHub's steps have, so
// the job runner treats all three alike.
//
// Every row carries a "QH-" external_reference, so a step run twice finds
// what it wrote the first time and writes only what is missing or changed.
// That is what lets a slice that runs out of time plan again next time, and a
// clinic still working in QuiroHiro for a few days be brought up to date
// with the same button.
//
// Service role: every read is scoped to the account by hand.

export type QuirohiroStepKind = 'patients' | 'appointments' | 'clinical'

/** The order a full import runs them in: everything finds its patient by reference, and notes find their visit. */
export const QUIROHIRO_STEPS: QuirohiroStepKind[] = ['patients', 'appointments', 'clinical']

export type QuirohiroPlan = QuirocitasPlan

export interface QuirohiroImportContext {
  supabase: SupabaseClient<Database>
  accountId: string
  clinicId: string | null
  t: (en: string, es: string) => string
}

export interface QuirohiroPlanOptions {
  who: QuirohiroWho
  /** Upcoming appointments come in with their reminders marked as sent: QuiroHiro is still sending them. */
  quietUpcoming: boolean
}

const CHUNK = 200

async function inChunks<T>(items: T[], run: (chunk: T[]) => Promise<void>, progress: (n: number) => void, shouldStop: () => boolean) {
  let done = 0
  for (let i = 0; i < items.length; i += CHUNK) {
    if (shouldStop()) break
    const chunk = items.slice(i, i + CHUNK)
    await run(chunk)
    done += chunk.length
    progress(done)
  }
  return done
}

export function quirohiroImporter(ctx: QuirohiroImportContext) {
  const { supabase, accountId, clinicId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')
  const readAll = <T>(table: string, columns: string, refPrefix?: string) =>
    readAllForAccount<T>(supabase, accountId, table, columns, refPrefix ? (q) => q.like('external_reference', `${refPrefix}%`) : undefined)
  const statusName = (status: string) =>
    status === 'completed' ? t('Completed', 'Completada') : status === 'cancelled' ? t('Cancelled', 'Cancelada') : status === 'no_show' ? t('Missed', 'No presentado') : t('Booked', 'Reservada')

  async function patientIds() {
    const rows = await readAll<{ id: string; external_reference: string }>('patients', 'id, external_reference', 'QH-')
    return new Map(rows.map((r) => [r.external_reference, r.id]))
  }

  async function team() {
    const { data, error } = await supabase.from('team_members').select('id, full_name, is_practitioner').eq('account_id', accountId).is('deleted_at', null)
    if (error) throw new Error(`team_members: ${error.message}`)
    const members = data ?? []
    const practitioners = members.some((m) => m.is_practitioner) ? members.filter((m) => m.is_practitioner) : members
    return quirocitasPractitionerMatcher(practitioners)
  }

  const unmatchedWarning = (name: string, n: number, what: 'patients' | 'appointments') => what === 'patients'
    ? t(
        `${name} is ${nf.format(n)} patients' practitioner in QuiroHiro and is not on this clinic's team yet: add them under Settings → Team with the same name, then run this again to link them.`,
        `${name} es el quiropráctico de ${nf.format(n)} pacientes en QuiroHiro y aún no está en el equipo: añádelo en Ajustes → Equipo con el mismo nombre y vuelve a ejecutarlo para enlazarlos.`,
      )
    : t(
        `${nf.format(n)} upcoming appointments are with ${name}, who is not on this clinic's team: they come in with no practitioner, and the calendar shows them only under "All" or "Unassigned". Add them under Settings → Team with that name and run this again to link them.`,
        `${nf.format(n)} citas próximas son con ${name}, que no está en el equipo: llegan sin quiropráctico y el calendario solo las muestra en «Todos» o «Sin asignar». Añádelo en Ajustes → Equipo con ese nombre y vuelve a ejecutarlo para enlazarlas.`,
      )

  // --- 1 · Patients ---------------------------------------------------------------

  async function planPatients(s: QuirohiroSnapshot, opts: QuirohiroPlanOptions): Promise<QuirohiroPlan> {
    const practitioner = await team()
    const OVERWRITE = ['first_name', 'last_name', 'email', 'date_of_birth', 'national_id', 'address', 'postal_code', 'city', 'occupation', 'gender', 'referral_source'] as const
    // The clinical snapshot only ever fills a blank: what the chiropractor
    // writes here stands against a re-sync.
    const FILL = ['chief_complaint', 'diagnosis', 'red_flags'] as const
    type Existing = { id: string; external_reference: string | null; tags: string[] | null; default_practitioner_id: string | null } & Record<(typeof OVERWRITE)[number] | (typeof FILL)[number], string | null>
    const existing = await readAll<Existing>('patients', `id, external_reference, tags, default_practitioner_id, ${[...OVERWRITE, ...FILL].join(', ')}`)
    const byRef = new Map(existing.filter((p) => p.external_reference).map((p) => [p.external_reference!, p]))
    // Someone already added by hand before the import is the same person, by
    // e-mail -- but only a record no import has claimed yet.
    const byEmail = new Map(existing.filter((p) => !p.external_reference && p.email).map((p) => [p.email!.toLowerCase(), p]))

    const chosen = quirohiroPatients(s, opts.who)
    const leftOut = s.contacts.length - chosen.length
    const inserts: { row: TablesInsert<'patients'>; phones: { country_code: string; number: string }[] }[] = []
    const updates: { id: string; label: string; changes: TablesUpdate<'patients'>; diff: string[]; phones: { country_code: string; number: string }[] }[] = []
    const unmatched = new Map<string, number>()
    let unchanged = 0
    for (const c of chosen) {
      const m = quirohiroPatientRow(c, s)
      const practitionerId = m.practitioner ? practitioner(m.practitioner) : null
      if (m.practitioner && !practitionerId) unmatched.set(m.practitioner, (unmatched.get(m.practitioner) ?? 0) + 1)
      const found = byRef.get(m.ref) ?? (m.fields.email ? byEmail.get(m.fields.email) : undefined)
      if (!found) {
        inserts.push({
          // Every clinical key, null where QuiroHiro has nothing: a bulk insert sends NULL for a key only some rows carry anyway.
          row: { ...m.fields, ...Object.fromEntries(FILL.map((k) => [k, m.clinical[k] ?? null])), account_id: accountId, clinic_id: clinicId, external_reference: m.ref, default_practitioner_id: practitionerId, created_at: m.createdAt ?? new Date().toISOString() },
          phones: m.phones,
        })
        continue
      }
      // A claimed address is not handed to a second contact with the same e-mail.
      if (!byRef.has(m.ref)) byEmail.delete(m.fields.email!)
      const changes: TablesUpdate<'patients'> = {}
      const diff: string[] = []
      for (const k of OVERWRITE) {
        const to = m.fields[k] ?? null
        if (to !== null && to !== found[k]) { (changes as Record<string, unknown>)[k] = to; diff.push(`${k}: ${found[k] ?? '—'} → ${to}`) }
      }
      for (const k of FILL) {
        if (m.clinical[k] && !found[k]?.trim()) { changes[k] = m.clinical[k]; diff.push(k) }
      }
      if (!found.external_reference) { changes.external_reference = m.ref; diff.push(`reference → ${m.ref}`) }
      if (practitionerId && !found.default_practitioner_id) { changes.default_practitioner_id = practitionerId; diff.push('practitioner') }
      const tags = [...new Set([...(found.tags ?? []), ...m.fields.tags])]
      if (tags.length !== (found.tags ?? []).length) { changes.tags = tags; diff.push(`tags + ${m.fields.tags.filter((x) => !(found.tags ?? []).includes(x)).join(', ')}`) }
      if (!diff.length && !m.phones.length) { unchanged++; continue }
      updates.push({ id: found.id, label: m.name, changes, diff, phones: m.phones })
    }

    // Numbers are only ever added, never replaced.
    const have = new Map<string, Set<string>>()
    const ids = updates.map((u) => u.id)
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase.from('patient_contact_numbers').select('patient_id, number').in('patient_id', ids.slice(i, i + CHUNK))
      if (error) throw new Error(`patient_contact_numbers: ${error.message}`)
      for (const n of data ?? []) have.set(n.patient_id, (have.get(n.patient_id) ?? new Set()).add(n.number.replace(/\D/g, '')))
    }
    for (const u of updates) {
      u.phones = u.phones.filter((p) => !have.get(u.id)?.has(p.number.replace(/\D/g, '')))
      for (const p of u.phones) u.diff.push(`phone + ${p.number}`)
    }
    const changed = updates.filter((u) => u.diff.length)
    unchanged += updates.length - changed.length

    return {
      stats: [
        { label: t('New', 'Nuevos'), value: nf.format(inserts.length), tone: 'good' },
        { label: t('Updated', 'Actualizados'), value: nf.format(changed.length), tone: 'good' },
        { label: t('Already up to date', 'Ya al día'), value: nf.format(unchanged) },
        ...(leftOut ? [{ label: t('Leads left out', 'Leads sin importar'), value: nf.format(leftOut) }] : []),
      ],
      columns: [{ key: 'name', label: t('Patient', 'Paciente') }, { key: 'what', label: t('Change', 'Cambio'), wrap: true }],
      rows: [
        ...inserts.map((i) => ({ name: `${i.row.first_name} ${i.row.last_name ?? ''}`.trim(), what: [t('New', 'Nuevo'), i.row.email, i.row.date_of_birth, i.phones.map((p) => p.number).join(', ')].filter(Boolean).join(' · ') })),
        ...changed.map((u) => ({ name: u.label, what: u.diff.join('\n') })),
      ],
      warnings: [
        ...(leftOut ? [t(
          `${nf.format(leftOut)} contacts are leads QuiroHiro holds no appointment or clinical record for, and are left out. Choose "Everyone" to bring them as well.`,
          `${nf.format(leftOut)} contactos son leads sin citas ni ficha clínica en QuiroHiro y no se importan. Elige «Todos» para traerlos también.`,
        )] : []),
        ...[...unmatched].map(([name, n]) => unmatchedWarning(name, n, 'patients')),
      ],
      total: inserts.length + changed.length,
      async apply(progress, shouldStop) {
        const errors: string[] = []
        let written = 0
        await inChunks(inserts, async (chunk) => {
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
          if (Object.keys(u.changes).length) { const { error } = await supabase.from('patients').update(u.changes).eq('id', u.id).eq('account_id', accountId); if (error) errors.push(`${u.label}: ${error.message}`); else written++ }
          if (u.phones.length) { const { error } = await supabase.from('patient_contact_numbers').insert(u.phones.map((p) => ({ account_id: accountId, patient_id: u.id, number: p.number, country_code: p.country_code, is_whatsapp: false }))); if (error) errors.push(`${u.label}: ${error.message}`) }
          progress(++done)
        })
        return { written, errors }
      },
    }
  }

  // --- 2 · Appointments -------------------------------------------------------------

  async function planAppointments(s: QuirohiroSnapshot, opts: QuirohiroPlanOptions): Promise<QuirohiroPlan> {
    const patients = await patientIds()
    const practitioner = await team()
    const { data: typeRows, error: typeError } = await supabase.from('appointment_types').select('id, name, duration_minutes').eq('account_id', accountId).order('id')
    if (typeError) throw new Error(`appointment_types: ${typeError.message}`)
    const types = new Map<string, { id: string; duration_minutes: number }>()
    for (const ty of typeRows ?? []) if (!types.has(ty.name.trim().toLowerCase())) types.set(ty.name.trim().toLowerCase(), ty)
    type Here = { id: string; external_reference: string; patient_id: string; status: string; starts_at: string; ends_at: string; practitioner_id: string | null; checked_in_at: string | null; rescheduled: boolean; deleted_at: string | null }
    const existing = await readAll<Here>('appointments', 'id, external_reference, patient_id, status, starts_at, ends_at, practitioner_id, checked_in_at, rescheduled, deleted_at', 'QH-appt-')
    const byRef = new Map(existing.map((a) => [a.external_reference, a]))

    const now = new Date().toISOString()
    const all = quirohiroAppointmentRows(s, now)
    const ready = all.filter((a) => patients.has(a.patientRef))
    const waiting = all.length - ready.length
    const listed = new Set(all.map((a) => a.ref))

    // The length a new type is created with: the most common one among its visits.
    const lengths = new Map<string, Map<number, number>>()
    for (const a of ready) { const m = lengths.get(a.type) ?? new Map(); m.set(a.minutes, (m.get(a.minutes) ?? 0) + 1); lengths.set(a.type, m) }
    const newTypes = [...lengths].filter(([name]) => !types.has(name.toLowerCase())).map(([name, m]) => ({ name, minutes: [...m].sort((a, b) => b[1] - a[1])[0]![0] }))

    const inserts = ready.filter((a) => !byRef.has(a.ref))
    const updates: { id: string; changes: TablesUpdate<'appointments'> }[] = []
    const unmatched = new Map<string, number>()
    let kept = 0
    for (const a of ready) {
      const practitionerId = a.practitioner ? practitioner(a.practitioner) : null
      const here = byRef.get(a.ref)
      if (!practitionerId && a.practitioner && a.status === 'booked' && !here?.practitioner_id) unmatched.set(a.practitioner, (unmatched.get(a.practitioner) ?? 0) + 1)
      if (!here || here.deleted_at) continue
      const changes: TablesUpdate<'appointments'> = {}
      const changing = [here.status !== a.status && 'status', Date.parse(here.starts_at) !== Date.parse(a.startsAt) && 'starts_at'].filter(Boolean) as string[]
      if (changing.length && quiroflowKeeps({ status: here.status, checkedInAt: here.checked_in_at, rescheduled: here.rescheduled }, changing)) kept++
      else if (changing.length) Object.assign(changes, { status: a.status, starts_at: a.startsAt, ends_at: new Date(Date.parse(a.startsAt) + a.minutes * 60000).toISOString() })
      // Only ever fills a blank: a practitioner chosen in QuiroFlow stands.
      if (!here.practitioner_id && practitionerId) changes.practitioner_id = practitionerId
      if (Object.keys(changes).length) updates.push({ id: here.id, changes })
    }

    // Appointments QuiroHiro no longer has: deleted there after they were
    // imported. Cancelled here, unless the visit is QuiroFlow's by now.
    const cancels: { id: string; startsAt: string }[] = []
    if (all.length) {
      for (const a of existing) {
        if (listed.has(a.external_reference) || a.deleted_at || a.status !== 'booked') continue
        if (quiroflowKeeps({ status: a.status, checkedInAt: a.checked_in_at, rescheduled: a.rescheduled }, ['status'])) { kept++; continue }
        cancels.push({ id: a.id, startsAt: a.starts_at })
      }
    }

    const upcoming = inserts.filter((a) => a.status === 'booked' && a.startsAt > now).length
    const unmarked = inserts.filter((a) => a.unmarked).length
    // One formatter, reused: `toLocaleString` with options builds a new one
    // per call, which is most of a large clinic's plan (see quirocitasImport's eur).
    const whenFormat = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' })
    const when = (at: string) => whenFormat.format(new Date(at))
    const noClinic = !clinicId

    return {
      stats: [
        { label: t('New', 'Nuevas'), value: nf.format(inserts.length), tone: 'good' },
        { label: t('Updated', 'Actualizadas'), value: nf.format(updates.length), tone: 'good' },
        { label: t('Upcoming', 'Próximas'), value: nf.format(upcoming) },
        { label: t('Kept as QuiroFlow has them', 'Se mantienen como en QuiroFlow'), value: nf.format(kept) },
        ...(cancels.length ? [{ label: t('Deleted in QuiroHiro', 'Borradas en QuiroHiro'), value: nf.format(cancels.length) }] : []),
      ],
      columns: [{ key: 'when', label: t('When', 'Cuándo') }, { key: 'type', label: t('Type', 'Tipo') }, { key: 'who', label: t('With', 'Con') }, { key: 'status', label: t('Status', 'Estado') }],
      rows: [
        ...cancels.map((c) => ({ when: when(c.startsAt), type: '—', who: '', status: `${statusName('booked')} → ${statusName('cancelled')}` })),
        ...inserts.map((a) => ({ when: when(a.startsAt), type: a.type, who: a.practitioner, status: statusName(a.status) + (a.unmarked ? ` (${t('not marked in QuiroHiro', 'sin marcar en QuiroHiro')})` : '') })),
      ],
      warnings: [
        ...(noClinic ? [t('Choose the clinic these appointments belong to, in the clinic switcher in the sidebar, before applying.', 'Elige la clínica de estas citas en el selector de clínica de la barra lateral antes de aplicar.')] : []),
        ...(waiting ? [t(`${nf.format(waiting)} appointments belong to patients not imported yet: run Patients first.`, `${nf.format(waiting)} citas son de pacientes aún no importados: ejecuta Pacientes antes.`)] : []),
        ...(unmarked ? [t(
          `${nf.format(unmarked)} past appointments are still "confirmed" in QuiroHiro: nobody marked whether the patient came. They come in as attended.`,
          `${nf.format(unmarked)} citas pasadas siguen «confirmadas» en QuiroHiro: nadie marcó si el paciente vino. Llegan como completadas.`,
        )] : []),
        ...(newTypes.length ? [t(
          `Creates ${newTypes.length} appointment types (${newTypes.map((x) => `${x.name}, ${x.minutes} min`).join('; ')}); set their price under Settings → Appointment types afterwards.`,
          `Crea ${newTypes.length} tipos de cita (${newTypes.map((x) => `${x.name}, ${x.minutes} min`).join('; ')}); pon su precio en Ajustes → Tipos de cita después.`,
        )] : []),
        ...(cancels.length ? [t(
          `${nf.format(cancels.length)} appointments still booked here were deleted in QuiroHiro after being imported: they are cancelled here too.`,
          `${nf.format(cancels.length)} citas que aquí siguen reservadas se borraron en QuiroHiro después de importarlas: se cancelan también aquí.`,
        )] : []),
        ...[...unmatched].map(([name, n]) => unmatchedWarning(name, n, 'appointments')),
      ],
      total: inserts.length + updates.length + cancels.length,
      async apply(progress, shouldStop) {
        if (noClinic) return { written: 0, errors: [t('Nothing was written: no clinic is chosen (see above).', 'No se escribió nada: no hay clínica elegida (ver arriba).')] }
        const errors: string[] = []
        for (const ty of newTypes) {
          const { data, error } = await supabase.from('appointment_types').insert({ account_id: accountId, name: ty.name, duration_minutes: ty.minutes }).select('id, name, duration_minutes').single()
          if (error) errors.push(`${ty.name}: ${error.message}`)
          else types.set(ty.name.toLowerCase(), data)
        }
        let written = 0
        await inChunks(inserts, async (chunk) => {
          const rows: TablesInsert<'appointments'>[] = chunk.map((a) => {
            const quiet = opts.quietUpcoming && a.status === 'booked' && a.startsAt > now
            return {
              account_id: accountId,
              clinic_id: clinicId!,
              patient_id: patients.get(a.patientRef)!,
              appointment_type_id: types.get(a.type.toLowerCase())?.id ?? null,
              practitioner_id: a.practitioner ? practitioner(a.practitioner) : null,
              practitioner_name: a.practitioner || null,
              starts_at: a.startsAt,
              ends_at: new Date(Date.parse(a.startsAt) + a.minutes * 60000).toISOString(),
              status: a.status,
              rescheduled: a.rescheduled,
              note: a.note,
              external_reference: a.ref,
              // QuiroHiro is still reminding these patients while both run.
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
          const { error } = await supabase.from('appointments').update(u.changes).eq('id', u.id).eq('account_id', accountId)
          if (error) errors.push(error.message); else written++
          progress(++done)
        })
        await withConcurrency(cancels, 8, async (c) => {
          if (shouldStop()) return
          // Only while it is still as planned: someone may have moved it or checked the patient in meanwhile.
          const { data, error } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', c.id).eq('account_id', accountId).eq('status', 'booked').eq('rescheduled', false).is('checked_in_at', null).select('id')
          if (error) errors.push(error.message); else written += data?.length ?? 0
          progress(++done)
        })
        return { written, errors }
      },
    }
  }

  // --- 3 · Clinical record and notes ---------------------------------------------------

  async function planClinical(s: QuirohiroSnapshot, opts: QuirohiroPlanOptions): Promise<QuirohiroPlan> {
    const zone = await practiceHubClinicZone(supabase, accountId, clinicId)
    const patients = await patientIds()
    const appts = new Map((await readAll<{ id: string; external_reference: string }>('appointments', 'id, external_reference', 'QH-appt-')).map((a) => [a.external_reference, a.id]))
    const logs = new Map((await readAll<{ id: string; external_reference: string; note: string | null }>('contact_log', 'id, external_reference, note', 'QH-')).map((l) => [l.external_reference, l]))
    const visitNotes = new Set((await readAll<{ external_reference: string }>('visit_notes', 'external_reference', 'QH-note-')).map((n) => n.external_reference))

    // The record: one entry per patient, rewritten when QuiroHiro's changes.
    const chosen = quirohiroPatients(s, opts.who)
    const records = chosen.map((c) => ({ ref: qhRecordRef(c.id), patientRef: `QH-${c.id}`, text: quirohiroRecordText(c, s), at: c.dateAdded ?? null })).filter((r) => r.text)
    const newRecords = records.filter((r) => patients.has(r.patientRef) && !logs.has(r.ref))
    const changedRecords = records.filter((r) => logs.has(r.ref) && logs.get(r.ref)!.note !== r.text)
    const files = chosen.reduce((a, c) => a + quirohiroFileCount(c, s), 0)

    // Notes: on their visit when it is here, on the history otherwise.
    const notes = quirohiroNoteRows(s, zone).filter((n) => patients.has(n.patientRef) && !visitNotes.has(n.ref) && !logs.has(n.ref))
    const onVisit = notes.filter((n) => n.appointmentRef && appts.has(n.appointmentRef))
    const onHistory = notes.filter((n) => !n.appointmentRef || !appts.has(n.appointmentRef))
    const waitingVisit = onHistory.filter((n) => n.appointmentRef).length
    const waiting = records.filter((r) => !patients.has(r.patientRef)).length + quirohiroNoteRows(s, zone).filter((n) => !patients.has(n.patientRef)).length

    return {
      stats: [
        { label: t('Clinical records', 'Fichas clínicas'), value: nf.format(newRecords.length), tone: 'good' },
        ...(changedRecords.length ? [{ label: t('Records updated', 'Fichas actualizadas'), value: nf.format(changedRecords.length), tone: 'good' as const }] : []),
        { label: t('Visit notes', 'Notas de visita'), value: nf.format(onVisit.length), tone: 'good' },
        { label: t('Other notes', 'Otras notas'), value: nf.format(onHistory.length), tone: 'good' },
      ],
      columns: [{ key: 'kind', label: t('What', 'Qué') }, { key: 'body', label: t('Text', 'Texto'), wrap: true }],
      rows: [
        ...[...newRecords, ...changedRecords].map((r) => ({ kind: t('Record', 'Ficha'), body: r.text })),
        ...onVisit.map((n) => ({ kind: t('Visit note', 'Nota de visita'), body: n.text })),
        ...onHistory.map((n) => ({ kind: t('Note', 'Nota'), body: n.text })),
      ],
      warnings: [
        ...(waiting ? [t(`${nf.format(waiting)} records and notes wait for their patient: run Patients first.`, `${nf.format(waiting)} fichas y notas esperan a su paciente: ejecuta Pacientes antes.`)] : []),
        ...(waitingVisit ? [t(
          `${nf.format(waitingVisit)} notes were written on the day of a visit that is not here yet: they go on the patient's history. Run Appointments first to have them on their visit.`,
          `${nf.format(waitingVisit)} notas se escribieron el día de una visita que aún no está aquí: van al historial del paciente. Ejecuta Citas antes para tenerlas en su visita.`,
        )] : []),
        ...(files ? [t(
          `${nf.format(files)} files and signatures in QuiroHiro's custom fields are not copied by this import: download them from QuiroHiro if you need them.`,
          `${nf.format(files)} archivos y firmas de los campos personalizados de QuiroHiro no se copian en esta importación: descárgalos de QuiroHiro si los necesitas.`,
        )] : []),
      ],
      total: newRecords.length + changedRecords.length + onVisit.length + onHistory.length,
      async apply(progress, shouldStop) {
        const errors: string[] = []
        let written = 0
        let done = 0
        const step = (n: number) => progress(done + n)
        await inChunks(newRecords, async (chunk) => {
          const { error } = await supabase.from('contact_log').insert(chunk.map((r) => ({ account_id: accountId, patient_id: patients.get(r.patientRef)!, action: 'other', note: r.text, external_reference: r.ref, created_at: r.at ?? new Date().toISOString() })))
          if (error) errors.push(error.message); else written += chunk.length
        }, step, shouldStop)
        done += newRecords.length
        await withConcurrency(changedRecords, 8, async (r) => {
          if (shouldStop()) return
          const { error } = await supabase.from('contact_log').update({ note: r.text }).eq('id', logs.get(r.ref)!.id).eq('account_id', accountId)
          if (error) errors.push(error.message); else written++
          progress(++done)
        })
        await inChunks(onVisit, async (chunk) => {
          const { error } = await supabase.from('visit_notes').insert(chunk.map((n) => ({ account_id: accountId, appointment_id: appts.get(n.appointmentRef!)!, body: n.text, external_reference: n.ref, created_at: n.at })))
          if (error) errors.push(error.message); else written += chunk.length
        }, step, shouldStop)
        done += onVisit.length
        await inChunks(onHistory, async (chunk) => {
          const { error } = await supabase.from('contact_log').insert(chunk.map((n) => ({ account_id: accountId, patient_id: patients.get(n.patientRef)!, action: 'other', note: n.text, external_reference: n.ref, created_at: n.at })))
          if (error) errors.push(error.message); else written += chunk.length
        }, step, shouldStop)
        return { written, errors }
      },
    }
  }

  return {
    plan(kind: QuirohiroStepKind, s: QuirohiroSnapshot, opts: QuirohiroPlanOptions): Promise<QuirohiroPlan> {
      switch (kind) {
        case 'patients': return planPatients(s, opts)
        case 'appointments': return planAppointments(s, opts)
        case 'clinical': return planClinical(s, opts)
      }
    },
  }
}
