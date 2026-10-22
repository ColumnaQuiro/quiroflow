import { normalizeFilters, type PatientFilters } from '~/utils/patientFilters'

// Saved filters on the patient list (patient_segments,
// 20261022173310_patient_segments.sql): the segments the person can see --
// the team's shared ones and their own private ones; RLS decides which --
// and how many patients each would show right now.
//
// Counts come from one RPC for every segment, evaluated by the same
// patients_matching the list itself runs, so the number beside a segment is
// the number of rows opening it shows. They are taken for the sidebar's
// clinic, as the list is.

export interface PatientSegment {
  id: string
  name: string
  filters: PatientFilters
  shared: boolean
  created_by: string | null
}

export function usePatientSegments() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const { can } = usePermission()

  const segments = ref<PatientSegment[]>([])
  const counts = ref<Record<string, number>>({})
  const loaded = ref(false)
  const counting = ref(false)
  let countToken = 0

  async function load() {
    if (!store.accountId) return
    const { data, error } = await supabase
      .from('patient_segments')
      .select('id, name, filters, shared, created_by')
      .eq('account_id', store.accountId)
      .order('name')
    if (error) throw error
    segments.value = (data ?? []).map((s) => ({ ...s, filters: normalizeFilters((s.filters ?? {}) as Record<string, unknown>) }))
    loaded.value = true
  }

  async function refreshCounts() {
    const token = ++countToken
    counting.value = true
    const { data, error } = await supabase.rpc('patient_segment_counts', { p_clinic_id: store.currentClinicId ?? undefined })
    if (error) throw error
    if (token !== countToken) return
    const next: Record<string, number> = {}
    for (const row of data ?? []) next[row.segment_id] = Number(row.patient_count)
    counts.value = next
    counting.value = false
  }

  async function refresh() {
    await Promise.all([load(), refreshCounts()])
  }

  /** The author, or anyone who can edit patients when it is shared -- the RLS rule. */
  function canManage(segment: PatientSegment) {
    return segment.created_by === store.teamMember?.id || (segment.shared && can('patients_edit'))
  }

  async function create(name: string, shared: boolean, filters: PatientFilters): Promise<PatientSegment> {
    const { data, error } = await supabase
      .from('patient_segments')
      // created_by is stamped by the database from the session; sent anyway
      // so the insert policy's check reads the same value either way.
      .insert({ account_id: store.accountId!, name: name.trim(), shared, filters: normalizeFilters({ ...filters }) as never, created_by: store.teamMember?.id ?? null })
      .select('id, name, filters, shared, created_by')
      .single()
    if (error) throw error
    await refresh()
    return { ...data, filters: normalizeFilters((data.filters ?? {}) as Record<string, unknown>) }
  }

  async function update(id: string, patch: { name?: string; shared?: boolean; filters?: PatientFilters }) {
    const row: { name?: string; shared?: boolean; filters?: never } = {}
    if (patch.name !== undefined) row.name = patch.name.trim()
    if (patch.shared !== undefined) row.shared = patch.shared
    if (patch.filters !== undefined) row.filters = normalizeFilters({ ...patch.filters }) as never
    // .select() so an update RLS refused -- zero rows, no error -- is
    // reported rather than looking like it worked.
    const { data, error } = await supabase.from('patient_segments').update(row).eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) throw new Error('segment not updated')
    await refresh()
  }

  async function remove(id: string) {
    const { data, error } = await supabase.from('patient_segments').delete().eq('id', id).select('id')
    if (error) throw error
    if (!data?.length) throw new Error('segment not deleted')
    await refresh()
  }

  return { segments, counts, loaded, counting, refresh, refreshCounts, canManage, create, update, remove }
}
