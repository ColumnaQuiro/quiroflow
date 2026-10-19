// The date and time a WhatsApp template's {{n}} slots carry, written in the
// language of the template variant being sent. They were always Spanish, so
// an English variant read "booked for 9 de octubre de 2026 at 17:30".
//
// Meta names languages its own way (es, en, en_US, fr, pt_BR); Intl wants a
// hyphen. A bare "en" is British English rather than Intl's US default: the
// clinics are in Spain, and "9 October 2026, 17:30" is what an English
// speaker there expects. Anything Intl does not recognise falls back to
// Spanish, as every send did before.
function localeFor(language: string): string {
  const tag = language.replace('_', '-')
  if (tag === 'en') return 'en-GB'
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0 ? tag : 'es-ES'
  } catch {
    return 'es-ES'
  }
}

export function templateDateParts(startsAt: string, language: string, timeZone: string): { date: string; time: string } {
  const start = new Date(startsAt)
  const locale = localeFor(language)
  return {
    date: start.toLocaleString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone }),
    // 24-hour everywhere, as the Spanish templates have always read
    // ("a las {{3}}h"); en-US would otherwise say "05:30 PM".
    time: start.toLocaleString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }),
  }
}
