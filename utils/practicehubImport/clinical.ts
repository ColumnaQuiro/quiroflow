import { readAllForAccount, withConcurrency } from '~/utils/practicehubImport/appointments'
import { practiceHubList, type PracticeHubImportContext, type PracticeHubListPath, type PracticeHubPlan, type PracticeHubStepPlanner, type PracticeHubSnapshot } from '~/utils/practicehubImport/types'
import { buildStickyNotePlan, collectFieldNames, detectStickyField, type ExistingPatient, type PracticeHubPatientRecord } from '~/utils/practiceHubStickyNotes'

// The clinical steps of a PracticeHub import, run on the server
// (server/utils/importJobs.ts) from the copy of PracticeHub's Classic API in
// import_snapshots: Treatment notes, Care plans (Classic), Patient logs and
// Sticky notes. Each is its browser importer with the screen taken away --
//
//   components/import/PracticeHubClinicalNotesImporter.vue  -> planTreatmentNotes
//   components/import/PracticeHubCarePlansImporter.vue      -> planCarePlans
//   components/import/PracticeHubPatientLogsImporter.vue    -> planPatientLogs
//   components/import/PracticeHubStickyNotesImporter.vue    -> planStickyNotes
//
// -- and where a rule is shared, the component imports it from here, so there
// is one copy of it.
//
// The first three write rows into the patient's contact history
// (contact_log), each recognised by its PracticeHub id ("PH-clinicalnote-",
// "PH-careplan-", "PH-log-"), so a second run -- or the next slice of this
// one -- adds only what is new. Sticky notes are a column on the patient, and
// a note that already matches PracticeHub's is left alone. Nothing here
// deletes, and none of these creates a patient: a record whose patient is not
// here yet is skipped and reported, and Patients is the step that fixes that.

// --- PracticeHub's rows, as the Classic API sends them ---------------------------------

export interface PracticeHubSoapItem { key?: string; val?: string; label?: string; value?: string }
export interface PracticeHubClinicalNote {
  id: number
  patient_id: number | string
  state: string
  type: string
  data: { soap_data?: PracticeHubSoapItem[] } | null
  created: string
}
export interface PracticeHubCarePlan {
  id: number
  patient_id: number | string
  start_date: string
  active: number
  visits: number
  interval: string
  duration: number
  frequency_type: string
}
export interface PracticeHubPatientLog {
  id: number
  patient_id: number | string
  type: string
  sub_type: string | null
  data: string | null
  created: string
}

// --- shared with the browser importers -----------------------------------------------

function clinicalNoteStripHtml(value: string): string {
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
}

/** A treatment note's SOAP sections as "Label: text" lines, the way it lands in the contact history. */
export function practiceHubClinicalNoteText(note: Pick<PracticeHubClinicalNote, 'data'>): string {
  const items = note.data?.soap_data ?? []
  const lines = items
    .map((item) => {
      const label = item.key ?? item.label ?? ''
      const value = clinicalNoteStripHtml(item.val ?? item.value ?? '')
      return value ? `${label}: ${value}` : ''
    })
    .filter(Boolean)
  return lines.join('\n') || '(empty)'
}

/**
 * A Classic care plan as one line of the contact history. Stored text, in
 * English as every import so far has written it: changing it would leave one
 * clinic's history in two wordings.
 */
export function practiceHubCarePlanSummary(plan: PracticeHubCarePlan): string {
  return `${plan.visits} visit(s), every ${plan.interval}, for ${plan.duration} occurrence(s) (${plan.frequency_type}) starting ${plan.start_date}. ${plan.active ? 'Active.' : 'Inactive.'}`
}

/** A log entry's body without its HTML, or null when nothing is left. Not the treatment notes' version: no &nbsp;, and empty is null. */
export function practiceHubLogBody(value: string | null): string | null {
  if (!value) return null
  const text = value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim()
  return text || null
}

/** "note" or "note/sub_type": the PracticeHub type a log entry keeps on its note. */
export const practiceHubLogTypeLabel = (log: Pick<PracticeHubPatientLog, 'type' | 'sub_type'>) => (log.sub_type ? `${log.type}/${log.sub_type}` : log.type)

