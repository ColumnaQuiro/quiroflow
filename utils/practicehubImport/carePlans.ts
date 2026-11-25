import { byExactName, practiceHubTypesHere, readAllForAccount } from '~/utils/practicehubImport/appointments'
import { patientsHereByRef, practiceHubCarePlanSummary, type PracticeHubCarePlan, type PracticeHubPatientHere } from '~/utils/practicehubImport/clinical'
import { practiceHubList, type PracticeHubPlan, type PracticeHubStepPlanner } from '~/utils/practicehubImport/types'

// Care plans (Classic): each PracticeHub plan becomes a QuiroFlow care plan --
// the plan on the patient file, the one Care Plan Alerts, segments, the
// receptionist and the staff app read -- rather than a line of text in the
// contact history, which is all they used to be.
//
// What PracticeHub Classic sends, measured on one clinic's 1,970 plan rows:
//
//   * A row is a PHASE. Most plans have one; a plan with two ("2 a week for
//     3 weeks, then 1 a week for 9") sends two rows under the same id, in
//     that order (147 of 151), both carrying the PLAN's start date: when the
//     second phase began is not in the data. `visits` is per period,
//     `interval` is the period ("+1 week", "+2 weeks", "+1 month"),
//     `duration` is how many periods; frequency_type "ongoing", or a
//     duration of 0, has no end. (`version` was 1 on every row.)
//   * `visit_rules` carries the plan's one-off visits: {period: "one-off",
//     appt_type: "4", appt_number: "15"} is "visit 15 is a re-exam", counted
//     across the whole plan -- every phase row repeats it, and on a
//     two-phase plan it is the plan's last visit, 6 + 9 above.
//   * A patient's next plan is a new id, starting the day the last ended.
//
// QuiroFlow's model is the same shape: a care_plans row is a phase; the
// phases still to come wait in next_phases; and care_plan_start_next_phase
// starts the next one as a new row THE DAY AFTER the visit that completes the
// current one. That trigger fires as a visit is marked done, and the import
// brings the visits first -- so here it is replayed over the patient's
// completed visits: every phase already finished is written as the row the
// trigger would have made, with the date it would have given it, the phase
// the patient is in is the latest row, and the rest wait on it. Every reader
// then sees what it would have seen had the plan been run here.
//
// A one-off visit becomes a marker on the phase it falls in, renumbered
// within it, with its appointment type when a type of that name is here (else
// it only highlights the visit, labelled with the name). One past the end of
// a plan that has an end is dropped.
//
// What stays a note in the contact history, as before: a plan PracticeHub has
// switched off (`active` 0) -- QuiroFlow has no "ended" plan, and a patient
// discharged in PracticeHub would be listed in Care Plan Alerts -- and a
// plan QuiroFlow cannot hold (more than 7 visits a period, a period in days
// that is not whole weeks, a phase with no end before another). The preview
// counts both.
//
// Recognised again by "PH-careplan-<id>-<phase>". Once any phase of a plan is
// here, the plan is the clinic's: what PracticeHub changes later is not
// brought across, as the rest of the import keeps QuiroFlow's copy of a
// record once someone has acted on it. Plans imported earlier as a note
// ("PH-careplan-<id>" in contact_log, one per phase row) are MOVED: the plan
// is written first, then the notes go, so a run cut off in between leaves
// notes the next run clears, never a lost plan.
//
// No automation fires on an imported plan: "care plan created" and "care plan
// starts" both leave out rows with an external_reference
// (server/utils/automationAtomRules.ts, server/utils/automationTriggers.ts),
// as they already do for imported bonos and invoices.

export interface PracticeHubCarePlanRow extends PracticeHubCarePlan {
  version?: number | string | null
  visit_rules?: { period?: string; appt_type?: string | number | null; appt_number?: string | number | null }[] | null
}

