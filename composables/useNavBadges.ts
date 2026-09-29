export type NavBadge = 'myday' | 'recalls' | 'automations' | 'inbox'

// The sidebar lives in the layout, so it mounts once and never again: a count
// loaded on mount stays whatever it was when the app opened. It reloads on
// returning to the tab, on a clinic switch and -- at most once a minute -- on
// navigation, and a page that changes what a badge counts calls refresh() so
// the number moves while you are still looking at it -- snoozing someone on
// /recalls, for one.
//
// refresh() can name the badges it changed. The recalls count is an exact
// count over recall_candidates, the most expensive request the sidebar makes,
// and the Inbox marking a thread read has no business re-asking it.
export function useNavBadges() {
  const request = useState<{ seq: number; only: NavBadge[] | null }>('nav-badges-request', () => ({ seq: 0, only: null }))
  return {
    request,
    refresh: (only?: NavBadge[]) => {
      request.value = { seq: request.value.seq + 1, only: only ?? null }
    },
  }
}
