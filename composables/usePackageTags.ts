// Which of a patient's tags came from a bono or a membership, for
// patients_tags_remove ("Remove bono or membership tags").
//
// Nothing marks where a tag came from: patients.tags is a plain text[], and
// these tags arrived with the PracticeHub import, where selling a bono or a
// membership tags the patient with its name. So a tag counts as one when it
// is the name of one of this clinic's bonos or memberships -- the same test
// the database applies (patient_tag_removal_needs_permission, 20260925074722),
// which is what makes this a guard and not only a hidden button.
export function usePackageTags() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  // Per account, so signing into another clinic in the same tab does not
  // carry the last one's catalogue over.
  const names = useState<string[] | null>(`package-tag-names-${store.accountId ?? ''}`, () => null)

  async function load() {
    if (names.value) return
    const [p, m] = await Promise.all([supabase.from('packages').select('name'), supabase.from('memberships').select('name')])
    names.value = [...(p.data ?? []), ...(m.data ?? [])].map((r) => normalise(r.name))
  }

  function normalise(s: string) {
    return s.trim().toLocaleLowerCase('es')
  }

  function isPackageTag(tag: string) {
    return (names.value ?? []).includes(normalise(tag))
  }

  return { load, isPackageTag }
}
