// Home exercises from the patient's side (app and portal): the ones their
// clinic gave them and still has on, with the last week of ticks, and "Hecho
// hoy" -- set_my_exercise_done, the only write a patient makes here.
import { deviceDay } from '../utils/exerciseWeek'
import type { AssignedExercise } from './useStaffExercises'

export function usePatientExercises(patientId: () => string) {
  const supabase = useSupabaseClient()
  const t = useT()
  const items = ref<AssignedExercise[]>([])
  const loading = ref(true)
  const loadError = ref(false)
  const busyId = ref<string | null>(null)
  const error = ref('')

  async function load() {
    const id = patientId()
    if (!id) return
    loading.value = true
    const weekAgo = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10)
    const { data, error: readError } = await supabase
      .from('patient_exercises')
      .select('id, sets, reps, frequency, notes, created_at, exercises(id, name, instructions, media_url), patient_exercise_logs(done_on)')
      .eq('patient_id', id)
      .is('ended_at', null)
      .gte('patient_exercise_logs.done_on', weekAgo)
      .order('created_at')
    loading.value = false
    loadError.value = !!readError
    if (readError) return
    items.value = (data as unknown as AssignedExercise[] | null) ?? []
  }

  function doneToday(pe: AssignedExercise) {
    const today = deviceDay(new Date())
    return pe.patient_exercise_logs.some((l) => l.done_on === today)
  }

  async function toggleToday(pe: AssignedExercise) {
    const today = deviceDay(new Date())
    const done = !doneToday(pe)
    busyId.value = pe.id
    error.value = ''
    const { data, error: e } = await supabase.rpc('set_my_exercise_done' as never, { p_patient_exercise_id: pe.id, p_done_on: today, p_done: done } as never)
    busyId.value = null
    if (e || data !== true) {
      error.value = t("Couldn't save it. Try again.", 'No se ha podido guardar. Inténtalo de nuevo.')
      return
    }
    pe.patient_exercise_logs = done ? [...pe.patient_exercise_logs, { done_on: today }] : pe.patient_exercise_logs.filter((l) => l.done_on !== today)
  }

  watch(patientId, (id) => id && load(), { immediate: true })
  return { items, loading, loadError, busyId, error, load, doneToday, toggleToday }
}
