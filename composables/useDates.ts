import {
  dateBlock as dateBlockIn,
  formatLongDate as formatLongDateIn,
  formatLongWeekdayDate as formatLongWeekdayDateIn,
  formatShortDate as formatShortDateIn,
  formatWeekdayDate as formatWeekdayDateIn,
} from '~/utils/billing'

// The date helpers from utils/billing.ts, in the staff member's language.
// They live there, language-free, because server code formats dates too, and
// there is no staff member on the server to ask. A component takes them from
// here instead:
//
//   const { formatLongDate, formatShortDate } = useDates()
//
// Call it in setup, like useT(): the language is read on every call, so a
// switch in Settings > Appearance re-renders every date with it.
export function useDates() {
  const { preference } = useLang()
  return {
    formatLongDate: (iso: string | Date) => formatLongDateIn(iso, preference.value),
    formatShortDate: (iso: string | Date) => formatShortDateIn(iso, preference.value),
    formatWeekdayDate: (iso: string | Date) => formatWeekdayDateIn(iso, preference.value),
    formatLongWeekdayDate: (iso: string | Date) => formatLongWeekdayDateIn(iso, preference.value),
    dateBlock: (iso: string | Date) => dateBlockIn(iso, preference.value),
  }
}
