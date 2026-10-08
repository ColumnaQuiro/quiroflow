// Applies the last-known language (localStorage) before the account
// store's DB round-trip resolves the real per-user preference -- same
// reasoning as theme.client.ts.
//
// With nothing stored, the browser's own language decides, the way
// mobile/plugins/lang.client.ts does for the app: Spanish when the browser is
// in Spanish, English otherwise. Before this a first visit was
// always English, which is what every patient opening the portal sign-in
// from a clinic's WhatsApp link was met with. Signed-in staff are unaffected:
// the account store applies their saved preference as soon as it loads.
//
// The server renders a first visit in the same language, from the
// Accept-Language header (utils/uiLanguage.ts keeps the two readings
// together), so the page does not switch language as it hydrates.
export default defineNuxtPlugin(() => {
  const { initFromStorage } = useLang()
  initFromStorage(languageOfTag(navigator.languages?.[0] ?? navigator.language))
})
