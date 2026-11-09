import type { Json } from '~/types/database.types'
import type { PatientFilters } from '~/utils/patientFilters'

// Lists of patients (patient_lists, 20261105143740_patient_lists_and_audiences.sql):
// people put there by hand, from a selection on the patient list, or by an
// import. The same sharing as segments -- the team's, or private to whoever
// made it; RLS decides which.
//
// Counts come from one RPC for every list, evaluated by patients_matching
// with {list, clinic: 'all'} -- what opening a list shows -- so the number
// beside a list is the number of rows. With it, how many of them accept
// marketing by email and by WhatsApp, because a list exists to be written to
// and being on one is not consent.

export interface PatientList {
  id: string
  name: string
  description: string | null
  shared: boolean
  created_by: string | null
  updated_at: string
}

export interface PatientListCount {
  patients: number
  email: number
  whatsapp: number
}

export type ListMemberSource = 'manual' | 'bulk' | 'import'

/** The filters that open a list: its members, in every clinic. */
export function listFilters(listId: string): PatientFilters {
  return { list: listId, clinic: 'all' }
}

const COLUMNS = 'id, name, description, shared, created_by, updated_at'

export function usePatientLists() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const { can } = usePermission()

  const lists = ref<PatientList[]>([])
  const counts = ref<Record<string, PatientListCount>>({})
  const loaded = ref(false)
  // The read failed: a page can say so rather than wait on `loaded` forever.
  const failed = ref(false)
  const counting = ref(false)
  let countToken = 0

  async function load() {
    if (!store.accountId) return
    const { data, error } = await supabase.from('patient_lists').select(COLUMNS).eq('account_id', store.accountId).order('name')
    failed.value = !!error
    if (error) throw error
    lists.value = data ?? []
    loaded.value = true
  }

  async function refreshCounts() {
    const token = ++countToken
    counting.value = true
    const { data, error } = await supabase.rpc('patient_list_counts')
    if (error) throw error
    if (token !== countToken) return
    const next: Record<string, PatientListCount> = {}
    for (const row of data ?? []) next[row.list_id] = { patients: Number(row.patient_count), email: Number(row.email_count), whatsapp: Number(row.whatsapp_count) }
    counts.value = next
    counting.value = false
  }

  async function refresh() {
    await Promise.all([load(), refreshCounts()])
  }

  /** The author, or anyone who can edit patients when it is shared -- the RLS rule. */
  function canManage(list: PatientList) {
    return list.created_by === store.teamMember?.id || (list.shared && can('patients_edit'))
  }

  async function create(name: string, shared: boolean, description: string | null = null): Promise<PatientList> {
    const { data, error } = await supabase
      .from('patient_lists')
      // created_by is stamped by the database; sent so the insert policy's
      // check reads the same value either way, as for segments.
      .insert({ account_id: store.accountId!, name: name.trim(), shared, description, created_by: store.teamMember?.id ?? null })
      .select(COLUMNS)
      .single()
    if (error) throw error
    await refresh()
    return data
  }

  async function update(id: string, patch: { name?: string; shared?: boolean; description?: string | null }) {
    const row: { name?: string; shared?: boolean; description?: string | null } = { ...patch }
    if (row.name !== undefined) row.name = row.name.trim()
    // .select() so an update RLS refused -- zero rows, no error -- is reported.
    const { data, error } = await supabase.from('patient_lists').update(row).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) throw new Error('list not updated')
    await refresh()
  }

  async function remove(id: string) {
    const { data, error } = await supabase.from('patient_lists').delete().eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) throw new Error('list not deleted')
    await refresh()
  }

  /** Adds these patients, leaving anyone already on it as they were. Returns how many were new. */
  async function addPatients(listId: string, patientIds: string[], source: ListMemberSource = 'manual', sourceDetail: string | null = null): Promise<number> {
    let added = 0
    for (let i = 0; i < patientIds.length; i += 500) {
      const chunk = patientIds.slice(i, i + 500)
      const { data, error } = await supabase
        .from('patient_list_members')
        .upsert(
          chunk.map((patient_id) => ({ account_id: store.accountId!, list_id: listId, patient_id, source, source_detail: sourceDetail })),
          { onConflict: 'list_id,patient_id', ignoreDuplicates: true },
        )
        .select('id')
      if (error) throw error
      added += data?.length ?? 0
    }
    return added
  }

  /** Everyone the patient list's filters match, added in the database. */
  async function addMatching(listId: string, filters: PatientFilters, clinicId: string | null): Promise<number> {
    const { data, error } = await supabase.rpc('add_matching_to_patient_list', { p_list_id: listId, p_filters: filters as Json, p_clinic_id: clinicId ?? undefined })
    if (error) throw error
    return data ?? 0
  }

  async function removePatients(listId: string, patientIds: string[]): Promise<number> {
    let removed = 0
    for (let i = 0; i < patientIds.length; i += 200) {
      const chunk = patientIds.slice(i, i + 200)
      const { data, error } = await supabase.from('patient_list_members').delete().eq('list_id', listId).in('patient_id', chunk).select('id')
      if (error) throw error
      removed += data?.length ?? 0
    }
    return removed
  }

  async function removeMatching(listId: string, filters: PatientFilters, clinicId: string | null): Promise<number> {
    const { data, error } = await supabase.rpc('remove_matching_from_patient_list', { p_list_id: listId, p_filters: filters as Json, p_clinic_id: clinicId ?? undefined })
    if (error) throw error
    return data ?? 0
  }

  return { lists, counts, loaded, failed, counting, refresh, refreshCounts, canManage, create, update, remove, addPatients, addMatching, removePatients, removeMatching }
}
