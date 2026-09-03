// Applies the last-known language (localStorage) before the account
// store's DB round-trip resolves the real per-user preference -- same
// reasoning as theme.client.ts.
export default defineNuxtPlugin(() => {
  const { initFromStorage } = useLang()
  initFromStorage()
})