/**
 * The contact-history note a PracticeHub log entry becomes.
 *
 * contact_log.action is a fixed enum for staff outreach actions
 * (sent_whatsapp, called_no_answer, ...) and doesn't have a slot for
 * PracticeHub's log types (note, appt, sms, ...) -- everything imported here
 * lands as 'other', with the original type kept as a prefix on the note text
 * instead so it isn't lost.
 */
export function practiceHubLogNote(log: Pick<PracticeHubPatientLog, 'type' | 'sub_type' | 'data'>): string {
  return `[${practiceHubLogTypeLabel(log)}] ${practiceHubLogBody(log.data) ?? ''}`.trim()
}

/** Shortens a note for a preview row. */
export function practiceHubPreviewTruncate(value: string, max = 90): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

// --- matching to the patients here ---------------------------------------------------

export interface PracticeHubPatientHere { id: string; label: string }

export interface PracticeHubContactLogCandidate {
  ref: string
  patientId: string
  patientLabel: string
  note: string
  createdAt: string
}

export interface PracticeHubContactLogRows<R> {
  candidates: (PracticeHubContactLogCandidate & { source: R })[]
  skippedDuplicate: number
  skippedUnmatched: number
}

/**
 * What one contact-history step writes: every PracticeHub row not already
 * here by its reference, whose patient is here.
 *
 * PracticeHub's own patient id is not what we store: every importer keys on
 * patient_number, the "Patient Number" the CSV exports. Both ids are compared
 * as text, since the Classic API sends some as numbers and some as strings.
 */
export function practiceHubContactLogRows<R extends { id: number | string; patient_id: number | string }>(
  rows: R[],
  opts: {
    prefix: string
    phPatients: { id: number | string; patient_number: string }[]
    ourPatientByRef: Map<string, PracticeHubPatientHere>
    haveRefs: Set<string>
    note: (row: R) => string
    createdAt: (row: R) => string
  },
): PracticeHubContactLogRows<R> {
  const patientNumberById = new Map(opts.phPatients.map((p) => [String(p.id), p.patient_number]))
  const out: PracticeHubContactLogRows<R> = { candidates: [], skippedDuplicate: 0, skippedUnmatched: 0 }
  for (const row of rows) {
    const ref = `${opts.prefix}${row.id}`
    if (opts.haveRefs.has(ref)) {
      out.skippedDuplicate++
      continue
    }
    const patientNumber = patientNumberById.get(String(row.patient_id))
    const patient = patientNumber ? opts.ourPatientByRef.get(patientNumber) : undefined
    if (!patient) {
      out.skippedUnmatched++
      continue
    }
    out.candidates.push({ ref, patientId: patient.id, patientLabel: patient.label, note: opts.note(row), createdAt: opts.createdAt(row), source: row })
  }
  return out
}

// --- reading and writing ----------------------------------------------------------

const CONTACT_LOG_CHUNK = 200
const STICKY_CHUNK = 100
const STICKY_CONCURRENCY = 8

const previewDate = (at: string) => (/^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : at)

/** The account's patients that came from an import, by their reference. A failed page throws (see readAllForAccount): half the patients would read as the rest being unmatched. */
async function patientsHereByRef(ctx: PracticeHubImportContext): Promise<Map<string, PracticeHubPatientHere>> {
  const rows = await readAllForAccount<{ id: string; external_reference: string | null; first_name: string; last_name: string | null }>(
    ctx.supabase, ctx.accountId, 'patients', 'id, external_reference, first_name, last_name',
    (q) => q.not('external_reference', 'is', null),
  )
  const byRef = new Map<string, PracticeHubPatientHere>()
  for (const p of rows) if (p.external_reference) byRef.set(p.external_reference, { id: p.id, label: `${p.first_name} ${p.last_name ?? ''}`.trim() })
  return byRef
}

/** References of this account's contact-history rows a step wrote. Read wrong, every one would look new and be written a second time -- so it throws instead. */
async function contactLogRefs(ctx: PracticeHubImportContext, prefix: string): Promise<Set<string>> {
  const rows = await readAllForAccount<{ external_reference: string | null }>(
    ctx.supabase, ctx.accountId, 'contact_log', 'external_reference',
    (q) => q.like('external_reference', `${prefix}%`),
  )
  return new Set(rows.map((r) => r.external_reference).filter(Boolean) as string[])
}

