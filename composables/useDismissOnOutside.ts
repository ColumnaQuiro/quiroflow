import type { Ref } from 'vue'

// Closes a hand-rolled dropdown when the person clicks anywhere outside it or
// presses Escape, the way every menu in the operating system behaves.
//
// `root` is the element wrapping BOTH the toggle button and the menu, so a
// click on the toggle is "inside" and leaves the toggle's own handler to open
// or close it. Listening to `pointerdown` in the capture phase, rather than
// `click`, means a click on something that stops propagation (a calendar
// cell, a row with its own handler) still closes the menu, and it closes as
// the press starts instead of after it.
//
// It relies on nothing but the click: a menu that closed on its button's
// `blur` stayed open in Safari, which does not focus a button when it is
// clicked, so the blur never came.
export function useDismissOnOutside(root: Ref<HTMLElement | null | undefined>, open: Ref<boolean>) {
  function onPointerDown(e: PointerEvent) {
    if (!open.value) return
    const el = root.value
    if (el && e.target instanceof Node && el.contains(e.target)) return
    open.value = false
  }
  function onKeydown(e: KeyboardEvent) {
    if (open.value && e.key === 'Escape') open.value = false
  }
  onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('keydown', onKeydown)
  })
}
