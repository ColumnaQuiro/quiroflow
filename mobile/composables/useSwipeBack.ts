// Edge-swipe-to-go-back, like the native iOS gesture -- this app has no
// real navigation stack (switching from a thread back to the conversation
// list is just local component state, not a route change), so there's
// nothing for iOS's own edge-swipe gesture to hook into. This reimplements
// the recognizable part of it: a swipe starting near the left edge and
// moving right far enough, without much vertical drift (so it doesn't
// fight a normal vertical scroll), triggers onBack.
export function useSwipeBack(onBack: () => void) {
  let startX = 0
  let startY = 0
  let tracking = false

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0]
    if (!t || t.clientX > 24) {
      tracking = false
      return
    }
    startX = t.clientX
    startY = t.clientY
    tracking = true
  }
  function onTouchMove(e: TouchEvent) {
    if (!tracking) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - startX
    const dy = Math.abs(t.clientY - startY)
    if (dx > 70 && dy < 40) {
      tracking = false
      onBack()
    } else if (dy > 30) {
      tracking = false
    }
  }
  function onTouchEnd() {
    tracking = false
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

  return { attach, detach }
}
