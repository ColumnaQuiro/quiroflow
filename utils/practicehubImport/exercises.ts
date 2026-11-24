import { readAllForAccount } from '~/utils/practicehubImport/appointments'
import { patientsHereByRef, type PracticeHubPatientHere } from '~/utils/practicehubImport/clinical'
import { practiceHubList, type PracticeHubImportContext, type PracticeHubPlan, type PracticeHubSnapshot } from '~/utils/practicehubImport/types'
import { practiceHubUtc } from '~/utils/practicehubApiRows'

// Exercises: PracticeHub's exercise library, and the exercises each patient
// was given, into QuiroFlow's (exercises, patient_exercises).
//
// Classic's /exercises holds both in one list, as one clinic's 112 rows were
// on 24 Nov 2026:
//
//   template "1", patient_id 0   the library: 39 rows
//   template "0", patient_id N   one per exercise handed to a patient: 73
//                                rows, 39 patients
//
// A patient's row is a COPY of the library one, not a link: its exercise_id
// was 0 on every one of the 73. It carries the same name and video, and a
// description the practitioner can rewrite for that patient (none of the 73
// had been, but PracticeHub's screen offers it). So a patient's exercise is found in the
// library by its name, then its video when two library exercises share a
// name (one clinic had two "Thumb tracing"); one whose library exercise was
// since deleted becomes a library exercise of its own, once per name. A
// description that differs from the library's goes on the assignment as its
// notes, where the patient sees it under the exercise.
//
// A library exercise already here under the same name, written by hand or
// from the starter catalogue, is used rather than doubled, and given the
// PracticeHub reference so a later sync finds it again by that. Nothing here
// rewrites an exercise or an assignment already here: the clinic may have
// edited either since. Each row is recognised by "PH-exercise-<id>".
//
// Not brought: a patient row's file_url, a still of the video PracticeHub
// shows beside it (a PNG on S3 behind a link that expires within the hour).
// The video itself is the link, and YouTube and Vimeo links play inside the
// patient app.

export const PRACTICEHUB_EXERCISE_PREFIX = 'PH-exercise-'

export interface PracticeHubExercise {
  id: number | string
  exercise_id?: number | string | null
  patient_id: number | string | null
  name: string | null
  description: string | null
  video_url: string | null
  file_url?: string | null
  template: string | number | null
  active: string | number | null
  created: string | null
}

export interface ExerciseHere {
  id: string
  name: string
  external_reference: string | null
  archived_at: string | null
}

/** A library exercise this step creates. */
export interface NewExercise {
  ref: string
  name: string
  instructions: string | null
  mediaUrl: string | null
  archived: boolean
  createdAt: string | null
}

/** An exercise handed to a patient, onto the library exercise `exercise` names. */
export interface NewAssignment {
  ref: string
  patientId: string
  patientLabel: string
  name: string
  /** An exercise here by id, or one this step creates by its reference. */
  exercise: { id: string } | { ref: string }
  notes: string | null
  ended: boolean
  createdAt: string | null
}

export interface PracticeHubExercisePlan {
  create: NewExercise[]
  /** Exercises here by the same name, given the PracticeHub reference. */
  stamp: { id: string; ref: string; name: string }[]
  assign: NewAssignment[]
  libraryAlready: number
  assignedAlready: number
  unmatched: number
}

const flag = (v: string | number | null | undefined) => String(v ?? '').trim() === '1'
const isAssigned = (row: PracticeHubExercise) => !flag(row.template) && Number(row.patient_id ?? 0) > 0

/** PracticeHub's text as it should read here: Windows line ends gone, trimmed, empty is null. */
export function practiceHubExerciseText(value: string | null | undefined): string | null {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim()
  return text || null
}

const nameKey = (name: string | null | undefined) => String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
const videoKey = (url: string | null | undefined) => String(url ?? '').trim()

/**
 * What the Exercises step writes, from PracticeHub's /exercises and /patients
 * against what is here. Pure: the planner below reads, this decides.
 */
