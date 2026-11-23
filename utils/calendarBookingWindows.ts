// The hours a clinic keeps for online booking, as the calendar shows them.
//
// An appointment type can be limited to set times online
// (appointment_types.online_booking_windows: "first visits only Tuesday and
// Thursday 18:00-19:30"). The booking page offers that type only inside those
// windows, but the calendar showed nothing of them, so the front desk could
// not tell at a glance which hours were being kept for which kind of visit --
// and filled them by hand with something else.
//
// The calendar tints each window in its type's colour. A window counts only
// where a practitioner on screen actually works, because that is the only
// part the booking page offers (bookingWindowsFor in bookingSlots.ts): a
// window set for 18:00-20:00 on a day the practitioner leaves at 19:00 is
// tinted to 19:00.
//
// Pure, with no `~` imports: the app auto-imports this directory too.
import { intersectWindows, typeWindowsOn, type OnlineBookingWindows } from './bookingSlots'
import { mergeWindows } from './businessHours'

/** What the calendar needs of an appointment type to tint its online windows. */
export interface BookingWindowType {
  id: string
  name: string
  color: string
  archived_at?: string | null
  online_booking_enabled?: boolean | null
  online_booking_windows?: OnlineBookingWindows | null
  /** Who may be booked for it; empty or missing means anyone. */
  practitioner_ids?: string[] | null
}

/**
 * A practitioner on screen and the hours they work that day: null when
 * nothing says when they are off (no hours of theirs or the clinic's), which
 * leaves the type's windows as they are.
 */
export interface PractitionerDay {
  id: string
  working: [string, string][] | null
}

/** One tinted stretch of a day: one window, and every type kept for it. */
export interface BookingWindowBand {
  from: string
  to: string
  /** The types sharing exactly this window, in the order they were given. */
  types: { id: string; name: string; color: string }[]
}

/**
 * The online-booking windows of one weekday ('mon'...'sun') for the
 * practitioners on screen: one practitioner on their own tab, everyone
 * assigned to the clinic on the whole-clinic tab.
 *
 * Only types switched on for online booking, not archived and limited to set
 * times are tinted: a type bookable whenever the practitioner is free has no
 * window to show. Two types kept for exactly the same window share one band
 * rather than stacking two labels on top of each other.
 */
export function onlineBookingBands(types: BookingWindowType[], dayKey: string, practitioners: PractitionerDay[]): BookingWindowBand[] {
  const bands: BookingWindowBand[] = []
  for (const type of types) {
    if (type.archived_at || !type.online_booking_enabled || !type.online_booking_windows) continue
    const allowed = type.practitioner_ids && type.practitioner_ids.length > 0 ? new Set(type.practitioner_ids) : null
    const windows: [string, string][] = []
    for (const p of practitioners) {
      if (allowed && !allowed.has(p.id)) continue
      const own = typeWindowsOn(type.online_booking_windows, dayKey, p.id) ?? []
      windows.push(...(p.working === null ? own : intersectWindows(own, p.working)))
    }
    for (const [from, to] of mergeWindows(windows)) {
      const entry = { id: type.id, name: type.name, color: type.color }
      const same = bands.find((b) => b.from === from && b.to === to)
      if (same) same.types.push(entry)
      else bands.push({ from, to, types: [entry] })
    }
  }
  return bands.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}
