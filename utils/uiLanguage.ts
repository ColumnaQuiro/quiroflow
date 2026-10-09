// Which of the two languages the interface speaks (English or Spanish) suits
// a visitor who has not chosen one, judged from their browser's language.
//
// Two views of the same thing, and they have to agree. The client asks
// navigator.languages (plugins/lang.client.ts); the server, rendering the
// page before any of that runs, only has the Accept-Language header the
// browser builds from that same list. If the two disagree, the page is
// rendered in one language and switches to the other as it hydrates -- which
// is what a Spanish-speaking patient opening a booking or portal link saw on
// every first visit, when the server simply assumed English.
export type UiLanguage = 'en' | 'es'

// Spanish for any Spanish tag (es, es-ES, es-419, ...); English otherwise.
export function languageOfTag(tag: string | null | undefined): UiLanguage {
  return (tag ?? '').trim().toLowerCase().startsWith('es') ? 'es' : 'en'
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
