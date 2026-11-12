export interface FilterOption {
  id: string
  name: string
}

// Practitioner + clinic dropdowns are the same shape on every report that
// has them; this just avoids repeating the two fetches everywhere.
export function useReportFilterOptions() {
  const supabase = useSupabaseClient()
  const teamDirectory = useTeamDirectory()
  const practitioners = ref<FilterOption[]>([])
  const clinics = ref<FilterOption[]>([])

  async function load() {
    const [, { data: cl }] = await Promise.all([
      teamDirectory.ensureLoaded().catch(() => {}),
      supabase.from('clinics').select('id, name').order('name'),
    ])
    // Former practitioners stay in the filter: past figures are still theirs.
    practitioners.value = teamDirectory.all.value.filter((m) => m.is_practitioner).map((m) => ({ id: m.id, name: m.full_name }))
    clinics.value = (cl ?? []).map((c) => ({ id: c.id, name: c.name }))
  }

  return { practitioners, clinics, load }
}
