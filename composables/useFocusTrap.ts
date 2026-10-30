// Keeps keyboard focus inside a dialog while it is open, closes it on Escape,
// and hands focus back to whatever had it before -- the three things a modal
// owes a keyboard user.
//
// A dialog that is its own component (mounted only while open) passes just the
// container and the close. A dialog that lives inside a bigger component
// behind a `v-if` passes `active` too, so the trap follows that flag instead
// of the component's whole lifetime:
//
//   useFocusTrap(refundPanel, closeRefundModal, () => refundModalOpen.value)
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// The traps that are open, innermost last. Only the innermost one answers Tab
// and Escape. Every trap listens on document, and listeners run in the order
// they were added, so without this a panel opened first took Escape before
// the confirm opened on top of it -- and closed itself underneath it.
const openTraps: object[] = []

export function useFocusTrap(container: Ref<HTMLElement | null>, onEscape: () => void, active?: () => boolean) {
  const self = {}
  let previous: HTMLElement | null = null
  let on = false

  function focusables(): HTMLElement[] {
    const el = container.value
    if (!el) return []
    return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement)
  }

  function onKeydown(e: KeyboardEvent) {
    if (openTraps[openTraps.length - 1] !== self) return
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return
      e.preventDefault()
      onEscape()
      return
    }
    if (e.key !== 'Tab') return
    const list = focusables()
    if (list.length === 0) return
    const first = list[0]
    const last = list[list.length - 1]
    const activeEl = document.activeElement as HTMLElement | null
    if (e.shiftKey && (activeEl === first || !container.value?.contains(activeEl))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (activeEl === last || !container.value?.contains(activeEl))) {
      e.preventDefault()
      first.focus()
    }
  }

  function activate() {
    if (on) return
    on = true
    previous = document.activeElement as HTMLElement | null
    openTraps.push(self)
    document.addEventListener('keydown', onKeydown)
    nextTick(() => {
      const el = container.value
      if (!el || !on) return
      const autofocus = el.querySelector<HTMLElement>('[autofocus], [data-autofocus]')
      ;(autofocus ?? focusables()[0] ?? el).focus()
    })
  }

  function deactivate() {
    if (!on) return
    on = false
    const i = openTraps.indexOf(self)
    if (i !== -1) openTraps.splice(i, 1)
    document.removeEventListener('keydown', onKeydown)
    // Back to the block or cell that opened it, if it is still there.
    if (previous && document.contains(previous)) previous.focus()
  }

  if (active) watch(active, (open) => (open ? activate() : deactivate()))
  onMounted(() => {
    if (!active || active()) activate()
  })
  onBeforeUnmount(deactivate)
}
