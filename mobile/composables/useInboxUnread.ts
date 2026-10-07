// The Inbox tab's badge: conversations whose last message is from the other
// side and that I have not read (nor archived) -- inbox_unread_count(), the
// same number the web sidebar shows, per person as reads are.
//
// One count for the whole app, refreshed every minute while the app is in
// front, when it comes back, on every navigation (leaving a thread just read
// clears it), and by the Inbox itself when it marks or archives something.
const count = ref(0)
let started = false
let run = 0

export function useInboxUnread() {
  const supabase = useSupabaseClient()
  const { context, can } = usePractitionerContext()

  async function refresh() {
    if (!context.value || !can('inbox_access')) {
      count.value = 0
      return
    }
    const mine = ++run
    const { data, error } = await supabase.rpc('inbox_unread_count' as never)
    // A failed read keeps the last number rather than claiming zero.
    if (mine !== run || error) return
    count.value = typeof data === 'number' ? data : 0
  }

  // Called once, by the staff layout.
  function start() {
    if (started) return
    started = true
    const router = useRouter()
    setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 60000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh()
    })
    router.afterEach(() => refresh())
    watch(() => [context.value?.teamMemberId, context.value?.clinicId], () => refresh(), { immediate: true })
  }

  return { count, refresh, start }
}
