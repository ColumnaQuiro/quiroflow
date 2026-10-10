import type { Ref } from 'vue'

// The tab pages (Calendar, Inbox, Patients) are kept alive between tabs
// (definePageMeta keepalive), so the day, the view and an open chat are
// still there on the way back. Two things keep-alive does not do by itself:
//
// - A box taken out of the document forgets how far it was scrolled, so each
//   scroller named here is put back where it was.
// - Timers and listeners keep running while the page is hidden. `active` says
//   whether it is on screen, for a poll to rest on; `onReturn` runs each time
//   it comes back (not on the first show), to catch up on what changed.
export function useKeptAlive(opts: { scrollers?: Ref<HTMLElement | null | undefined>[]; onReturn?: () => void } = {}) {
  const active = ref(true)
  const scrollers = opts.scrollers ?? []
  // Noted as navigation starts, while the page is still in the document: by
  // the time onDeactivated runs it has been taken out and every box reads 0.
  const saved: number[] = []
  if (scrollers.length) {
    const stop = useRouter().beforeEach(() => {
      if (active.value) scrollers.forEach((el, i) => (saved[i] = el.value?.scrollTop ?? 0))
    })
    onBeforeUnmount(stop)
  }
  let shownOnce = false
  onDeactivated(() => {
    active.value = false
  })
  onActivated(() => {
    active.value = true
    if (!shownOnce) {
      shownOnce = true
      return
    }
    nextTick(() =>
      scrollers.forEach((el, i) => {
        if (el.value && saved[i] !== undefined) el.value.scrollTop = saved[i]
      }),
    )
    opts.onReturn?.()
  })
  return { active }
}
