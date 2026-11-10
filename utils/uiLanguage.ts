// Which language the interface speaks to a visitor who has not chosen one,
// judged from their browser's language.
//
// Two views of the same thing, and they have to agree. The client asks
// navigator.languages (plugins/lang.client.ts); the server, rendering the
// page before any of that runs, only has the Accept-Language header the
// browser builds from that same list. If the two disagree, the page is
// rendered in one language and switches to the other as it hydrates -- which
// is what a Spanish-speaking patient opening a booking or portal link saw on
// every first visit, when the server simply assumed English.
//
// English and Spanish are written at every call site, as t('English',
// 'Español'); Portuguese (Portugal) and German come from the catalogs in
// i18n/, keyed by the English (utils/uiCatalog.ts).
export const UI_LANGUAGES = [
  { value: 'es', label: 'Español', short: 'ES', flag: 'ES', locale: 'es-ES' },
  { value: 'en', label: 'English', short: 'EN', flag: 'GB', locale: 'en-GB' },
  { value: 'pt', label: 'Português', short: 'PT', flag: 'PT', locale: 'pt-PT' },
  { value: 'de', label: 'Deutsch', short: 'DE', flag: 'DE', locale: 'de-DE' },
] as const

export type UiLanguage = (typeof UI_LANGUAGES)[number]['value']

export function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.some((l) => l.value === value)
}

// The BCP 47 tag dates and numbers are formatted with in this language.
export function uiLocaleTag(lang: UiLanguage): string {
  return UI_LANGUAGES.find((l) => l.value === lang)?.locale ?? 'en-GB'
}

// One letter per weekday, Monday first, for a week strip.
export function weekdayInitials(lang: UiLanguage): string {
  return { en: 'MTWTFSS', es: 'LMXJVSD', pt: 'STQQSSD', de: 'MDMDFSS' }[lang]
}

// The interface language for a browser or phone language tag: Spanish for
// es, es-ES, es-419..., Portuguese for any pt (Brazil's included -- pt-PT is
// what there is, and closer than English), German for any de; English for
// anything else.
export function languageOfTag(tag: string | null | undefined): UiLanguage {
  const primary = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return primary === 'es' || primary === 'pt' || primary === 'de' ? primary : 'en'
}

// The browser's first choice from an Accept-Language header -- the server's
// view of navigator.languages[0]. Browsers list it first with no q-value, but
// the header allows any order, so this takes the highest q and, among equals,
// the earliest. A tag with q=0 is one the browser refuses, and `*` names no
// language at all; neither counts. Nothing usable means English, which is
// also what languageOfTag says for an empty navigator.languages.
export function languageFromAcceptLanguage(header: string | null | undefined): UiLanguage {
  let best: { tag: string; q: number } | null = null
  for (const part of (header ?? '').split(',')) {
    const [rawTag, ...params] = part.trim().split(';')
    const tag = rawTag.trim()
    if (!tag || tag === '*') continue
    const qParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith('q='))
    const q = qParam ? Number(qParam.slice(2)) : 1
    if (!(q > 0)) continue
    if (!best || q > best.q) best = { tag, q }
  }
  return languageOfTag(best?.tag)
}
