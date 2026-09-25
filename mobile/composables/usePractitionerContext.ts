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
  photoStoragePath: string | null
  /** The role's permissions, as get_my_bootstrap returns them to the web. */
  permissions: Record<string, unknown>
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
      .select('id, account_id, is_owner, full_name, photo_storage_path')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!teamMember) {
      context.value = null
      loading.value = false
      return
    }
    const [{ data: clinics }, { data: boot }] = await Promise.all([
      supabase.from('clinics').select('id').eq('account_id', teamMember.account_id).is('archived_at', null).order('name').limit(1),
      // The same source the web's store reads permissions from, so the app
      // hides what the role cannot do instead of offering it and failing.
      supabase.rpc('get_my_bootstrap' as never),
    ])
    context.value = {
      teamMemberId: teamMember.id,
      accountId: teamMember.account_id,
      isOwner: teamMember.is_owner,
      fullName: teamMember.full_name,
      clinicId: clinics?.[0]?.id ?? null,
      photoStoragePath: teamMember.photo_storage_path,
      permissions: ((boot as { permissions?: Record<string, unknown> } | null)?.permissions ?? {}) as Record<string, unknown>,
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

  // Mirrors composables/usePermission.ts on the web: an owner can do
  // everything and is never restricted.
  function can(key: string): boolean {
    return !!context.value && (context.value.isOwner || context.value.permissions[key] === true)
  }
  function restricted(key: string): boolean {
    return !!context.value && !context.value.isOwner && context.value.permissions[key] === true
  }

  return { context, loading, can, restricted }
}