interface ContactLogStep<R> {
  list: PracticeHubListPath
  prefix: string
  note: (row: R) => string
  createdAt: (row: R) => string
  stats: (counts: { will: number; already: number; unmatched: number }) => PracticeHubPlan['stats']
  columns: PracticeHubPlan['columns']
  row: (c: PracticeHubContactLogCandidate & { source: R }) => Record<string, string>
  /** Why some were skipped: their patient is not here yet. */
  unmatched: (count: string) => string
  /** "Notes 1-200 were not saved: …" for the rows from..to of this run. */
  failed: (from: number, to: number, message: string) => string
}

async function planContactLogStep<R extends { id: number | string; patient_id: number | string }>(
  ctx: PracticeHubImportContext,
  snapshot: PracticeHubSnapshot,
  step: ContactLogStep<R>,
): Promise<PracticeHubPlan> {
  const { supabase, accountId } = ctx
  const nf = new Intl.NumberFormat('es-ES')

  const phPatients = practiceHubList<{ id: number | string; patient_number: string }>(snapshot, '/patients')
  const phRows = practiceHubList<R>(snapshot, step.list)
  const [ourPatientByRef, haveRefs] = await Promise.all([patientsHereByRef(ctx), contactLogRefs(ctx, step.prefix)])

  const { candidates, skippedDuplicate, skippedUnmatched } = practiceHubContactLogRows(phRows, {
    prefix: step.prefix,
    phPatients,
    ourPatientByRef,
    haveRefs,
    note: step.note,
    createdAt: step.createdAt,
  })

  return {
    stats: step.stats({ will: candidates.length, already: skippedDuplicate, unmatched: skippedUnmatched }).map((s) => ({ ...s, value: typeof s.value === 'number' ? nf.format(s.value) : s.value })),
    columns: step.columns,
    rows: candidates.map(step.row),
    warnings: skippedUnmatched ? [step.unmatched(nf.format(skippedUnmatched))] : [],
    total: candidates.length,
    async apply(progress, shouldStop) {
      const errors: string[] = []
      let written = 0
      for (let i = 0; i < candidates.length; i += CONTACT_LOG_CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = candidates.slice(i, i + CONTACT_LOG_CHUNK)
        const { data, error } = await supabase
          .from('contact_log')
          .insert(chunk.map((c) => ({
            account_id: accountId,
            patient_id: c.patientId,
            action: 'other',
            note: c.note,
            external_reference: c.ref,
            created_at: c.createdAt,
          })))
          .select('id')
        if (error) errors.push(step.failed(i + 1, i + chunk.length, error.message))
        else written += data?.length ?? 0
        progress(Math.min(i + CONTACT_LOG_CHUNK, candidates.length))
      }
      return { written, errors }
    },
  }
}

// --- the steps -----------------------------------------------------------------------

/** Treatment notes: the notes written at each visit, into the patient's contact history, dated when they were written. */
export const planTreatmentNotes: PracticeHubStepPlanner = (ctx, snapshot) => {
  const { t } = ctx
  return planContactLogStep<PracticeHubClinicalNote>(ctx, snapshot, {
    list: '/clinical_notes',
    prefix: 'PH-clinicalnote-',
    note: (note) => `[clinical_note/${note.type}] ${practiceHubClinicalNoteText(note)}`,
    createdAt: (note) => note.created,
    stats: (n) => [
      { label: t('Will import', 'Se importarán'), value: n.will, tone: 'good' },
      { label: t('Already imported', 'Ya importadas'), value: n.already },
      { label: t('No matching patient', 'Sin paciente coincidente'), value: n.unmatched },
    ],
    columns: [
      { key: 'date', label: t('Date', 'Fecha') },
      { key: 'patient', label: t('Patient', 'Paciente') },
      { key: 'type', label: t('Type in PracticeHub', 'Tipo en PracticeHub') },
      { key: 'note', label: t('Note', 'Nota'), wrap: true },
    ],
    row: (c) => ({ date: previewDate(c.createdAt), patient: c.patientLabel, type: c.source.type, note: practiceHubPreviewTruncate(c.note) }),
    unmatched: (n) => t(`${n} notes are skipped because their patient is not here yet. Run Patients first.`, `Se omiten ${n} notas porque su paciente aún no está aquí. Ejecuta antes Pacientes.`),
    failed: (from, to, message) => t(`Notes ${from}-${to} were not saved: ${message}`, `No se guardaron las notas ${from}-${to}: ${message}`),
  })
}

