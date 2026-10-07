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
  /** The clinic's time zone (clinics.timezone): what "today" means on My Day. */
  timeZone: string
  photoStoragePath: string | null
  /** The role's permissions, as get_my_bootstrap returns them to the web. */
  permissions: Record<string, unknown>
}

const context = ref<PractitionerContext | null>(null)
const loading = ref(true)
/**
 * The last load failed (no connection, a refused read): not the same as "this
 * account has no team record". The layout says so, and the load is tried
 * again shortly, on reconnecting and on returning to the app. It used to be
 * marked done for good, so one failed cold start left My Day saying "no
 * visits today" and the calendar empty until the person signed out.
 */
const loadFailed = ref(false)
/** Every open clinic of the account, by name -- the switcher's list. */
const clinics = ref<{ id: string; name: string; timezone: string | null }[]>([])
// The clinic chosen on this device, as the web keeps it (stores/account.ts):
// a practitioner at a second location saw only the alphabetically first one.
const CLINIC_KEY = 'quiroflow_current_clinic'
let loadedForUserId: string | null = null
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryHooked = false

export function usePractitionerContext() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  function fail(userId: string) {
    loading.value = false
    loadFailed.value = true
    // Not marked as loaded, so the next attempt is not skipped.
    loadedForUserId = null
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => retry(userId), 5000)
  }
  function retry(userId?: string) {
    const id = userId ?? user.value?.sub
    if (!id || loadedForUserId === id || !loadFailed.value) return
    loadedForUserId = id
    load(id)
  }

  async function load(userId: string) {
    loading.value = true
    const { data: teamMember, error: memberError } = await supabase
      .from('team_members')
      .select('id, account_id, is_owner, full_name, photo_storage_path')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .maybeSingle()
    if (memberError) return fail(userId)
    if (!teamMember) {
      context.value = null
      loadFailed.value = false
      loading.value = false
      return
    }
    const [{ data: clinicRows, error: clinicsError }, { data: boot, error: bootError }, { data: links }] = await Promise.all([
      supabase.from('clinics').select('id, name, timezone').eq('account_id', teamMember.account_id).is('archived_at', null).order('name'),
      // The same source the web's store reads permissions from, so the app
      // hides what the role cannot do instead of offering it and failing.
      supabase.rpc('get_my_bootstrap' as never),
      supabase.from('team_member_clinics').select('clinic_id').eq('team_member_id', teamMember.id),
    ])
    // Without the role's permissions every restriction would read as absent
    // (an 'own'-diary role would be offered colleagues' free times), so a
    // failed read is a failed load, not an empty one.
    if (clinicsError || bootError) return fail(userId)
    loadFailed.value = false
    clinics.value = ((clinicRows as typeof clinics.value | null) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'es'))
    let stored: string | null = null
    try {
      stored = localStorage.getItem(CLINIC_KEY)
    } catch {
      stored = null
    }
    // Never chosen here: the first clinic this person works at, then the
    // first by name.
    const mine = new Set(((links as { clinic_id: string }[] | null) ?? []).map((l) => l.clinic_id))
    const chosen = clinics.value.find((c) => c.id === stored) ?? clinics.value.find((c) => mine.has(c.id)) ?? clinics.value[0] ?? null
    context.value = {
      teamMemberId: teamMember.id,
      accountId: teamMember.account_id,
      isOwner: teamMember.is_owner,
      fullName: teamMember.full_name,
      clinicId: chosen?.id ?? null,
      timeZone: chosen?.timezone || DEFAULT_CLINIC_TIMEZONE,
      photoStoragePath: teamMember.photo_storage_path,
      permissions: ((boot as { permissions?: Record<string, unknown> } | null)?.permissions ?? {}) as Record<string, unknown>,
    }
    loading.value = false
  }

  if (import.meta.client && !retryHooked) {
    retryHooked = true
    window.addEventListener('online', () => retry())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retry()
    })
  }

  watch(
    user,
    (u) => {
      if (!u) {
        context.value = null
        loadedForUserId = null
        loadFailed.value = false
        clearTimeout(retryTimer)
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

  // calendar_scope 'own': RLS returns this person only the appointments in
  // their own diary. Anything counted or searched across appointments --
  // free slots, "nothing booked", which visit of a care plan this is --
  // silently leaves out every colleague's. One rule, read by every screen
  // that has to say so or work around it.
  const ownDiaryOnly = computed(() => !!context.value && !context.value.isOwner && context.value.permissions.calendar_scope === 'own')

  /** Switches the clinic every screen works in, and remembers it here. */
  function setClinic(id: string) {
    const c = clinics.value.find((x) => x.id === id)
    if (!c || !context.value) return
    try {
      localStorage.setItem(CLINIC_KEY, id)
    } catch {
      // Not remembered; still switched for this run.
    }
    context.value = { ...context.value, clinicId: c.id, timeZone: c.timezone || DEFAULT_CLINIC_TIMEZONE }
  }

  return { context, loading, loadFailed, retry: () => retry(), can, restricted, ownDiaryOnly, clinics, setClinic }
}
