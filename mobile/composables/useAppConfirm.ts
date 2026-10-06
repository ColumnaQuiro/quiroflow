// The app's own confirm and alert, in place of the browser's confirm() and
// alert(), which showed a WebView dialog titled "localhost" next to sheets
// styled like the rest of the app. Same answers as before: ask() resolves
// true or false, notify() resolves once dismissed. Drawn by AppConfirmHost,
// mounted once in app.vue.
interface ConfirmRequest {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

const current = ref<ConfirmRequest | null>(null)

export function useAppConfirm() {
  function ask(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
    current.value?.resolve(false)
    return new Promise((resolve) => {
      current.value = { ...opts, resolve }
    })
  }
  function notify(title: string, body?: string) {
    return ask({ title, body, confirmLabel: 'OK' }).then(() => undefined)
  }
  function answer(ok: boolean) {
    const req = current.value
    current.value = null
    req?.resolve(ok)
  }
  return { current, ask, notify, answer }
}
