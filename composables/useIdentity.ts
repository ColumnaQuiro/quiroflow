export interface IdentityPatient {
  id: string
  first_name: string
  last_name: string | null
}
export interface IdentityTeamMember {
  id: string
  account_id: string
}

// Resolves which of the two disjoint account models (patient vs. staff
// team_member) the signed-in auth user belongs to -- nothing in the schema
// prevents a user being both (e.g. a practitioner who is also a patient of
// their own clinic), so callers should handle patient/teamMember both being
// set, not assume exactly one. Replaces the ad-hoc per-page `patients`
// re-query middleware/portal.global.ts and pages/portal/index.vue each do
// today with a single shared source of truth, usable from both the web
// portal and the mobile app.
export function useIdentity() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const patient = ref<IdentityPatient | null>(null)
  const teamMember = ref<IdentityTeamMember | null>(null)
  const loading = ref(true)

  async function load() {
    if (!user.value) {
      patient.value = null
      teamMember.value = null
      loading.value = false
      return
    }
    loading.value = true
    // Right after a sign-in transition, the reactive `user` can update a tick
    // before the client's internal session (and thus the auth header on
    // subsequent requests) has fully settled -- querying immediately can
    // race and come back empty even though the account is genuinely linked.
    // Awaiting the session first ensures the queries below carry a fresh token.
    await supabase.auth.getSession()
    const [{ data: p }, { data: tm }] = await Promise.all([
      supabase.from('patients').select('id, first_name, last_name').eq('user_id', user.value.sub).maybeSingle(),
      supabase.from('team_members').select('id, account_id').eq('user_id', user.value.sub).maybeSingle(),
    ])
    patient.value = p
    teamMember.value = tm
    loading.value = false
  }

  watch(user, load, { immediate: true })

  return { patient, teamMember, loading, reload: load }
}