/** One phase as QuiroFlow stores it. startedAt is the plan's start until splitPhases dates it. */
export interface PracticeHubPhase {
  ref: string
  startedAt: string
  visitsPerPeriod: number
  frequencyValue: number
  frequencyUnit: 'week' | 'month'
  totalVisits: number | null
  markers: { at: number; appointment_type_id?: string; label?: string }[]
}

/** What one PracticeHub plan becomes. */
export type PracticeHubPlanOutcome =
  | { kind: 'plan'; planId: string; source: PracticeHubCarePlanRow; phases: PracticeHubPhase[] }
  | { kind: 'note'; planId: string; source: PracticeHubCarePlanRow; reason: 'inactive' | 'unsupported' }

const PREFIX = 'PH-careplan-'
export const practiceHubCarePlanRef = (planId: string | number, phase: number) => `${PREFIX}${planId}-${phase}`
/** The plan id a care_plans reference names, or null for any other (the old notes' "PH-careplan-<id>" among them). */
export function practiceHubCarePlanIdOf(ref: string | null | undefined): string | null {
  const m = ref ? /^PH-careplan-(\d+)-\d+$/.exec(ref) : null
  return m ? m[1]! : null
}

/** "+2 weeks" -> 2 week; "+1 month" -> 1 month; "+14 days" -> 2 week; anything else null. */
export function practiceHubInterval(raw: string | null | undefined): { value: number; unit: 'week' | 'month' } | null {
  const m = /^\+?\s*(\d+)\s*(day|week|month)s?$/i.exec(String(raw ?? '').trim())
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2]!.toLowerCase()
  if (!n) return null
  if (unit === 'day') return n % 7 === 0 && n / 7 <= 52 ? { value: n / 7, unit: 'week' } : null
  return n <= 52 ? { value: n, unit: unit as 'week' | 'month' } : null
}

const toInt = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : NaN
}

/**
 * What every PracticeHub plan becomes: its phase rows grouped by id, in the
 * order PracticeHub lists them, each turned into a phase with its re-exam
 * markers. `typeFor` names our appointment type for a PracticeHub type id,
 * when there is one. When each phase started is splitPhases' business.
 */
export function practiceHubCarePlanOutcomes(
  rows: readonly PracticeHubCarePlanRow[],
  opts: { typeFor: (phTypeId: string) => { id?: string; label?: string } },
): PracticeHubPlanOutcome[] {
  const byId = new Map<string, PracticeHubCarePlanRow[]>()
  for (const r of rows) {
    const id = String(r.id)
    const list = byId.get(id)
    if (list) list.push(r)
    else byId.set(id, [r])
  }

  const out: PracticeHubPlanOutcome[] = []
  for (const [planId, phaseRows] of byId) {
    // A stable sort: rows of the same version and start keep PracticeHub's order.
    phaseRows.sort((a, b) => (toInt(a.version) || 1) - (toInt(b.version) || 1) || String(a.start_date).localeCompare(String(b.start_date)))
    const latest = phaseRows.at(-1)!
    if (!phaseRows.some((v) => Number(v.active))) {
      out.push({ kind: 'note', planId, source: latest, reason: 'inactive' })
      continue
    }

    const phases: PracticeHubPhase[] = []
    let unsupported = false
    for (const [i, v] of phaseRows.entries()) {
      const every = practiceHubInterval(v.interval)
      const perPeriod = toInt(v.visits)
      const periods = toInt(v.duration)
      const startedAt = String(v.start_date ?? '').slice(0, 10)
      if (!every || !(perPeriod >= 1 && perPeriod <= 7) || !/^\d{4}-\d{2}-\d{2}$/.test(startedAt)) {
        unsupported = true
        break
      }
      const open = v.frequency_type === 'ongoing' || !(periods > 0)
      phases.push({
        ref: practiceHubCarePlanRef(planId, i + 1),
        startedAt,
        visitsPerPeriod: perPeriod,
        frequencyValue: every.value,
        frequencyUnit: every.unit,
        totalVisits: open ? null : perPeriod * periods,
        markers: [],
      })
    }
    // A phase with no end can only be the last: nothing after it would start.
    // And a plan queues six phases at most, or 200 visits in one.
    if (unsupported || phases.slice(0, -1).some((p) => p.totalVisits === null) || phases.length > 7 || phases.slice(1).some((p) => (p.totalVisits ?? 0) > 200)) {
      out.push({ kind: 'note', planId, source: latest, reason: 'unsupported' })
      continue
    }

    // One-off visits, numbered across the whole plan, onto the phase each
    // falls in. Every phase row repeats them, so they are read once, by number.
    const oneOffs = new Map<number, string>()
    for (const v of phaseRows) {
      for (const rule of v.visit_rules ?? []) {
        if (rule?.period !== 'one-off') continue
        const at = toInt(rule.appt_number)
        if (at >= 1 && at <= 999 && !oneOffs.has(at)) oneOffs.set(at, String(rule.appt_type ?? ''))
      }
    }
    const marked = [...oneOffs].sort((a, b) => a[0] - b[0])
    let before = 0
    for (const phase of phases) {
      for (const [at, phType] of marked) {
        const within = at - before
        if (within < 1 || (phase.totalVisits !== null && within > phase.totalVisits) || phase.markers.length >= 8) continue
        const type = phType ? opts.typeFor(phType) : {}
        phase.markers.push({ at: within, ...(type.id ? { appointment_type_id: type.id } : {}), ...(type.label ? { label: type.label.slice(0, 40) } : {}) })
      }
      before += phase.totalVisits ?? 0
    }

    out.push({ kind: 'plan', planId, source: latest, phases })
  }
  return out
}

