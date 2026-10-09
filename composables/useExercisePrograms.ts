// Exercise programmes: a named set of library exercises with their usual
// dose, assigned to a patient in one go. Edited in Settings > Exercise
// Library (ExercisesPrograms) and picked on a patient's record
// (ExercisesStaff). Saving goes through save_exercise_program so the name and
// the whole list change together; see the exercise_programs migration.
export interface ProgramItem {
  exercise_id: string
  sets: number | null
  reps: string | null
  frequency: string | null
  notes: string | null
  position?: number
  exercises?: { name: string; archived_at: string | null } | null
}

export interface ExerciseProgram {
  id: string
  name: string
  description: string | null
  exercise_program_items: ProgramItem[]
}

export function useExercisePrograms(opts: { accountId: () => string | null | undefined }) {
  const supabase = useSupabaseClient()
  const programs = ref<ExerciseProgram[]>([])
  const loading = ref(true)

  async function load() {
    const { data } = await supabase
      .from('exercise_programs')
      .select('id, name, description, exercise_program_items(exercise_id, sets, reps, frequency, notes, position, exercises(name, archived_at))')
      .order('name')
      .order('position', { referencedTable: 'exercise_program_items' })
    programs.value = (data as unknown as ExerciseProgram[] | null) ?? []
    loading.value = false
  }

  /** Creates (id null) or replaces a programme. Returns its id, or an error message. */
  async function save(p: { id: string | null; name: string; description: string | null; items: ProgramItem[] }): Promise<{ id: string } | { error: string }> {
    const accountId = opts.accountId()
    if (!accountId) return { error: 'No account' }
    const { data, error } = await supabase.rpc('save_exercise_program', {
      p_account_id: accountId,
      p_program_id: p.id,
      p_name: p.name,
      p_description: p.description,
      p_items: p.items.map((i) => ({ exercise_id: i.exercise_id, sets: i.sets, reps: i.reps, frequency: i.frequency, notes: i.notes })),
    } as never)
    if (error || !data) return { error: error?.message ?? 'Not saved' }
    await load()
    return { id: data as unknown as string }
  }

  async function remove(id: string): Promise<boolean> {
    const { error } = await supabase.from('exercise_programs').delete().eq('id', id)
    if (error) return false
    programs.value = programs.value.filter((p) => p.id !== id)
    return true
  }

  return { programs, loading, load, save, remove }
}
