// The web app resolves account/clinic context from stores/account.ts, a
// Pinia store -- but mobile's nuxt.config.ts deliberately doesn't register
// @pinia/nuxt (keeping this bundle a plain small Nuxt project, not a layer
// of the 57-page staff app), so that store can't be used here. This is the
// same minimal query, done directly, for the handful of practitioner pages
// (My Day, Calendar, Patients, Profile) that need account_id/clinic_id.
//
// Module-level state (like useIdentity.ts) so switching tabs doesn't
// re-query, but reactive to the signed-in user (like useIdentity.ts) so a
// sign-out/sign-in within the same app session doesn't leave stale data
// from the previous account.
export interface PractitionerContext {
  teamMemberId: string
  accountId: string
  isOwner: boolean
  fullName: string
  clinicId: string | null
}

const context = ref<PractitionerContext | null>(null)
const loading = ref(true)
let loadedForUserId: string | null = null

export function usePractitionerContext() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  async function load(userId: string) {
    loading.value = true
    const { data: teamMember } = await supabase
      .from('team_members')
      .select('id, account_id, is_owner, full_name')
      .eq('user_id', userId)
      .maybeSingle()
    if (!teamMember) {
      context.value = null
      loading.value = false
      return
    }
    const { data: clinics } = await supabase.from('clinics').select('id').eq('account_id', teamMember.account_id).order('name').limit(1)
    context.value = {
      teamMemberId: teamMember.id,
      accountId: teamMember.account_id,
      isOwner: teamMember.is_owner,
      fullName: teamMember.full_name,
      clinicId: clinics?.[0]?.id ?? null,
    }
    loading.value = false
  }

  watch(
    user,
    (u) => {
      if (!u) {
        context.value = null
        loadedForUserId = null
        loading.value = false
        return
      }
      if (loadedForUserId === u.sub) return
      loadedForUserId = u.sub
      load(u.sub)
    },
    { immediate: true },
  )

  return { context, loading }
}