const nextDay = (iso: string) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/**
 * Which phases the patient has been through, replaying
 * care_plan_start_next_phase over their completed visits (ISO, any order):
 * a phase is over at its total_visits-th completed visit on or after its
 * start, and the next starts the day after that visit (UTC, as the trigger
 * dates it). The finished phases and the current one are rows, dated so; the
 * phases after it wait in next_phases on the current one.
 */
export function practiceHubSplitPhases(phases: readonly PracticeHubPhase[], completedVisits: readonly string[]): { rows: PracticeHubPhase[]; queued: PracticeHubPhase[] } {
  const visits = [...completedVisits].sort()
  const rows: PracticeHubPhase[] = []
  let startedAt = phases[0]!.startedAt
  for (const [i, phase] of phases.entries()) {
    rows.push({ ...phase, startedAt })
    if (i === phases.length - 1 || phase.totalVisits === null) return { rows, queued: phases.slice(i + 1).map((p) => ({ ...p })) }
    const since = visits.filter((v) => v >= `${startedAt}T00:00:00`)
    const last = since[phase.totalVisits - 1]
    if (!last) return { rows, queued: phases.slice(i + 1).map((p) => ({ ...p })) }
    startedAt = nextDay(last)
  }
  return { rows, queued: [] }
}

// --- the step -----------------------------------------------------------------------

const CHUNK = 200

interface PlanToWrite {
  planId: string
  patientId: string
  patientLabel: string
  rows: PracticeHubPhase[]
  queued: PracticeHubPhase[]
  /** contact_log rows of the note this plan was imported as, to remove once it is written. */
  noteIds: string[]
}

const nextPhaseOf = (p: PracticeHubPhase) => ({ visits_per_period: p.visitsPerPeriod, frequency_value: p.frequencyValue, frequency_unit: p.frequencyUnit, total_visits: p.totalVisits })

