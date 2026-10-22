import { patientPlanProgress } from '../utils/patientPlanProgress'

// The care plan in one line for the patient's home -- "9 de 12" and a bar --
// from the same rows and the same counting as the plan's own card
// (components/patient/CarePlanCard.vue), which stays on the Plan tab.
export function usePatientPlanSummary(patientId: () => string) {
  const supabase = useSupabaseClient()
  const plan = ref<{ total_visits: number; started_at: string } | null>(null)
  const progress = ref<ReturnType<typeof patientPlanProgress> | null>(null)
  const loading = ref(true)

  async function load() {
    const id = patientId()
    if (!id) return
    loading.value = true
    const { data: plans } = await supabase
      .from('care_plans')
      .select('total_visits, started_at')
      .eq('patient_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
    plan.value = (plans as { total_visits: number; started_at: string }[] | null)?.[0] ?? null
    if (plan.value) {
      const { data } = await supabase
        .from('appointments')
        .select('id, starts_at, status')
        .eq('patient_id', id)
        .is('deleted_at', null)
        .gte('starts_at', plan.value.started_at)
      progress.value = patientPlanProgress(plan.value, (data as { id: string; starts_at: string; status: string }[] | null) ?? [], new Date())
    } else {
      progress.value = null
    }
    loading.value = false
  }
  watch(patientId, load, { immediate: true })
  return { plan, progress, loading, refresh: load }
}
