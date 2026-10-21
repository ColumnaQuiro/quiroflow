// The languages the public booking page (pages/book/[slug].vue) speaks, and
// which of them suits a visitor. Separate from utils/uiLanguage.ts, which is
// the staff app's English/Spanish: the booking page is read by patients, and
// French is there because the WhatsApp templates that follow a booking
// already come in it (#820), by patients.preferred_language -- which is what
// a booking made in one of these languages records.
//
// Spanish is the fallback everywhere: the clinics are in Spain, and a page
// that cannot tell is a Spanish page, as it always was.
export type BookingLanguage = 'es' | 'en' | 'fr'

export const BOOKING_LANGUAGES: readonly BookingLanguage[] = ['es', 'en', 'fr']

// Intl's locale for each. A bare "en" is British English rather than Intl's
// US default, as in utils/templateDate.ts: "Tue 21 Oct", 24-hour.
export const BOOKING_LOCALES: Record<BookingLanguage, string> = { es: 'es-ES', en: 'en-GB', fr: 'fr-FR' }

export function isBookingLanguage(value: unknown): value is BookingLanguage {
  return typeof value === 'string' && (BOOKING_LANGUAGES as readonly string[]).includes(value)
}

// "en-GB" -> 'en', "FR" -> 'fr', "de" -> null.
export function bookingLanguageOfTag(tag: string | null | undefined): BookingLanguage | null {
  const primary = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return isBookingLanguage(primary) ? primary : null
}

// The client's view: the first of navigator.languages the page speaks. A
// German browser that also lists English gets English, not Spanish.
export function bookingLanguageFromList(tags: readonly string[] | null | undefined): BookingLanguage {
  for (const tag of tags ?? []) {
    const lang = bookingLanguageOfTag(tag)
    if (lang) return lang
  }
  return 'es'
}

// The server's view of the same list, from Accept-Language: the spoken
// language with the highest q, the earliest among equals. Only the three
// count, because that is also how Netlify's cache picks which copy of the
// page to serve (`Netlify-Vary: language=es|en|fr`, set by the page) -- the
// highest-q language it lists -- and the two have to agree on which visitors
// share a copy. A tag with q=0 is one the browser refuses.
export function bookingLanguageFromAcceptLanguage(header: string | null | undefined): BookingLanguage {
  let best: { lang: BookingLanguage; q: number } | null = null
  for (const part of (header ?? '').split(',')) {
    const [rawTag, ...params] = part.trim().split(';')
    const lang = bookingLanguageOfTag(rawTag)
    if (!lang) continue
    const qParam = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith('q='))
    const q = qParam ? Number(qParam.slice(2)) : 1
    if (!(q > 0)) continue
    if (!best || q > best.q) best = { lang, q }
  }
  return best?.lang ?? 'es'
}