/** Care plans (Classic): each patient's course of treatment, as an entry in their contact history. */
export const planCarePlans: PracticeHubStepPlanner = (ctx, snapshot) => {
  const { t } = ctx
  return planContactLogStep<PracticeHubCarePlan>(ctx, snapshot, {
    list: '/care_plans',
    prefix: 'PH-careplan-',
    note: (plan) => `[care_plan] ${practiceHubCarePlanSummary(plan)}`,
    createdAt: (plan) => plan.start_date,
    stats: (n) => [
      { label: t('Will import', 'Se importarán'), value: n.will, tone: 'good' },
      { label: t('Already imported', 'Ya importados'), value: n.already },
      { label: t('No matching patient', 'Sin paciente coincidente'), value: n.unmatched },
    ],
    columns: [
      { key: 'start', label: t('Starts', 'Empieza') },
      { key: 'patient', label: t('Patient', 'Paciente') },
      { key: 'plan', label: t('Plan', 'Plan'), wrap: true },
    ],
    row: (c) => ({ start: c.source.start_date, patient: c.patientLabel, plan: practiceHubCarePlanSummary(c.source) }),
    unmatched: (n) => t(`${n} care plans are skipped because their patient is not here yet. Run Patients first.`, `Se omiten ${n} planes porque su paciente aún no está aquí. Ejecuta antes Pacientes.`),
    failed: (from, to, message) => t(`Care plans ${from}-${to} were not saved: ${message}`, `No se guardaron los planes ${from}-${to}: ${message}`),
  })
}

/** Patient logs: each patient's history entries, into their contact history. */
export const planPatientLogs: PracticeHubStepPlanner = (ctx, snapshot) => {
  const { t } = ctx
  return planContactLogStep<PracticeHubPatientLog>(ctx, snapshot, {
    list: '/patient_logs',
    prefix: 'PH-log-',
    note: (log) => practiceHubLogNote(log),
    createdAt: (log) => log.created,
    stats: (n) => [
      { label: t('Will import', 'Se importarán'), value: n.will, tone: 'good' },
      { label: t('Already imported', 'Ya importados'), value: n.already },
      { label: t('No matching patient', 'Sin paciente coincidente'), value: n.unmatched },
    ],
    columns: [
      { key: 'date', label: t('Date', 'Fecha') },
      { key: 'patient', label: t('Patient', 'Paciente') },
      { key: 'type', label: t('Type', 'Tipo') },
      { key: 'note', label: t('Note', 'Nota'), wrap: true },
    ],
    row: (c) => ({ date: previewDate(c.createdAt), patient: c.patientLabel, type: practiceHubLogTypeLabel(c.source), note: practiceHubPreviewTruncate(c.note) }),
    unmatched: (n) => t(`${n} entries are skipped because their patient is not here yet. Run Patients first.`, `Se omiten ${n} entradas porque su paciente aún no está aquí. Ejecuta antes Pacientes.`),
    failed: (from, to, message) => t(`Log entries ${from}-${to} were not saved: ${message}`, `No se guardaron las entradas ${from}-${to}: ${message}`),
  })
}

/**
 * Sticky notes: the note that shows on the calendar when you hover an
 * appointment. It updates patients already here and never creates one; which
 * field of PracticeHub's patient records carries the note is found in the
 * records themselves (utils/practiceHubStickyNotes.ts says why), and the
 * preview names the field it settled on so a wrong guess is visible before
 * anything is written.
 */