export function planPracticeHubExerciseRows(
  rows: PracticeHubExercise[],
  here: {
    phPatients: { id: number | string; patient_number: string }[]
    ourPatientByRef: Map<string, PracticeHubPatientHere>
    exercises: ExerciseHere[]
    assignedRefs: Set<string>
  },
): PracticeHubExercisePlan {
  const out: PracticeHubExercisePlan = { create: [], stamp: [], assign: [], libraryAlready: 0, assignedAlready: 0, unmatched: 0 }
  const byRef = new Map(here.exercises.filter((e) => e.external_reference).map((e) => [e.external_reference!, e]))
  // Only an exercise no import has claimed is taken over by name: one with a
  // PracticeHub reference is that other PracticeHub exercise, even when the
  // names match.
  const unclaimedByName = new Map<string, ExerciseHere>()
  for (const e of here.exercises) {
    if (!e.external_reference && !unclaimedByName.has(nameKey(e.name))) unclaimedByName.set(nameKey(e.name), e)
  }

  /** Where a PracticeHub row's library exercise is: here already, or created by this step. Null for a nameless row. */
  const targetOf = new Map<string, { id: string } | { ref: string }>()
  function libraryExercise(row: PracticeHubExercise): { id: string } | { ref: string } | null {
    const ref = `${PRACTICEHUB_EXERCISE_PREFIX}${row.id}`
    const known = targetOf.get(ref)
    if (known) return known
    const name = practiceHubExerciseText(row.name)
    if (!name) return null
    let target: { id: string } | { ref: string }
    const mine = byRef.get(ref)
    const same = unclaimedByName.get(nameKey(name))
    if (mine) {
      target = { id: mine.id }
      out.libraryAlready++
    } else if (same) {
      target = { id: same.id }
      unclaimedByName.delete(nameKey(name))
      out.stamp.push({ id: same.id, ref, name })
    } else {
      target = { ref }
      out.create.push({
        ref,
        name,
        instructions: practiceHubExerciseText(row.description),
        mediaUrl: videoKey(row.video_url) || null,
        archived: !flag(row.active),
        createdAt: practiceHubUtc(row.created) || null,
      })
    }
    targetOf.set(ref, target)
    return target
  }

  const library = rows.filter((r) => !isAssigned(r))
  for (const row of library) libraryExercise(row)

  const libraryByName = new Map<string, PracticeHubExercise[]>()
  for (const row of library) {
    const key = nameKey(row.name)
    libraryByName.set(key, [...(libraryByName.get(key) ?? []), row])
  }
  const libraryRowOf = (row: PracticeHubExercise) => {
    const named = libraryByName.get(nameKey(row.name)) ?? []
    return named.length > 1
      ? named.find((l) => videoKey(l.video_url) === videoKey(row.video_url)) ?? named[0]!
      : named[0] ?? library.find((l) => videoKey(l.video_url) && videoKey(l.video_url) === videoKey(row.video_url))
  }
  // A patient's exercise whose library one is gone: one library exercise per
  // name and video, made from the patient row with the lowest id -- worked
  // out over every patient row, given or not, so a later sync picks the same
  // row and finds the exercise it made rather than making another.
  const assignedRows = rows.filter(isAssigned).sort((a, b) => Number(a.id) - Number(b.id))
  const orphanKey = (row: PracticeHubExercise) => `${nameKey(row.name)}\n${videoKey(row.video_url)}`
  const orphanSource = new Map<string, PracticeHubExercise>()
  for (const row of assignedRows) if (!libraryRowOf(row) && !orphanSource.has(orphanKey(row))) orphanSource.set(orphanKey(row), row)

  const patientNumberById = new Map(here.phPatients.map((p) => [String(p.id), p.patient_number]))
  for (const row of assignedRows) {
    const ref = `${PRACTICEHUB_EXERCISE_PREFIX}${row.id}`
    if (here.assignedRefs.has(ref)) {
      out.assignedAlready++
      continue
    }
    const patientNumber = patientNumberById.get(String(row.patient_id))
    const patient = patientNumber ? here.ourPatientByRef.get(patientNumber) : undefined
    if (!patient) {
      out.unmatched++
      continue
    }
    const source = libraryRowOf(row)
    const exercise = libraryExercise(source ?? orphanSource.get(orphanKey(row))!)
    if (!exercise) continue

    const text = practiceHubExerciseText(row.description)
    const libraryText = source ? practiceHubExerciseText(source.description) : text
    out.assign.push({
      ref,
      patientId: patient.id,
      patientLabel: patient.label,
      name: practiceHubExerciseText(row.name) ?? '',
      exercise,
      notes: text && text !== libraryText ? text : null,
      ended: !flag(row.active),
      createdAt: practiceHubUtc(row.created) || null,
    })
  }
  return out
}

const CHUNK = 200

