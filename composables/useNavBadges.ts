export type NavBadge = 'myday' | 'recalls' | 'automations' | 'inbox'

// The sidebar's counters are asked for in one request (get_nav_badges) and
// kept here, so anything else that shows one of them -- the help widget's
// unread dot -- reads it instead of asking the database again on every page.
export function useNavBadges() {
  const request = useState<{ seq: number; only: NavBadge[] | null }>('nav-badges-request', () => ({ seq: 0, only: null }))
  const supportUnread = useState<boolean>('nav-badges-support-unread', () => false)
  return {
    request,
    supportUnread,
    refresh: (only?: NavBadge[]) => {
      request.value = { seq: request.value.seq + 1, only: only ?? null }
    },
  }
}
