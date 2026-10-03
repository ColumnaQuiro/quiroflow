// "Fri 16 Oct" / "vie 16 oct" -- a day as the staff app writes it, read in
// the clinic's time zone. Assembled from parts because toLocaleDateString
// puts a comma after the weekday in English ("Fri, 16 Oct"), which reads
// badly inside a sentence like "Book Fri 16 Oct, 17:30".
export function shortDayLabel(at: Date, locale: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.weekday} ${parts.day} ${parts.month}`.replace(/\./g, '')
}
