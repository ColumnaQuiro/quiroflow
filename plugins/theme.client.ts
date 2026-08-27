// Applies the last-known theme (localStorage) before the first paint's
// worth of layout settles, and before the account store's DB round-trip
// resolves the real per-user preference -- otherwise every load would
// flash light before possibly switching to dark.
export default defineNuxtPlugin(() => {
  const { initFromStorage } = useTheme()
  initFromStorage()
})
