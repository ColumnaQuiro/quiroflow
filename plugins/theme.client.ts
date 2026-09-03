// Applies the last-known theme (localStorage) before the first paint's
// worth of layout settles, and before the account store's DB round-trip
// resolves the real per-user preference -- otherwise every load would
// flash light before possibly switching to dark.
//
// Dark/light/system is a per-staff-member appearance preference (Settings >
// Appearance) -- it has no business following whatever theme a patient's
// own phone happens to be in when they open a link we sent them (a form to
// fill out, here). Those pages have no staff session and no preference of
// their own, so "system" would just mean "match this random visitor's OS
// setting", which reads as a broken/unstyled page, not a feature.
const PUBLIC_LIGHT_ONLY_PREFIXES = ['/doc/']

export default defineNuxtPlugin(() => {
  const route = useRoute()
  if (PUBLIC_LIGHT_ONLY_PREFIXES.some((prefix) => route.path.startsWith(prefix))) {
    document.documentElement.setAttribute('data-theme', 'light')
    return
  }
  const { initFromStorage } = useTheme()
  initFromStorage()
})
