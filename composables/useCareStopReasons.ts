import type { Tables } from '~/types/database.types'

// The clinic's reasons for stopping care (Settings > Recalls), in the order
// they are offered, and a name for a stop's reason_id -- which is null once
// its reason has been deleted from the list.
export type CareStopReason = Pick<Tables<'care_stop_reasons'>, 'id' | 'name'>
export type CareStop = Tables<'patient_care_stops'>

export function useCareStopReasons() {
  const supabase = useSupabaseClient()
  const t = useT()
  const reasons = ref<CareStopReason[]>([])
  const loaded = ref(false)

  async function load() {
    const { data } = await supabase.from('care_stop_reasons').select('id, name').order('sort_order').order('name')
    reasons.value = data ?? []
    loaded.value = true
  }

  const nameOf = (id: string | null) => reasons.value.find((r) => r.id === id)?.name ?? t('No reason', 'Sin motivo')

  /** The current stop of each patient asked about, by patient id (current_care_stops). */
  async function fetchCurrent(patientIds: string[]): Promise<Record<string, CareStop>> {
    if (!patientIds.length) return {}
    const { data } = await supabase.rpc('current_care_stops', { p_patient_ids: patientIds })
    return Object.fromEntries(((data as CareStop[] | null) ?? []).map((s) => [s.patient_id, s]))
  }

  return { reasons, loaded, load, nameOf, fetchCurrent }
}
