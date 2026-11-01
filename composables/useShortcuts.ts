import type { Ref } from 'vue'

// Single-key shortcuts, the way Gmail and Google Calendar do them: a plain
// letter, never while typing, never with a modifier (those belong to the
// browser and the OS). Everything goes through one document listener and a
// stack of registrations, so the newest screen wins and two handlers can never
// both take the same key -- "g" then "c" goes to the calendar rather than also
// opening a new appointment there.
//
// A registration with `within` only answers while that element is the
// topmost open dialog (aria-modal), and one without only while no dialog is
// open: with the appointment panel open, "n" does not start a second
// appointment behind it. The list people see is ShortcutsDialog.vue.

type Handler = (e: KeyboardEvent) => void
interface Registration {
  keys: Record<string, Handler>
  within?: Ref<HTMLElement | null | undefined>
}

const stack: Registration[] = []
let installed = false
let goUntil = 0
let goTargets: Record<string, string> = {}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

function topModal(): HTMLElement | null {
  const open = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter((el) => el.getClientRects().length > 0)
  return open.at(-1) ?? null
}

function onKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
  if (isTypingTarget(e.target)) return
  const modal = topModal()

  // The second key of "g …".
  if (Date.now() < goUntil) {
    goUntil = 0
    const to = goTargets[e.key]
    if (to && !modal) {
      e.preventDefault()
      navigateTo(to)
    }
    return
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    const reg = stack[i]!
    const inScope = reg.within ? !!reg.within.value && modal === reg.within.value : !modal
    if (!inScope) continue
    const run = reg.keys[e.key]
    if (!run) continue
    e.preventDefault()
    run(e)
    return
  }
}

/** Registers shortcuts for as long as the calling component is mounted. */
export function useShortcuts(keys: Record<string, Handler>, opts: { within?: Ref<HTMLElement | null | undefined> } = {}) {
  const reg: Registration = { keys, within: opts.within }
  onMounted(() => {
    if (!installed) {
      document.addEventListener('keydown', onKeydown)
      installed = true
    }
    stack.push(reg)
  })
  onBeforeUnmount(() => {
    const i = stack.indexOf(reg)
    if (i >= 0) stack.splice(i, 1)
  })
}

/** "g" then a letter: where each letter goes. Set once, by the staff layout. */
export function useGoShortcuts(targets: () => Record<string, string>) {
  useShortcuts({
    g: () => {
      goTargets = targets()
      goUntil = Date.now() + 1500
    },
  })
}
