import { BOOKING_LOCALES, type BookingLanguage } from '~/utils/bookingLanguage'

// The public booking page's language, shared with the components it renders
// (BookingSummary, booking/Payment). Not useLang()/useT(): those are the staff
// member's English/Spanish preference, and this page is the patient's, in
// three languages.
//
// Every string is written out in all three at its own call site, the way
// useT() keeps English and Spanish together:
//
//   say({ es: 'Reservar cita', en: 'Book appointment', fr: 'Prendre rendez-vous' })
//
// useState, so the language the server rendered in reaches the client in the
// payload and hydration agrees with the HTML. pages/book/[slug].vue decides it.
export function useBookingLang() {
  const lang = useState<BookingLanguage>('booking-lang', () => 'es')
  const locale = computed(() => BOOKING_LOCALES[lang.value])
  function say(text: Record<BookingLanguage, string>) {
    return text[lang.value]
  }
  return { lang, locale, say }
}
