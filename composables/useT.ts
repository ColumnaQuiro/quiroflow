import { uiCatalogTranslate } from '../utils/uiCatalog'

// QuiroFlow has no central i18n catalog/message-key system -- t(en, es) is
// called inline at each string's own call site with both variants right
// there, colocated with the component that renders it, and looked up
// against the current per-staff-member language preference (Settings >
// Appearance). This keeps every string's translation next to its English
// original instead of a giant shared locale file no one keeps in sync,
// and avoids hundreds of files fighting over the same catalog file.
//
// Portuguese and German are the exception: they come from i18n/pt.json and
// i18n/de.json, keyed by the English argument (utils/uiCatalog.ts), and show
// the English for anything not translated yet. `npm run check:i18n` lists
// what is missing.
export function useT() {
  const { preference } = useLang()
  return (en: string, es: string) => {
    const lang = preference.value
    if (lang === 'es') return es
    if (lang === 'en') return en
    return uiCatalogTranslate(lang, en)
  }
}
