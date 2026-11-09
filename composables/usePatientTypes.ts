// Patient types (Joven, Mayor de 65, Deportista...): categories a clinic
// defines once in Settings > Patient types and gives to patients, each of
// which can bring a programme and a schedule by visit with it. See
// 20261109181443_exercises_section_and_patient_types.sql.
//
// Reads are plain table reads under RLS. Giving and taking types goes through
// /api/patient-types/assign, because the server also sends the patients'
// push for the exercises a type brought and starts the automations that
// begin on a type.
export interface PatientType {
  id: string
  name: string
  color: PatientTypeColor
  exercise_program_id: string | null
  exercise_schedule_id: string | null
  archived_at: string | null
  /** How many patients have it (patient_type_members, under the viewer's scope). */
  members: number
}

export const PATIENT_TYPE_COLORS = ['indigo', 'green', 'amber', 'rose', 'violet', 'sky', 'orange', 'slate'] as const
export type PatientTypeColor = (typeof PATIENT_TYPE_COLORS)[number]

/** The dot beside a type's name. Mid-tone, so it reads on light and dark. */
export const PATIENT_TYPE_DOT: Record<PatientTypeColor, string> = {
  indigo: '#6366F1',
  green: '#22A06B',
  amber: '#D9A21B',
  rose: '#E2557A',
  violet: '#9B5DE5',
  sky: '#2B9FD9',
  orange: '#E8772E',
  slate: '#7A8094',
}

/** Who a bulk change is for: the patients picked, or all that match the list's filters. */
export type PatientSelection = { patientIds: string[] } | { filters: Record<string, unknown>; clinicId: string | null }

export function usePatientTypes() {
  const supabase = useSupabaseClient()
  const staffFetch = useStaffFetch
  const store = useAccountStore()
  const types = ref<PatientType[]>([])
  const loading = ref(true)
  const loadError = ref(false)

  const active = computed(() => types.value.filter((x) => !x.archived_at))
  const byId = computed(() => new Map(types.value.map((x) => [x.id, x])))

  async function load() {
    const { data, error } = await supabase
      .from('patient_types')
      .select('id, name, color, exercise_program_id, exercise_schedule_id, archived_at, patient_type_members(count)')
      .order('name')
    loading.value = false
    loadError.value = !!error
    if (error) return
    types.value = ((data ?? []) as unknown as (Omit<PatientType, 'members'> & { patient_type_members: { count: number }[] })[]).map(({ patient_type_members, ...x }) => ({
      ...x,
      members: patient_type_members?.[0]?.count ?? 0,
    }))
  }

  async function create(name: string, color: PatientTypeColor): Promise<{ id: string } | { error: string }> {
    if (!store.accountId) return { error: 'No account' }
    const { data, error } = await supabase
      .from('patient_types')
      .insert({ account_id: store.accountId, name: name.trim(), color, created_by: store.teamMember?.id ?? null })
      .select('id')
      .single()
    if (error || !data) return { error: error?.message ?? 'Not saved' }
    await load()
    return { id: data.id }
  }

  async function update(id: string, patch: Partial<Pick<PatientType, 'name' | 'color' | 'archived_at' | 'exercise_program_id' | 'exercise_schedule_id'>>): Promise<string | null> {
    const { error } = await supabase.from('patient_types').update(patch).eq('id', id).select('id').single()
    if (error) return error.message
    await load()
    return null
  }

  async function remove(id: string): Promise<string | null> {
    const { error } = await supabase.from('patient_types').delete().eq('id', id)
    if (error) return error.message
    types.value = types.value.filter((x) => x.id !== id)
    return null
  }

  /** Gives and takes away types. Returns what changed, or throws the server's message. */
  async function assign(who: PatientSelection, change: { add?: string[]; remove?: string[]; endTypeExercises?: boolean }) {
    const res = await staffFetch<{ patients: number; added: number; removed: number; exercises: number }>('/api/patient-types/assign', {
      method: 'POST',
      body: { ...who, ...change },
    })
    return res
  }

  /** Brings everyone with the type in line with what it brings now. */
  async function sync(typeId: string) {
    return staffFetch<{ patients: number; exercises: number; ended: number }>('/api/patient-types/sync', { method: 'POST', body: { typeId } })
  }

  async function convertTag(tag: string): Promise<{ id: string } | { error: string }> {
    if (!store.accountId) return { error: 'No account' }
    const { data, error } = await supabase.rpc('convert_tag_to_patient_type', { p_account_id: store.accountId, p_tag: tag })
    if (error || !data) return { error: error?.message ?? 'Not converted' }
    await load()
    return { id: data as string }
  }

  return { types, active, byId, loading, loadError, load, create, update, remove, assign, sync, convertTag }
}
