export interface FilterOption {
  id: string
  name: string
}

// Practitioner + clinic dropdowns are the same shape on every report that
// has them; this just avoids repeating the two fetches everywhere.
export function useReportFilterOptions() {
  const supabase = useSupabaseClient()
  const practitioners = ref<FilterOption[]>([])
  const clinics = ref<FilterOption[]>([])

  async function load() {
    const [{ data: tm }, { data: cl }] = await Promise.all([
      supabase.from('team_members').select('id, full_name').order('full_name'),
      supabase.from('clinics').select('id, name').order('name'),
    ])
    practitioners.value = (tm ?? []).map((t) => ({ id: t.id, name: t.full_name }))
    clinics.value = (cl ?? []).map((c) => ({ id: c.id, name: c.name }))
  }

  return { practitioners, clinics, load }
}
