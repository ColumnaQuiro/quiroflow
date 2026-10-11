// The free times the AI receptionist may offer, and the prompt that lists them.
//
// The Booking section used to say "you may offer up to N times within the
// next X days" while nothing gave the model the calendar or even today's
// date, so every time it offered was invented and a colleague had to take it
// back (#691 stopped it offering any). This computes the real ones, with the
// same per-day function the booking page and the patient app use
// (bookingSlotsForDay), from rows the server has already read.
//
// Pure, with no `~` imports: the app auto-imports this directory too, and in
// its build `~` resolves to mobile/.
import { bookingSlotsForDay, bookingWindowsFor, clinicTimeLabel, type BookingBusyRange } from './bookingSlots'
import type { BusinessHours } from './businessHours'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, nextDate } from './clinicClock'
import type { PromptType } from './receptionistTypes'

export interface SlotClinic {
  id: string
  name: string
  timeZone: string | null
  businessHours: BusinessHours | null
}

export interface SlotPractitioner {
  id: string
  businessHours: BusinessHours | null
  /** The clinics they work at (team_member_clinics). */
  clinicIds: string[]
}

export interface SlotType extends PromptType {
  id: string
  /** appointment_type_overrides.duration_minutes, by practitioner. */
  durationByPractitioner?: Record<string, number>
}

export interface SlotAppointment extends BookingBusyRange {
  practitionerId: string | null
}

export interface SlotBlock extends BookingBusyRange {
  clinicId: string
  practitionerId: string | null
}

export interface SlotDay {
  /** The clinic's calendar date, YYYY-MM-DD. */
  date: string
  /** "09:30", on the clinic's clock. */
  times: string[]
}

/** One list in the prompt: the free times of one or more types at one clinic. */
export interface SlotGroup {
  /** Set only when the account has more than one clinic with times. */
  clinicName: string | null
  types: PromptType[]
  /** Days with at least one free time; a day with none is left out. */
  days: SlotDay[]
  /** The last day listed, when the list was cut short; later days are not shown. */
  truncatedAfter: string | null
}

export interface ReceptionistAvailability {
  groups: SlotGroup[]
}

/**
 * How many times one list may hold. Each reply pays for every token of the
 * prompt (about three a time), and a 90-day window can produce over a
 * thousand starts; the earliest days are the ones a patient is choosing
 * between. 240 covers the default 14-day window for one practitioner seeing
 * 30-minute visits 08:00-19:00 on weekdays, which is 220. Whole days are
 * dropped, never part of one, so a listed day is always complete and an
 * absent afternoon really is taken.
 */
export const MAX_TIMES_PER_LIST = 240

export interface ReceptionistSlotQuery {
  now: Date
  clinics: SlotClinic[]
  practitioners: SlotPractitioner[]
  types: SlotType[]
  appointments: SlotAppointment[]
  blocks: SlotBlock[]
  bookingWindowDays: number
  minimumNoticeMinutes: number
}

/**
 * The free starts for each offered type, per clinic.
 *
 * Practitioners and blocks are read the way the public API's availability
 * does: a practitioner's appointments and own blocks keep them away at every
 * clinic, a block naming nobody closes only its own clinic, and a
 * practitioner's duration override for a type is the length of their slots.
 * Times are merged across practitioners -- the patient is choosing a time,
 * and the colleague who confirms it chooses who.
 *
 * Returns null when there is nothing to compute from: no clinic, nobody who
 * can be booked, or no working hours anywhere in the window. That is a setup
 * gap, not a full calendar, and the prompt must not tell a patient "nothing
 * is free" when the truth is "unknown".
 */
