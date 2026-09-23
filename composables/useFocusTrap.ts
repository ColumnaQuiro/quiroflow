// Keeps keyboard focus inside a dialog while it is open, closes it on Escape,
// and hands focus back to whatever had it before -- the three things a modal
// side panel owes a keyboard user. Nothing else in the app traps focus yet;
// written small so the next dialog can use it too.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(container: Ref<HTMLElement | null>, onEscape: () => void) {
  let previous: HTMLElement | null = null

  function focusables(): HTMLElement[] {
    const el = container.value
    if (!el) return []
    return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement)
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // A nested dialog (confirm, reschedule) handles its own Escape first.
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
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey && (active === first || !container.value?.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !container.value?.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }

  onMounted(() => {
    previous = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', onKeydown)
    nextTick(() => {
      const el = container.value
      if (!el) return
      const autofocus = el.querySelector<HTMLElement>('[autofocus], [data-autofocus]')
      ;(autofocus ?? focusables()[0] ?? el).focus()
    })
  })
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
    // Back to the block or cell that opened it, if it is still there.
    if (previous && document.contains(previous)) previous.focus()
  })
}
