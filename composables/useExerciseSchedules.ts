import type { Json } from '../types/database.types'
import { readSteps, type ScheduleStep } from '../utils/exerciseSchedule'

// Exercises by visit (the exercise_schedules migration). Templates are the
// clinic's, edited in Settings > Exercise Library (ExercisesSchedules) and
// picked on a patient's record (ExercisesPatientSchedule), where they are
// copied into the patient's own schedule and adjusted. Templates are one row
// each, steps and all, so a plain insert or update saves one whole; a
// patient's goes through save_patient_exercise_schedule, which also gives
// whatever is already due.
export interface ExerciseScheduleTemplate {
  id: string
  name: string
  description: string | null
  steps: ScheduleStep[]
}

export interface PatientExerciseSchedule {
  id: string
  schedule_id: string | null
  name: string
  counts_from: string
  steps: ScheduleStep[]
  next_from_visit: number | null
}

export function useExerciseSchedules(opts: { accountId: () => string | null | undefined; teamMemberId?: () => string | null | undefined }) {
  const supabase = useSupabaseClient()
  const templates = ref<ExerciseScheduleTemplate[]>([])
  const loading = ref(true)

  async function load() {
    const { data } = await supabase.from('exercise_schedules').select('id, name, description, steps').order('name')
    templates.value = ((data as { id: string; name: string; description: string | null; steps: unknown }[] | null) ?? []).map((r) => ({ ...r, steps: readSteps(r.steps) }))
    loading.value = false
  }

  /** Creates (id null) or replaces a template. Returns its id, or an error message. */
  async function save(s: { id: string | null; name: string; description: string | null; steps: ScheduleStep[] }): Promise<{ id: string } | { error: string }> {
    const accountId = opts.accountId()
    if (!accountId) return { error: 'No account' }
    // Applied state belongs to a patient's copy, never a template.
    const steps = s.steps.map(({ applied_at: _applied, ...rest }) => rest) as unknown as Json
    const values = { name: s.name.trim(), description: s.description?.trim() || null, steps }
    const { data, error } = s.id
      ? await supabase.from('exercise_schedules').update(values).eq('id', s.id).select('id').single()
      : await supabase.from('exercise_schedules').insert({ ...values, account_id: accountId, created_by: opts.teamMemberId?.() ?? null }).select('id').single()
    if (error || !data) return { error: error?.message ?? 'Not saved' }
    await load()
    return { id: (data as { id: string }).id }
  }

  async function remove(id: string): Promise<boolean> {
    const { error } = await supabase.from('exercise_schedules').delete().eq('id', id)
    if (error) return false
    templates.value = templates.value.filter((s) => s.id !== id)
    return true
  }

  return { templates, loading, load, save, remove }
}

/** One patient's schedule: the active one, the visits it has counted, and saving or ending it. */
export function usePatientExerciseSchedule(opts: { accountId: () => string | null | undefined; patientId: () => string }) {
  const supabase = useSupabaseClient()
  const schedule = ref<PatientExerciseSchedule | null>(null)
  const attended = ref<number | null>(null)
  const loading = ref(true)

  async function load() {
    const { data } = await supabase
      .from('patient_exercise_schedules')
      .select('id, schedule_id, name, counts_from, steps, next_from_visit')
      .eq('patient_id', opts.patientId())
      .is('ended_at', null)
      .maybeSingle()
    const row = data as (Omit<PatientExerciseSchedule, 'steps'> & { steps: unknown }) | null
    schedule.value = row ? { ...row, steps: readSteps(row.steps) } : null
    attended.value = null
    if (row) {
      const { data: n } = await supabase.rpc('patient_exercise_schedule_visits', { p_id: row.id })
      attended.value = typeof n === 'number' ? n : null
    }
    loading.value = false
  }

  /**
   * Saves the patient's schedule -- a new one (id null) replaces whatever
   * they had -- and gives the steps already due. Returns the ids of the
   * exercises that gave, or an error message.
   */
  async function save(s: { id: string | null; scheduleId: string | null; name: string; countsFrom: string; steps: ScheduleStep[] }): Promise<{ added: string[] } | { error: string }> {
    const accountId = opts.accountId()
    if (!accountId) return { error: 'No account' }
    const { data, error } = await supabase.rpc('save_patient_exercise_schedule', {
      p_account_id: accountId,
      p_patient_id: opts.patientId(),
      p_id: s.id,
      p_schedule_id: s.scheduleId,
      p_name: s.name,
      p_counts_from: s.countsFrom,
      p_steps: s.steps as unknown as Json,
    })
    if (error || !data) return { error: error?.message ?? 'Not saved' }
    await load()
    const added = (data as { added?: string[] | null }).added
    return { added: Array.isArray(added) ? added : [] }
  }

  /** Stops the schedule. What it already gave stays with the patient. */
  async function end(): Promise<boolean> {
    if (!schedule.value) return true
    const { error } = await supabase.from('patient_exercise_schedules').update({ ended_at: new Date().toISOString() }).eq('id', schedule.value.id)
    if (error) return false
    schedule.value = null
    attended.value = null
    return true
  }

  watch(opts.patientId, (id) => id && load(), { immediate: true })
  return { schedule, attended, loading, load, save, end }
}