export function receptionistSlotGroups(q: ReceptionistSlotQuery): ReceptionistAvailability | null {
  if (q.types.length === 0) return null
  const notBefore = new Date(q.now.getTime() + q.minimumNoticeMinutes * 60000)
  const notAfter = new Date(q.now.getTime() + q.bookingWindowDays * 86400000)

  const perClinic: { clinic: SlotClinic; lists: { types: PromptType[]; days: SlotDay[]; truncatedAfter: string | null }[] }[] = []
  for (const clinic of q.clinics) {
    const timeZone = clinic.timeZone || DEFAULT_CLINIC_TIMEZONE
    const staff = q.practitioners.filter((p) => p.clinicIds.includes(clinic.id))
    if (staff.length === 0) continue
    const busyFor = (practitionerId: string): BookingBusyRange[] => [
      ...q.appointments.filter((a) => a.practitionerId === practitionerId),
      ...q.blocks.filter((b) => b.practitionerId === practitionerId || (b.practitionerId === null && b.clinicId === clinic.id)),
    ]
    const busy = new Map(staff.map((p) => [p.id, busyFor(p.id)]))

    const dates: string[] = []
    for (let date = clinicDateOf(q.now, timeZone), last = clinicDateOf(notAfter, timeZone); date <= last; date = nextDate(date)) dates.push(date)
    // Nobody works on any day of the window: hours not set up, not booked solid.
    const anyHours = dates.some((date) => staff.some((p) => bookingWindowsFor(date, clinic.businessHours, p.businessHours).length > 0))
    if (!anyHours) continue

    const lists = q.types.map((type) => {
      const days: SlotDay[] = []
      let count = 0
      let truncatedAfter: string | null = null
      for (const date of dates) {
        const starts = new Set<number>()
        for (const p of staff) {
          const slots = bookingSlotsForDay({
            date,
            timeZone,
            clinicHours: clinic.businessHours,
            practitionerHours: p.businessHours,
            durationMinutes: type.durationByPractitioner?.[p.id] ?? type.durationMinutes,
            busy: busy.get(p.id) ?? [],
            notBefore,
            notAfter,
          })
          for (const at of slots) starts.add(at.getTime())
        }
        if (starts.size === 0) continue
        if (days.length > 0 && count + starts.size > MAX_TIMES_PER_LIST) {
          truncatedAfter = days[days.length - 1]!.date
          break
        }
        count += starts.size
        days.push({ date, times: [...starts].sort((a, b) => a - b).map((at) => clinicTimeLabel(new Date(at), timeZone)) })
      }
      return { types: [{ name: type.name, durationMinutes: type.durationMinutes }], days, truncatedAfter }
    })

    // Types whose lists come out identical (the same length, say) are listed
    // once under all their names: the same times twice is tokens for nothing.
    const merged: typeof lists = []
    for (const list of lists) {
      const twin = merged.find((m) => m.truncatedAfter === list.truncatedAfter && JSON.stringify(m.days) === JSON.stringify(list.days))
      if (twin) twin.types.push(...list.types)
      else merged.push(list)
    }
    perClinic.push({ clinic, lists: merged })
  }

  if (perClinic.length === 0) return null
  const named = perClinic.length > 1
  return {
    groups: perClinic.flatMap(({ clinic, lists }) => lists.map((list) => ({ clinicName: named ? clinic.name : null, ...list }))),
  }
}

/** "Monday 2026-10-12" -- the date's own weekday, whatever zone this runs in. */
function dayLabel(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
  return `${weekday} ${date}`
}

/**
 * The current date and time at the clinic. Without it the model has no idea
 * what "tomorrow" or "el jueves" means, and dates it writes are guesses.
 */
export function receptionistClockSection(now: Date, timeZone: string | null | undefined): string {
  const zone = timeZone || DEFAULT_CLINIC_TIMEZONE
  const date = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zone })
  return `# Now\nIt is ${date}, ${clinicTimeLabel(now, zone)} at the clinic (${zone}). Read "today", "tomorrow" and any weekday the patient mentions against this.`
}

/**
 * The Booking section: the free times as a list to offer from when they could
 * be computed, and otherwise #691's "ask when suits, a colleague confirms" --
 * failing closed, since a model with no list can only invent.
 */
export function receptionistBookingSection(opts: {
  availability: ReceptionistAvailability | null
  slotsPerReply: number
  bookingWindowDays: number
}): string {
  if (!opts.availability) {
    return `# Booking\nYou cannot see the clinic's calendar, so never propose a specific day or time and never say a time is free. Ask which days and whether mornings or afternoons suit them (within the next ${opts.bookingWindowDays} days), then say your colleague will confirm an exact time shortly.`
  }

  const lists = opts.availability.groups.map((group) => {
    const names = group.types.map((type) => `${type.name} (${type.durationMinutes} min)`).join(', ')
    const heading = `## ${names}${group.clinicName ? ` at ${group.clinicName}` : ''}`
    if (group.days.length === 0) return `${heading}\nNo free times in the next ${opts.bookingWindowDays} days.`
    const days = group.days.map((day) => `- ${dayLabel(day.date)}: ${day.times.join(', ')}`).join('\n')
    const more = group.truncatedAfter ? `\n(This list stops at ${group.truncatedAfter}. Later days may have free times; they are just not shown.)` : ''
    return `${heading}\n${days}${more}`
  })

  const n = opts.slotsPerReply
  const multiClinic = opts.availability.groups.some((group) => group.clinicName)
  return [
    `# Booking\nThese are the free start times in the clinic's calendar for the next ${opts.bookingWindowDays} days, in the clinic's local time. A day missing from a list has nothing free for those appointments, unless the list says it stops before that day.`,
    ...lists,
    [
      `Offer times ONLY from this list, at exactly the listed times, and at most ${n} time${n === 1 ? '' : 's'} per reply. Never offer a day, time or type that is not listed, never shift a listed time, and never say a time is free unless it is listed.`,
      `Choose times that fit what the patient has said about when suits them; if they have not said, offer the earliest ones, on different days where possible.`,
      multiClinic ? `Times are per clinic: offer the clinic the patient wants, and ask which one if it is not clear.` : '',
      `If nothing listed suits them, or they want a day that is not listed, do not invent one: ask which days and whether mornings or afternoons suit them, and say your colleague will confirm an exact time shortly.`,
    ]
      .filter(Boolean)
      .join(' '),
  ].join('\n\n')
}
