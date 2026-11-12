// The clinic's team, read once and shared.
//
// Patients, Inbox, Recalls, My Day and every report with a practitioner
// filter each fetched team_members on mount -- the same dozen rows, one more
// request per navigation on a database where the request, not the query, is
// what costs (50-100 ms each, and they queue). Same shape and reasoning as
// useBillingTemplates: module scope, refetched after five minutes or when the
// account changes, and invalidated by the screens that edit a team member.
//
// Former colleagues (deleted_at set) are kept in the list, because old
// records still name them; callers that offer people to choose from use
// `active` or `practitioners`.
export interface TeamDirectoryMember {
  id: string
  full_name: string
  color: string
  is_practitioner: boolean
  deleted_at: string | null
}

const members = ref<TeamDirectoryMember[] | null>(null)
let pending: Promise<void> | null = null
let loadedFor: string | null = null
let loadedAt = 0
const MAX_AGE_MS = 5 * 60 * 1000

export function invalidateTeamDirectory() {
  loadedAt = 0
}

export function useTeamDirectory() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()

  // Resolves once the list is there. A failed read is not cached as "nobody":
  // it throws, as the per-page reads it replaces did, and the next call tries
  // again.
  async function ensureLoaded() {
    const accountId = store.accountId
    const fresh = loadedFor === accountId && Date.now() - loadedAt < MAX_AGE_MS
    if (members.value && fresh) return
    if (!pending) {
      pending = (async () => {
        const { data, error } = await supabase
          .from('team_members')
          .select('id, full_name, color, is_practitioner, deleted_at')
          .order('full_name')
        if (error) throw error
        members.value = (data ?? []) as TeamDirectoryMember[]
        loadedFor = accountId
        loadedAt = Date.now()
      })().finally(() => {
        pending = null
      })
    }
    await pending
  }

  const all = computed(() => members.value ?? [])
  const active = computed(() => all.value.filter((m) => !m.deleted_at))
  const practitioners = computed(() => active.value.filter((m) => m.is_practitioner))

  return { all, active, practitioners, ensureLoaded }
}