/** Exercises: PracticeHub's library and each patient's exercises (see above). */
export async function planExercises(ctx: PracticeHubImportContext, snapshot: PracticeHubSnapshot): Promise<PracticeHubPlan> {
  const { supabase, accountId, t } = ctx
  const nf = new Intl.NumberFormat('es-ES')

  const phRows = practiceHubList<PracticeHubExercise>(snapshot, '/exercises')
  const phPatients = practiceHubList<{ id: number | string; patient_number: string }>(snapshot, '/patients')
  const [ourPatientByRef, exercises, assigned] = await Promise.all([
    patientsHereByRef(ctx),
    readAllForAccount<ExerciseHere>(supabase, accountId, 'exercises', 'id, name, external_reference, archived_at'),
    readAllForAccount<{ external_reference: string | null }>(supabase, accountId, 'patient_exercises', 'external_reference',
      (q) => q.like('external_reference', `${PRACTICEHUB_EXERCISE_PREFIX}%`)),
  ])
  const plan = planPracticeHubExerciseRows(phRows, {
    phPatients,
    ourPatientByRef,
    exercises,
    assignedRefs: new Set(assigned.map((a) => a.external_reference).filter(Boolean) as string[]),
  })

  const library = t('Library', 'Biblioteca')
  const total = plan.create.length + plan.stamp.length + plan.assign.length
  return {
    stats: [
      { label: t('New in the library', 'Nuevos en la biblioteca'), value: nf.format(plan.create.length), tone: 'good' },
      { label: t('Already in the library', 'Ya en la biblioteca'), value: nf.format(plan.libraryAlready + plan.stamp.length) },
      { label: t('To give to patients', 'Para asignar a pacientes'), value: nf.format(plan.assign.length), tone: 'good' },
      { label: t('Already given', 'Ya asignados'), value: nf.format(plan.assignedAlready) },
      { label: t('No matching patient', 'Sin paciente coincidente'), value: nf.format(plan.unmatched) },
    ],
    columns: [
      { key: 'where', label: t('Where', 'Dónde') },
      { key: 'name', label: t('Exercise', 'Ejercicio') },
      { key: 'notes', label: t('Notes', 'Notas'), wrap: true },
    ],
    rows: [
      ...plan.create.map((e) => ({ where: library, name: e.name, notes: e.instructions ?? '' })),
      ...plan.assign.map((a) => ({ where: a.patientLabel, name: a.name, notes: a.notes ?? '' })),
    ],
    warnings: plan.unmatched
      ? [t(`${nf.format(plan.unmatched)} exercises given to patients were skipped: their patient is not here yet. Run Patients, then this step again.`, `Se han saltado ${nf.format(plan.unmatched)} ejercicios asignados: su paciente aún no está aquí. Importa los pacientes y vuelve a ejecutar este paso.`)]
      : [],
    total,
    async apply(progress, shouldStop) {
      const errors: string[] = []
      let written = 0
      let done = 0
      const idOfRef = new Map<string, string>()

      // The library first: every assignment needs its exercise's id.
      for (let i = 0; i < plan.create.length; i += CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = plan.create.slice(i, i + CHUNK)
        const now = new Date().toISOString()
        const { data, error } = await supabase
          .from('exercises')
          .insert(chunk.map((e) => ({
            account_id: accountId,
            name: e.name,
            instructions: e.instructions,
            media_url: e.mediaUrl,
            external_reference: e.ref,
            archived_at: e.archived ? now : null,
            ...(e.createdAt ? { created_at: e.createdAt } : {}),
          })))
          .select('id, external_reference')
        if (error) errors.push(t(`Library exercises ${i + 1}-${i + chunk.length} were not saved: ${error.message}`, `Los ejercicios de biblioteca ${i + 1}-${i + chunk.length} no se guardaron: ${error.message}`))
        for (const row of data ?? []) if (row.external_reference) idOfRef.set(row.external_reference, row.id)
        written += data?.length ?? 0
        progress((done += chunk.length))
      }
      for (const s of plan.stamp) {
        if (shouldStop()) return { written, errors }
        const { error } = await supabase.from('exercises').update({ external_reference: s.ref }).eq('id', s.id).eq('account_id', accountId).is('external_reference', null)
        if (error) errors.push(t(`"${s.name}" could not be linked to PracticeHub: ${error.message}`, `«${s.name}» no se pudo enlazar con PracticeHub: ${error.message}`))
        progress((done += 1))
      }

      for (let i = 0; i < plan.assign.length; i += CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = plan.assign.slice(i, i + CHUNK)
        const now = new Date().toISOString()
        const rows = chunk.flatMap((a) => {
          const exerciseId = 'id' in a.exercise ? a.exercise.id : idOfRef.get(a.exercise.ref)
          // Its library exercise failed to save above, and that is already reported.
          if (!exerciseId) return []
          return [{
            account_id: accountId,
            patient_id: a.patientId,
            exercise_id: exerciseId,
            notes: a.notes,
            external_reference: a.ref,
            ended_at: a.ended ? now : null,
            ...(a.createdAt ? { created_at: a.createdAt } : {}),
          }]
        })
        if (rows.length) {
          const { data, error } = await supabase.from('patient_exercises').insert(rows).select('id')
          if (error) errors.push(t(`Patients' exercises ${i + 1}-${i + chunk.length} were not saved: ${error.message}`, `Los ejercicios de pacientes ${i + 1}-${i + chunk.length} no se guardaron: ${error.message}`))
          else written += data?.length ?? 0
        }
        progress((done += chunk.length))
      }
      return { written, errors }
    },
  }
}
