// Edge-swipe-to-go-back, like the native iOS gesture -- this app has no
// real navigation stack (switching from a thread back to the conversation
// list is just local component state, not a route change), so there's
// nothing for iOS's own edge-swipe gesture to hook into. This reimplements
// the recognizable part of it: a swipe starting near the left edge tracks
// the finger live (dragX drives the thread's transform every frame instead
// of snapping at a threshold), and releasing either commits to onBack or
// springs back, decided by final distance OR flick velocity so a fast short
// swipe still goes back the same way a slow long one does. The release
// animation is a CSS transition (driven by flipping `dragging` off, same as
// the row-swipe reveal) rather than a hand-rolled rAF loop -- the compositor
// runs it smoothly with no per-frame JS, and unlike rAF it isn't paused by
// the page-visibility throttling some WebViews apply mid-gesture.
export function useSwipeBack(onBack: () => void) {
  const active = ref(false)
  const dragging = ref(false)
  const dragX = ref(0)

  const SETTLE_MS = 200
  let startX = 0
  let startY = 0
  let tracking = false
  let recognized = false
  let samples: { x: number; t: number }[] = []
  let settleTimer: ReturnType<typeof setTimeout> | null = null

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0]
    if (!t || t.clientX > 24) {
      tracking = false
      return
    }
    if (settleTimer) clearTimeout(settleTimer)
    startX = t.clientX
    startY = t.clientY
    tracking = true
    recognized = false
    samples = [{ x: t.clientX, t: performance.now() }]
  }
  function onTouchMove(e: TouchEvent) {
    if (!tracking) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - startX
    const dy = Math.abs(t.clientY - startY)
    if (!recognized) {
      if (dy > 30 && dy > dx) {
        tracking = false
        return
      }
      if (dx > 8) {
        recognized = true
        active.value = true
        dragging.value = true
      }
    }
    if (!recognized) return
    dragX.value = Math.max(0, dx)
    samples.push({ x: t.clientX, t: performance.now() })
    if (samples.length > 6) samples.shift()
  }
  function onTouchEnd() {
    if (!tracking) return
    tracking = false
    if (!recognized) return
    const first = samples[0]
    const last = samples[samples.length - 1]
    const dt = Math.max(1, last.t - first.t)
    const velocity = (last.x - first.x) / dt // px/ms
    const width = window.innerWidth || 375
    settle(dragX.value > width * 0.35 || velocity > 0.5)
  }
  function settle(commit: boolean) {
    dragging.value = false
    dragX.value = commit ? (window.innerWidth || 375) : 0
    settleTimer = setTimeout(() => {
      active.value = false
      dragX.value = 0
      if (commit) onBack()
    }, SETTLE_MS)
  }

  function attach(el: HTMLElement) {
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
  }
  function detach(el: HTMLElement) {
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
  }

  return { active, dragging, dragX, attach, detach }
}
