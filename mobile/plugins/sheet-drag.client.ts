import { nextTick, type Directive } from 'vue'

// Swipe a bottom sheet down to dismiss it, as a native iOS sheet does:
// `v-sheet-drag="close"` on the sheet's panel (the element with role="dialog",
// whose parent is the dimmed backdrop). The sheets had a grab handle that did
// nothing -- only a tap on the backdrop closed them.
//
// The panel follows the finger (a transform, so no layout per frame) and the
// backdrop fades with it. Letting go past a third of the panel, or flicking
// down, slides it away and then calls the binding; letting go earlier springs
// it back. Like useSwipeBack, the release is a CSS transition with a timer
// rather than an rAF loop or transitionend.
//
// The drag only starts on a downward move when nothing under the finger is
// scrolled: a sheet whose content has been scrolled scrolls back up first,
// and an upward or sideways move is left to the browser. It is decided on the
// first touchmove, because iOS ignores preventDefault once a scroll has begun.
// From md up the sheets are centred dialogs, so there is nothing to drag.
//
// A binding that does not close the sheet (it is still saving, say) leaves the
// panel in place: it springs back instead of staying invisible off-screen.

type Close = () => void

const DISMISS_MS = 240
const RETURN_MS = 300
const EASE = 'cubic-bezier(.32,.72,0,1)'
// px/ms; the same flick useSwipeBack takes as "go back".
const FLICK_VELOCITY = 0.5

const closers = new WeakMap<HTMLElement, Close>()
const detachers = new WeakMap<HTMLElement, () => void>()

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Something between the touch and the panel that is scrolled away from its top.
function scrolledBetween(target: EventTarget | null, panel: HTMLElement) {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el.scrollTop > 0) return true
    if (el === panel) break
  }
  return false
}

function attach(panel: HTMLElement) {
  let tracking = false
  let decided = false
  let dragging = false
  let settling = false
  let startX = 0
  let startY = 0
  let offset = 0
  let height = 0
  let backdrop: HTMLElement | null = null
  let rgb = '0, 0, 0'
  let alpha = 0
  let samples: { y: number; t: number }[] = []

  function paint(y: number) {
    offset = y
    panel.style.transform = `translate3d(0, ${y}px, 0)`
    if (backdrop) backdrop.style.backgroundColor = `rgba(${rgb}, ${alpha * Math.max(0, 1 - y / height)})`
  }
  function animate(ms: number) {
    panel.style.transition = `transform ${ms}ms ${EASE}`
    if (backdrop) backdrop.style.transition = `background-color ${ms}ms ${EASE}`
  }
  function reset() {
    panel.style.transform = ''
    panel.style.transition = ''
    panel.style.willChange = ''
    if (backdrop) {
      backdrop.style.backgroundColor = ''
      backdrop.style.transition = ''
    }
    settling = false
  }

  function springBack() {
    if (reducedMotion()) return reset()
    settling = true
    animate(RETURN_MS)
    paint(0)
    setTimeout(reset, RETURN_MS)
  }
  function dismiss() {
    settling = true
    const done = () => {
      closers.get(panel)?.()
      // Removed by the close: nothing left to do. Still here: it refused.
      nextTick(() => {
        if (panel.isConnected) springBack()
      })
    }
    if (reducedMotion()) return done()
    animate(DISMISS_MS)
    paint(height)
    setTimeout(done, DISMISS_MS)
  }

  function onTouchStart(e: TouchEvent) {
    tracking = false
    if (settling || e.touches.length !== 1) return
    if (window.matchMedia('(min-width: 768px)').matches) return
    if (e.target instanceof Element && e.target.closest('input[type="range"], [data-sheet-drag-ignore]')) return
    if (scrolledBetween(e.target, panel)) return
    const t = e.touches[0]
    startX = t.clientX
    startY = t.clientY
    tracking = true
    decided = false
    dragging = false
  }
  function onTouchMove(e: TouchEvent) {
    if (!tracking) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (!decided) {
      if (dx === 0 && dy === 0) return
      decided = true
      if (dy <= 0 || Math.abs(dx) > dy) {
        tracking = false
        return
      }
      dragging = true
      height = panel.getBoundingClientRect().height || window.innerHeight
      backdrop = panel.parentElement
      const parts = backdrop ? getComputedStyle(backdrop).backgroundColor.match(/[\d.]+/g) : null
      rgb = parts ? parts.slice(0, 3).join(', ') : '0, 0, 0'
      alpha = parts ? (parts[3] === undefined ? 1 : Number(parts[3])) : 0
      panel.style.transition = 'none'
      panel.style.willChange = 'transform'
      if (backdrop) backdrop.style.transition = 'none'
      samples = []
    }
    e.preventDefault()
    paint(Math.max(0, dy))
    samples.push({ y: t.clientY, t: performance.now() })
    if (samples.length > 6) samples.shift()
  }
  function onTouchEnd(e: TouchEvent) {
    if (!tracking) return
    tracking = false
    if (!dragging) return
    dragging = false
    // No click on whatever the finger lifted over.
    if (e.cancelable) e.preventDefault()
    const first = samples[0]
    const last = samples[samples.length - 1]
    const velocity = first && last ? (last.y - first.y) / Math.max(1, last.t - first.t) : 0
    const far = offset > Math.min(height / 3, 160)
    const flick = velocity > FLICK_VELOCITY && offset > 16
    if (e.type === 'touchend' && (far || flick)) dismiss()
    else springBack()
  }

  panel.addEventListener('touchstart', onTouchStart, { passive: true })
  panel.addEventListener('touchmove', onTouchMove, { passive: false })
  panel.addEventListener('touchend', onTouchEnd, { passive: false })
  panel.addEventListener('touchcancel', onTouchEnd, { passive: false })
  return () => {
    panel.removeEventListener('touchstart', onTouchStart)
    panel.removeEventListener('touchmove', onTouchMove)
    panel.removeEventListener('touchend', onTouchEnd)
    panel.removeEventListener('touchcancel', onTouchEnd)
  }
}

const sheetDrag: Directive<HTMLElement, Close> = {
  mounted(el, binding) {
    closers.set(el, binding.value)
    detachers.set(el, attach(el))
    // WebKit sizes a just-inserted sheet to its max-height (max-h-[88%])
    // rather than its content, and corrects that on the next relayout of the
    // panel -- which the first drag causes, so the sheet jumped by the
    // difference (21px on the Inbox filters) the first time it was touched.
    // Toggling will-change for a frame is that relayout, done before anyone
    // touches it. Chrome lays it out right first time; this costs it nothing.
    requestAnimationFrame(() => {
      el.style.willChange = 'transform'
      requestAnimationFrame(() => {
        el.style.willChange = ''
      })
    })
  },
  updated(el, binding) {
    closers.set(el, binding.value)
  },
  beforeUnmount(el) {
    detachers.get(el)?.()
    detachers.delete(el)
    closers.delete(el)
  },
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('sheet-drag', sheetDrag)
})

declare module 'vue' {
  interface GlobalDirectives {
    vSheetDrag: Directive<HTMLElement, Close>
  }
}

