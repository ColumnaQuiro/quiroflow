import type { Ref } from 'vue'

// Touch-only by design, same as every native app's pull-to-refresh -- there's
// no equivalent mouse gesture worth inventing, so this simply never engages
// for a desktop-with-mouse visitor (silent polling covers them instead; see
// callers). Only activates a pull when the container is already scrolled to
// its top: a downward drag anywhere else is just normal scrolling.
export function usePullToRefresh(containerRef: Ref<HTMLElement | null | undefined>, onRefresh: () => Promise<void>) {
  const THRESHOLD = 64
  const pulling = ref(false)
  const refreshing = ref(false)
  const pullDistance = ref(0)
  let startY = 0
  let active = false

  function onTouchStart(e: TouchEvent) {
    const el = containerRef.value
    active = !!el && !refreshing.value && el.scrollTop <= 0
    if (!active) return
    startY = e.touches[0]?.clientY ?? 0
    pullDistance.value = 0
    pulling.value = false
  }

  function onTouchMove(e: TouchEvent) {
    if (!active) return
    const el = containerRef.value
    if (!el || el.scrollTop > 0) {
      active = false
      pullDistance.value = 0
      pulling.value = false
      return
    }
    const dy = (e.touches[0]?.clientY ?? 0) - startY
    if (dy <= 0) {
      pullDistance.value = 0
      pulling.value = false
      return
    }
    // Resistance so the indicator trails the finger like a spring instead of
    // tracking it 1:1, which is what makes a drag read as "pull" rather than
    // "scroll" -- also caps how far it can be dragged past the threshold.
    pullDistance.value = Math.min(dy * 0.5, THRESHOLD * 1.5)
    pulling.value = pullDistance.value >= THRESHOLD
  }

  async function onTouchEnd() {
    if (!active) return
    active = false
    const shouldRefresh = pulling.value
    pullDistance.value = 0
    pulling.value = false
    if (!shouldRefresh) return
    refreshing.value = true
    try {
      await onRefresh()
    } finally {
      refreshing.value = false
    }
  }

  return { pulling, refreshing, pullDistance, onTouchStart, onTouchMove, onTouchEnd }
}
