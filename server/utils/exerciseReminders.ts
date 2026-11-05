import type { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { exerciseReminderDue } from '~/utils/exerciseReminderDue'
import { sendPushToPatients } from './pushNotifications'

// The patient app's daily "¿Has hecho tus ejercicios hoy?", for patients who
// switched it on (patients.exercise_reminder_hour). Rides on the same-day
// cron, every 15 minutes, as the staff morning summary does -- a cron of its
// own would be one more pg_cron job to create by hand in production.
//
// Sent only while at least one active exercise is still undone today: a
// patient who has already ticked everything is not nagged. Marked sent for
// the clinic day either way once due, so a patient without the app (no
// device) is not re-tried every tick of the hour. Best-effort.
type Service = ReturnType<typeof serverSupabaseServiceRole<Database>>

export async function sendExerciseReminders(service: Service, now = new Date()): Promise<{ sent: number }> {
  let sent = 0
  try {
    const { data: patients } = await service
      .from('patients')
      .select('id, account_id, exercise_reminder_hour, exercise_reminded_on, clinics(timezone)')
      .not('exercise_reminder_hour', 'is', null)
      .not('user_id', 'is', null)
    for (const p of (patients as unknown as { id: string; account_id: string; exercise_reminder_hour: number | null; exercise_reminded_on: string | null; clinics: { timezone: string | null } | null }[] | null) ?? []) {
      const { due, day } = exerciseReminderDue(p, now, p.clinics?.timezone || DEFAULT_CLINIC_TIMEZONE)
      if (!due) continue
      const { data: active } = await service.from('patient_exercises').select('id, patient_exercise_logs(done_on)').eq('patient_id', p.id).is('ended_at', null)
      const rows = (active as unknown as { id: string; patient_exercise_logs: { done_on: string }[] }[] | null) ?? []
      const undone = rows.filter((r) => !r.patient_exercise_logs.some((l) => l.done_on === day)).length
      await service.from('patients').update({ exercise_reminded_on: day } as never).eq('id', p.id)
      if (undone === 0) continue
      const result = await sendPushToPatients(service, p.account_id, [p.id], {
        title: '¿Has hecho tus ejercicios hoy?',
        body: undone === 1 ? 'Te queda 1 ejercicio por marcar hoy.' : `Te quedan ${undone} ejercicios por marcar hoy.`,
        data: { type: 'exercises' },
      })
      if (result.delivered > 0) sent++
    }
  } catch (err) {
    console.error('[exercise-reminders] failed', err)
  }
  return { sent }
}

/**
 * "Nuevo ejercicio para casa": the patient's push when one is assigned, or
 * "Nuevos ejercicios para casa" naming them when a programme assigns several
 * at once. Callers pass one patient's assignments. Best-effort.
 */
export async function notifyExerciseAssigned(service: Service, patientExerciseIds: string | string[]) {
  const ids = Array.isArray(patientExerciseIds) ? patientExerciseIds : [patientExerciseIds]
  try {
    const { data } = await service
      .from('patient_exercises')
      .select('account_id, patient_id, sets, reps, frequency, progressive, created_at, exercises(name)')
      .in('id', ids)
      .order('created_at')
    const rows = (data as unknown as { account_id: string; patient_id: string; sets: number | null; reps: string | null; frequency: string | null; progressive: boolean; exercises: { name: string } | null }[] | null) ?? []
    const pe = rows[0]
    if (!pe) return
    let title = 'Nuevo ejercicio para casa'
    let body: string
    if (rows.length === 1) {
      const dose = [pe.progressive ? 'Progresivo' : pe.sets && pe.reps ? `${pe.sets} × ${pe.reps}` : pe.reps, pe.frequency].filter(Boolean).join(' · ')
      body = [pe.exercises?.name, dose].filter(Boolean).join(' · ')
    } else {
      title = 'Nuevos ejercicios para casa'
      const names = rows.map((r) => r.exercises?.name).filter(Boolean) as string[]
      body = `${rows.length} ejercicios: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`
    }
    await sendPushToPatients(service, pe.account_id, [pe.patient_id], { title, body, data: { type: 'exercises' } })
  } catch (err) {
    console.error('[exercise-assigned] push failed', ids, err)
  }
}

/**
 * Exercises by visit (the exercise_schedules migration): every patient
 * schedule with a step whose visit has now been reached gives it, and the
 * patient gets "Nuevos ejercicios para casa" for what it added. Rides on the
 * same-day cron like the reminder above, so a step arrives within 15
 * minutes of the visit being completed or checked in. Best-effort.
 */
export async function applyDueExerciseSchedules(service: Service): Promise<{ given: number }> {
  let given = 0
  try {
    const { data, error } = await service.rpc('apply_due_exercise_schedules')
    if (error) throw error
    for (const row of (data as { patient_schedule_id: string; added: string[] | null }[] | null) ?? []) {
      given++
      if (row.added?.length) await notifyExerciseAssigned(service, row.added)
    }
  } catch (err) {
    console.error('[exercise-schedules] failed', err)
  }
  return { given }
}