export const planStickyNotes: PracticeHubStepPlanner = async (ctx, snapshot): Promise<PracticeHubPlan> => {
  const { supabase, accountId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')

  const phPatients = practiceHubList<PracticeHubPatientRecord>(snapshot, '/patients')
  const stickyField = detectStickyField(phPatients)
  if (!stickyField) {
    const fields = collectFieldNames(phPatients).join(', ')
    return {
      stats: [{ label: t('Will import', 'Se importarán'), value: nf.format(0) }],
      columns: [],
      rows: [],
      warnings: [
        t(
          "No sticky note field found. PracticeHub's patient records came back without any field whose name looks like a sticky note, so there is nothing to import. If one of the fields below is the sticky note under another name, contact QuiroFlow with its name so it can be read.",
          'No se encontró el campo de nota adhesiva. Los registros de pacientes de PracticeHub no incluyen ningún campo cuyo nombre parezca una nota adhesiva, así que no hay nada que importar. Si alguno de los campos de abajo es la nota adhesiva con otro nombre, contacta con QuiroFlow indicando cuál para que se pueda leer.',
        ),
        t(`Fields PracticeHub returned: ${fields}`, `Campos devueltos por PracticeHub: ${fields}`),
      ],
      total: 0,
      async apply() { return { written: 0, errors: [] } },
    }
  }

  const rows = await readAllForAccount<{ id: string; external_reference: string | null; first_name: string; last_name: string | null; sticky_note: string | null }>(
    supabase, accountId, 'patients', 'id, external_reference, first_name, last_name, sticky_note',
    (q) => q.not('external_reference', 'is', null),
  )
  const ourPatients = new Map<string, ExistingPatient>()
  for (const p of rows) {
    if (!p.external_reference) continue
    ourPatients.set(p.external_reference, { id: p.id, label: `${p.first_name} ${p.last_name ?? ''}`.trim(), sticky: p.sticky_note })
  }

  const plan = buildStickyNotePlan(phPatients, stickyField, ourPatients)
  const { candidates } = plan
  const shown = (value: string | null) => (value ? practiceHubPreviewTruncate(value, 80) : t('(blank)', '(vacío)'))

  return {
    stats: [
      { label: t('Will import', 'Se importarán'), value: nf.format(candidates.length), tone: 'good' },
      { label: t('Already up to date', 'Ya actualizadas'), value: nf.format(plan.skippedUnchanged) },
      { label: t('No matching patient', 'Sin paciente coincidente'), value: nf.format(plan.skippedUnmatched) },
      { label: t('No sticky note', 'Sin nota adhesiva'), value: nf.format(plan.skippedEmpty) },
      { label: t('Reading from PracticeHub field', 'Leyendo del campo de PracticeHub'), value: stickyField },
    ],
    columns: [
      { key: 'patient', label: t('Patient', 'Paciente') },
      { key: 'current', label: t('Current note', 'Nota actual'), wrap: true },
      { key: 'next', label: t('New note', 'Nota nueva'), wrap: true },
    ],
    rows: candidates.map((c) => ({ patient: c.label, current: shown(c.current), next: shown(c.next) })),
    warnings: candidates.some((c) => c.current)
      ? [t(
        'Patients with a note already filled in here will have it replaced by the PracticeHub one, matching how the Patients import treats PracticeHub as the source of truth until cutover.',
        'A los pacientes que ya tengan una nota aquí se les reemplazará por la de PracticeHub, igual que la importación de pacientes trata a PracticeHub como fuente de verdad hasta el cambio definitivo.',
      )]
      : [],
    total: candidates.length,
    async apply(progress, shouldStop) {
      const errors: string[] = []
      let written = 0
      let done = 0
      for (let i = 0; i < candidates.length; i += STICKY_CHUNK) {
        if (shouldStop()) return { written, errors }
        await withConcurrency(candidates.slice(i, i + STICKY_CHUNK), STICKY_CONCURRENCY, async (row) => {
          const { error } = await supabase.from('patients').update({ sticky_note: row.next }).eq('id', row.patientId).eq('account_id', accountId)
          if (error) errors.push(t(`${row.label} (${row.patientNumber}): the note was not saved. ${error.message}`, `${row.label} (${row.patientNumber}): la nota no se guardó. ${error.message}`))
          else written++
          progress(++done)
        })
      }
      return { written, errors }
    },
  }
}