/** "2 a week · 6 visits", for the preview. */
export function practiceHubPhaseLabel(p: PracticeHubPhase, t: (en: string, es: string) => string): string {
  const every = p.frequencyValue === 1
    ? t(p.frequencyUnit === 'week' ? 'a week' : 'a month', p.frequencyUnit === 'week' ? 'por semana' : 'al mes')
    : t(`every ${p.frequencyValue} ${p.frequencyUnit}s`, `cada ${p.frequencyValue} ${p.frequencyUnit === 'week' ? 'semanas' : 'meses'}`)
  const length = p.totalVisits === null ? t('no end', 'sin fin') : t(`${p.totalVisits} visits`, `${p.totalVisits} visitas`)
  return `${p.visitsPerPeriod} ${every} · ${length}`
}

/**
 * created_at for each row written, per patient: the phase's start, made
 * strictly increasing so "the latest plan" -- read by created_at everywhere --
 * is the last phase, and never later than now, since a date ahead would make
 * a plan the clinic adds today look older than an imported one.
 */
export function practiceHubPlanCreatedAt(plans: readonly { patientId: string; rows: readonly { ref: string; startedAt: string }[] }[], now: Date): Map<string, string> {
  const at = new Map<string, string>()
  const byPatient = new Map<string, { ref: string; startedAt: string }[]>()
  for (const p of plans) {
    const list = byPatient.get(p.patientId) ?? []
    list.push(...p.rows)
    byPatient.set(p.patientId, list)
  }
  for (const list of byPatient.values()) {
    list.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.ref.localeCompare(b.ref, 'en', { numeric: true }))
    let prev = -Infinity
    for (const r of list) {
      const ms = Math.max(Math.min(Date.parse(`${r.startedAt}T00:00:00Z`), now.getTime()), prev + 1)
      prev = ms
      at.set(r.ref, new Date(ms).toISOString())
    }
  }
  return at
}

