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
//
// A template `ref="name"` placed inside a `v-for` fills the ref with an ARRAY
// of elements, not one element, and a ref on a component holds the component.
// The patient's "Send history" menu (AppointmentsTab, inside the loop over
// visit groups) was the first: every press anywhere on the page threw
// "r.contains is not a function" and the menu never closed. So whatever the
// ref holds is read down to the elements it stands for.
type DismissRoot = Element | { $el?: unknown } | null | undefined
function rootElements(value: DismissRoot | DismissRoot[]): Element[] {
  const items = Array.isArray(value) ? value : [value]
  const out: Element[] = []
  for (const item of items) {
    if (item instanceof Element) out.push(item)
    else if (item && typeof item === 'object' && item.$el instanceof Element) out.push(item.$el)
  }
  return out
}

export function useDismissOnOutside(root: Ref<DismissRoot | DismissRoot[]>, open: Ref<boolean>) {
  function onPointerDown(e: PointerEvent) {
    if (!open.value) return
    const target = e.target
    if (target instanceof Node && rootElements(root.value).some((el) => el.contains(target))) return
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
