// Home exercises from the clinic's side (web patient record and the staff
// app): what this patient has been given, how this week has gone, and
// assigning another -- from the clinic's library or new. Plain table reads
// and writes under RLS (staff manage patient_exercises within their patient
// scope; see the home_exercises migration).
export interface ExerciseRow {
  id: string
  name: string
  instructions: string | null
  media_url: string | null
}

export interface AssignedExercise {
  id: string
  sets: number | null
  reps: string | null
  frequency: string | null
  notes: string | null
  created_at: string
  exercises: ExerciseRow | null
  patient_exercise_logs: { done_on: string }[]
}

export interface NewAssignment {
  exerciseId: string | null
  /** When exerciseId is null: a new exercise, saved to the library too. */
  newExercise?: { name: string; instructions: string | null; media_url: string | null }
  sets: number | null
  reps: string | null
  frequency: string | null
  notes: string | null
}

export function useStaffExercises(opts: { accountId: () => string | null | undefined; patientId: () => string; teamMemberId: () => string | null | undefined }) {
  const supabase = useSupabaseClient()
  const authedFetch = useAuthedFetch()
  const t = useT()
  const assigned = ref<AssignedExercise[]>([])
  const library = ref<ExerciseRow[]>([])
  const loading = ref(true)
  const loadError = ref(false)
  const saving = ref(false)
  const error = ref('')

  async function load() {
    loading.value = true
    const weekAgo = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10)
    const [{ data, error: readError }, { data: lib }] = await Promise.all([
      supabase
        .from('patient_exercises')
        .select('id, sets, reps, frequency, notes, created_at, exercises(id, name, instructions, media_url), patient_exercise_logs(done_on)')
        .eq('patient_id', opts.patientId())
        .is('ended_at', null)
        .gte('patient_exercise_logs.done_on', weekAgo)
        .order('created_at'),
      supabase.from('exercises').select('id, name, instructions, media_url').is('archived_at', null).order('name'),
    ])
    loading.value = false
    loadError.value = !!readError
    if (readError) return
    assigned.value = (data as unknown as AssignedExercise[] | null) ?? []
    library.value = (lib as ExerciseRow[] | null) ?? []
  }

  async function assign(a: NewAssignment): Promise<boolean> {
    const accountId = opts.accountId()
    if (!accountId) return false
    saving.value = true
    error.value = ''
    try {
      let exerciseId = a.exerciseId
      if (!exerciseId && a.newExercise) {
        const { data, error: e } = await supabase
          .from('exercises')
          .insert({ account_id: accountId, name: a.newExercise.name.trim(), instructions: a.newExercise.instructions, media_url: a.newExercise.media_url, created_by: opts.teamMemberId() ?? null } as never)
          .select('id')
          .single()
        if (e || !data) throw e ?? new Error('no exercise')
        exerciseId = (data as { id: string }).id
      }
      if (!exerciseId) return false
      const { data: created, error: e } = await supabase.from('patient_exercises').insert({
        account_id: accountId,
        patient_id: opts.patientId(),
        exercise_id: exerciseId,
        sets: a.sets,
        reps: a.reps,
        frequency: a.frequency,
        notes: a.notes,
        assigned_by: opts.teamMemberId() ?? null,
      } as never).select('id').single()
      if (e) throw e
      // The patient's push ("Nuevo ejercicio para casa"); never holds this up.
      const createdId = (created as { id: string } | null)?.id
      if (createdId) authedFetch('/api/exercises/notify-assigned', { method: 'POST', body: { patientExerciseId: createdId } }).catch(() => {})
      await load()
      return true
    } catch {
      error.value = t("Couldn't assign it. Try again.", 'No se ha podido asignar. Inténtalo de nuevo.')
      return false
    } finally {
      saving.value = false
    }
  }

  /** Stops an exercise: kept, with its history, but no longer shown to the patient. */
  async function end(id: string) {
    const { error: e } = await supabase.from('patient_exercises').update({ ended_at: new Date().toISOString() } as never).eq('id', id).select('id')
    if (e) {
      error.value = t("Couldn't remove it. Try again.", 'No se ha podido quitar. Inténtalo de nuevo.')
      return
    }
    assigned.value = assigned.value.filter((x) => x.id !== id)
  }

  watch(opts.patientId, (id) => id && load(), { immediate: true })
  return { assigned, library, loading, loadError, saving, error, load, assign, end }
}