/** Care plans (Classic): each patient's plans, as care plans with their phases. */
export const planCarePlans: PracticeHubStepPlanner = async (ctx, snapshot): Promise<PracticeHubPlan> => {
  const { supabase, accountId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')
  const now = new Date()

  const phPatients = practiceHubList<{ id: number | string; patient_number: string }>(snapshot, '/patients')
  const phPlans = practiceHubList<PracticeHubCarePlanRow>(snapshot, '/care_plans')
  const phTypes = practiceHubList<{ id: number | string; name?: string | null }>(snapshot, '/appointment_types')
  const [ourPatientByRef, planRows, noteRows, typesHere, visits] = await Promise.all([
    patientsHereByRef(ctx),
    readAllForAccount<{ external_reference: string | null }>(supabase, accountId, 'care_plans', 'external_reference', (q) => q.like('external_reference', `${PREFIX}%`)),
    readAllForAccount<{ id: string; external_reference: string | null }>(supabase, accountId, 'contact_log', 'id, external_reference', (q) => q.like('external_reference', `${PREFIX}%`)),
    practiceHubTypesHere(supabase, accountId),
    // What the next-phase trigger counts: completed, not deleted.
    readAllForAccount<{ patient_id: string; starts_at: string }>(supabase, accountId, 'appointments', 'patient_id, starts_at', (q) => q.eq('status', 'completed').is('deleted_at', null)),
  ])

  const visitsOf = new Map<string, string[]>()
  for (const v of visits) {
    // starts_at is compared as text against "YYYY-MM-DDT00:00:00": one form, UTC.
    const at = new Date(v.starts_at).toISOString()
    const list = visitsOf.get(v.patient_id)
    if (list) list.push(at)
    else visitsOf.set(v.patient_id, [at])
  }
  const typeNamed = byExactName(typesHere, (ty) => ty.name)
  const phTypeName = new Map(phTypes.map((ty) => [String(ty.id), (ty.name ?? '').trim()]))
  const typeFor = (phTypeId: string) => {
    const name = phTypeName.get(phTypeId)
    return name ? { id: typeNamed(name)?.id, label: name } : {}
  }

  const plansHere = new Set(planRows.map((r) => practiceHubCarePlanIdOf(r.external_reference)).filter(Boolean) as string[])
  // The notes plans were imported as: "PH-careplan-<id>", one per phase row,
  // since every row of the plan wrote one under the same reference.
  const notesByPlan = new Map<string, string[]>()
  for (const n of noteRows) {
    const id = n.external_reference?.slice(PREFIX.length) ?? ''
    if (/^\d+$/.test(id)) notesByPlan.set(id, [...(notesByPlan.get(id) ?? []), n.id])
  }
  const patientNumberById = new Map(phPatients.map((p) => [String(p.id), p.patient_number]))
  const patientOf = (phPatientId: number | string): PracticeHubPatientHere | undefined => {
    const number = patientNumberById.get(String(phPatientId))
    return number ? ourPatientByRef.get(number) : undefined
  }

  const toWrite: PlanToWrite[] = []
  const toNote: { planId: string; patientId: string; patientLabel: string; source: PracticeHubCarePlanRow; reason: 'inactive' | 'unsupported' }[] = []
  // Notes of plans already written as care plans: a move cut off between its two writes.
  const leftovers: string[] = []
  let already = 0, unmatched = 0, keptAsNote = 0, moved = 0

  for (const outcome of practiceHubCarePlanOutcomes(phPlans, { typeFor })) {
    if (plansHere.has(outcome.planId)) {
      already++
      leftovers.push(...(notesByPlan.get(outcome.planId) ?? []))
      continue
    }
    const patient = patientOf(outcome.source.patient_id)
    if (!patient) { unmatched++; continue }
    const noteIds = notesByPlan.get(outcome.planId) ?? []
    if (outcome.kind === 'note') {
      if (noteIds.length) keptAsNote++
      else toNote.push({ planId: outcome.planId, patientId: patient.id, patientLabel: patient.label, source: outcome.source, reason: outcome.reason })
      continue
    }
    if (noteIds.length) moved++
    const { rows, queued } = practiceHubSplitPhases(outcome.phases, visitsOf.get(patient.id) ?? [])
    toWrite.push({ planId: outcome.planId, patientId: patient.id, patientLabel: patient.label, rows, queued, noteIds })
  }

  const createdAt = practiceHubPlanCreatedAt(toWrite, now)
  const phaseCount = toWrite.reduce((n, p) => n + p.rows.length + p.queued.length, 0)
  const asNote = toNote.length + keptAsNote
  const warnings: string[] = []
  if (unmatched) warnings.push(t(`${nf.format(unmatched)} care plans are skipped because their patient is not here yet. Run Patients first.`, `Se omiten ${nf.format(unmatched)} planes porque su paciente aún no está aquí. Ejecuta antes Pacientes.`))
  if (asNote) warnings.push(t(
    `${nf.format(asNote)} plans stay as a note in the patient's history: they are switched off in PracticeHub, or have a cadence a care plan here cannot hold (more than 7 visits a period, or a period in days).`,
    `${nf.format(asNote)} planes se quedan como nota en el historial del paciente: están desactivados en PracticeHub, o tienen una frecuencia que un plan de aquí no admite (más de 7 visitas por periodo, o un periodo en días).`,
  ))

  return {
    stats: [
      { label: t('As care plans', 'Como planes de cuidados'), value: nf.format(toWrite.length - moved), tone: 'good' },
      { label: t('Moved from the history to care plans', 'Movidos del historial a planes de cuidados'), value: nf.format(moved), tone: 'good' },
      { label: t('Phases in them', 'Fases en ellos'), value: nf.format(phaseCount) },
      { label: t('As a note (switched off or unsupported)', 'Como nota (desactivados o no admitidos)'), value: nf.format(toNote.length) },
      { label: t('Already imported', 'Ya importados'), value: nf.format(already) },
      { label: t('No matching patient', 'Sin paciente coincidente'), value: nf.format(unmatched) },
    ],
    columns: [
      { key: 'start', label: t('Starts', 'Empieza') },
      { key: 'patient', label: t('Patient', 'Paciente') },
      { key: 'plan', label: t('Becomes', 'Se convierte en'), wrap: true },
    ],
    rows: [
      ...toWrite.map((p) => ({
        start: p.rows[0]!.startedAt,
        patient: p.patientLabel,
        plan: [...p.rows, ...p.queued].map((ph) => practiceHubPhaseLabel(ph, t)).join(t(', then ', ', luego ')) + (p.noteIds.length ? t(' (moved from the history)', ' (movido del historial)') : ''),
      })),
      ...toNote.map((n) => ({
        start: String(n.source.start_date).slice(0, 10),
        patient: n.patientLabel,
        plan: t(`Note: ${practiceHubCarePlanSummary(n.source)}`, `Nota: ${practiceHubCarePlanSummary(n.source)}`),
      })),
    ],
    warnings,
    total: toWrite.length + toNote.length + (leftovers.length ? 1 : 0),
    async apply(progress, shouldStop) {
      const errors: string[] = []
      let written = 0
      let done = 0
      const name = t('Care plan', 'Plan de cuidados')
      for (let i = 0; i < toWrite.length; i += CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = toWrite.slice(i, i + CHUNK)
        const { error } = await supabase
          .from('care_plans')
          .insert(chunk.flatMap((p) => p.rows.map((r, k) => ({
            account_id: accountId,
            patient_id: p.patientId,
            name,
            visits_per_period: r.visitsPerPeriod,
            frequency_value: r.frequencyValue,
            frequency_unit: r.frequencyUnit,
            total_visits: r.totalVisits,
            started_at: r.startedAt,
            visit_markers: r.markers,
            // Only the last row of a plan carries what is still to come.
            next_phases: k === p.rows.length - 1 ? p.queued.map(nextPhaseOf) : [],
            external_reference: r.ref,
            created_at: createdAt.get(r.ref)!,
          }))))
          .select('id')
        if (error) {
          errors.push(t(`Care plans ${i + 1}-${i + chunk.length} were not saved: ${error.message}`, `No se guardaron los planes ${i + 1}-${i + chunk.length}: ${error.message}`))
        } else {
          written += chunk.length
          // Only once the plan exists does its note go.
          const notes = chunk.flatMap((p) => p.noteIds)
          if (notes.length) {
            const { error: dropError } = await supabase.from('contact_log').delete().eq('account_id', accountId).in('id', notes)
            if (dropError) errors.push(t(`The history notes of plans ${i + 1}-${i + chunk.length} were not removed (the next sync removes them): ${dropError.message}`, `No se quitaron del historial las notas de los planes ${i + 1}-${i + chunk.length} (la próxima sincronización las quita): ${dropError.message}`))
          }
        }
        done += chunk.length
        progress(done)
      }
      for (let i = 0; i < toNote.length; i += CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = toNote.slice(i, i + CHUNK)
        const { data, error } = await supabase
          .from('contact_log')
          .insert(chunk.map((n) => ({
            account_id: accountId,
            patient_id: n.patientId,
            action: 'other',
            note: `[care_plan] ${practiceHubCarePlanSummary(n.source)}`,
            external_reference: `${PREFIX}${n.planId}`,
            created_at: n.source.start_date,
          })))
          .select('id')
        if (error) errors.push(t(`Care plan notes ${i + 1}-${i + chunk.length} were not saved: ${error.message}`, `No se guardaron las notas de planes ${i + 1}-${i + chunk.length}: ${error.message}`))
        else written += data?.length ?? 0
        done += chunk.length
        progress(done)
      }
      if (leftovers.length && !shouldStop()) {
        for (let i = 0; i < leftovers.length; i += 500) {
          const { error } = await supabase.from('contact_log').delete().eq('account_id', accountId).in('id', leftovers.slice(i, i + 500))
          if (error) { errors.push(error.message); break }
        }
        progress(++done)
      }
      return { written, errors }
    },
  }
}
