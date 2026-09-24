// The sidebar lives in the layout, so it mounts once and never again: a count
// loaded on mount stays whatever it was when the app opened. It now reloads
// on navigation, on returning to the tab and on a clinic switch, and a page
// that changes what a badge counts calls refresh() so the number moves while
// you are still looking at it -- snoozing someone on /recalls, for one.
export function useNavBadges() {
  const tick = useState('nav-badges-tick', () => 0)
  return { tick, refresh: () => { tick.value++ } }
}
