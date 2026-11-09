// The server renders in whatever language the request turns out to want --
// which, for signed-in staff, is only known once the account store has
// loaded their saved preference, after the plugins have run. So both catalogs
// (utils/uiCatalog.ts) are loaded up front. Each is imported once per server
// process and is already in memory for every request after the first.
export default defineNuxtPlugin(async () => {
  await Promise.all(CATALOG_LANGUAGES.map((lang) => loadUiCatalog(lang)))
})
