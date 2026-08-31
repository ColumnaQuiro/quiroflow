export interface ToastItem {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

// Module-scoped, not useState -- toasts are ephemeral client-only UI state
// triggered by user actions after mount, so every caller sharing one plain
// ref is simpler than wiring this through Nuxt's SSR-safe state store.
const toasts = ref<ToastItem[]>([])
let nextId = 0

export function useToast() {
  function showToast(message: string, type: ToastItem['type'] = 'success', durationMs = 4000) {
    const id = ++nextId
    toasts.value.push({ id, type, message })
    setTimeout(() => dismissToast(id), durationMs)
  }
  function dismissToast(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }
  return { toasts, showToast, dismissToast }
}
