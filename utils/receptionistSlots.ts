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
  /**
   * Where the window starts, when not now: the find_free_times tool looking
   * at a later week. The window is then bookingWindowDays from here, and the
   * minimum notice still counts from `now`.
   */
  from?: Date
  /** Overrides MAX_TIMES_PER_LIST. */
  maxTimesPerList?: number
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
  const start = q.from && q.from > q.now ? q.from : q.now
  const notice = new Date(q.now.getTime() + q.minimumNoticeMinutes * 60000)
  const notBefore = notice > start ? notice : start
  const notAfter = new Date(start.getTime() + q.bookingWindowDays * 86400000)
  const maxTimes = q.maxTimesPerList ?? MAX_TIMES_PER_LIST

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
    for (let date = clinicDateOf(start, timeZone), last = clinicDateOf(notAfter, timeZone); date <= last; date = nextDate(date)) dates.push(date)
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
        if (days.length > 0 && count + starts.size > maxTimes) {
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
 * The free times as lists, one per type (or types with identical times) and
 * clinic. Shared by the Booking section and the find_free_times tool, so the
 * model reads a tool answer exactly the way it reads the prompt.
 */
export function availabilityLists(availability: ReceptionistAvailability, emptyWindow: string): string[] {
  return availability.groups.map((group) => {
    const names = group.types.map((type) => `${type.name} (${type.durationMinutes} min)`).join(', ')
    const heading = `## ${names}${group.clinicName ? ` at ${group.clinicName}` : ''}`
    if (group.days.length === 0) return `${heading}\nNo free times ${emptyWindow}.`
    const days = group.days.map((day) => `- ${dayLabel(day.date)}: ${day.times.join(', ')}`).join('\n')
    const more = group.truncatedAfter ? `\n(This list stops at ${group.truncatedAfter}. Later days may have free times; they are just not shown.)` : ''
    return `${heading}\n${days}${more}`
  })
}

/**
 * The Booking section: the free times as a list to offer from when they could
 * be computed, and otherwise #691's "ask when suits, a colleague confirms" --
 * failing closed, since a model with no list can only invent.
 *
 * With `searchTool`, the model can also look further ahead than the list
 * (find_free_times), so a patient asking about December is answered from the
 * calendar rather than handed to a colleague. The list stays: most patients
 * want the next days, and answering them costs no extra round trip.
 */
export function receptionistBookingSection(opts: {
  availability: ReceptionistAvailability | null
  slotsPerReply: number
  bookingWindowDays: number
  searchTool?: boolean
  /** Set when the times are only this patient's own practitioner(s). */
  withWhom?: string[] | null
}): string {
  if (!opts.availability) {
    return `# Booking\nYou cannot see the clinic's calendar, so never propose a specific day or time and never say a time is free. Ask which days and whether mornings or afternoons suit them (within the next ${opts.bookingWindowDays} days), then say your colleague will confirm an exact time shortly.`
  }

  const lists = availabilityLists(opts.availability, `in the next ${opts.bookingWindowDays} days`)
  const n = opts.slotsPerReply
  const multiClinic = opts.availability.groups.some((group) => group.clinicName)
  return [
    `# Booking\nThese are the free start times in the clinic's calendar for the next ${opts.bookingWindowDays} days, in the clinic's local time. A day missing from a list has nothing free for those appointments, unless the list says it stops before that day.`,
    // A returning patient is seen by their own practitioner, so the list is
    // theirs alone, and "con Natacha" is part of the answer.
    opts.withWhom?.length
      ? `These times are only with ${opts.withWhom.join(' or ')}, who sees this patient${opts.searchTool ? ', and so is everything find_free_times returns' : ''}. Say who the time is with. If they ask to see someone else, say your colleague will arrange it.`
      : '',
    ...lists,
    [
      `Offer times ONLY from this list${opts.searchTool ? ' or from what find_free_times returns' : ''}, at exactly the listed times, and at most ${n} time${n === 1 ? '' : 's'} per reply. Never offer a day, time or type that is not listed, never shift a listed time, and never say a time is free unless it is listed.`,
      `Choose times that fit what the patient has said about when suits them; if they have not said, offer the earliest ones, on different days where possible.`,
      multiClinic ? `Times are per clinic: offer the clinic the patient wants, and ask which one if it is not clear.` : '',
      opts.searchTool
        ? `If they ask about a date after this list, or the list stops before the day they want, call find_free_times for those dates before answering -- never say a later day is free or full without it. If nothing found suits them, ask which days and whether mornings or afternoons suit them, and say your colleague will confirm an exact time shortly.`
        : `If nothing listed suits them, or they want a day that is not listed, do not invent one: ask which days and whether mornings or afternoons suit them, and say your colleague will confirm an exact time shortly.`,
    ]
      .filter(Boolean)
      .join(' '),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** At most this many days per find_free_times call: a month reads in one answer. */
export const FREE_TIMES_MAX_DAYS = 31
/** And no further ahead than this. A clinic's diary a year out is mostly guesswork. */
export const FREE_TIMES_HORIZON_DAYS = 365
/** Fewer than the prompt's list: a tool answer is read once, for one question. */
export const FREE_TIMES_MAX_TIMES = 120

export interface FreeTimesQuery {
  /** First clinic date to look at, YYYY-MM-DD, never before today. */
  from: string
  days: number
  /** Narrows to one of the person's types by name; null for all of them. */
  typeName: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function dayNumber(date: string): number | null {
  if (!ISO_DATE.test(date)) return null
  const ms = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  // Rejects 2026-02-31, which Date.UTC would quietly roll into March.
  return new Date(ms).toISOString().slice(0, 10) === date ? ms / 86400000 : null
}

function dateOfDay(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10)
}

/**
 * What the model asked find_free_times for, checked. Returns an error the
 * model can act on rather than throwing: a bad date is the model's to fix,
 * and it reads the tool result.
 */
export function parseFreeTimesInput(input: unknown, today: string): FreeTimesQuery | { error: string } {
  const value = (input ?? {}) as { from_date?: unknown; to_date?: unknown; appointment_type?: unknown }
  const todayN = dayNumber(today)!
  const fromN = typeof value.from_date === 'string' ? dayNumber(value.from_date) : null
  if (fromN === null) return { error: 'from_date must be a date as YYYY-MM-DD.' }
  const toN = value.to_date === undefined || value.to_date === null || value.to_date === '' ? fromN : typeof value.to_date === 'string' ? dayNumber(value.to_date) : null
  if (toN === null) return { error: 'to_date must be a date as YYYY-MM-DD, or left out.' }
  if (toN < fromN) return { error: 'to_date is before from_date.' }
  if (toN < todayN) return { error: `Those dates are in the past; today is ${today}.` }
  const start = Math.max(fromN, todayN)
  if (start > todayN + FREE_TIMES_HORIZON_DAYS) return { error: `You can only look up to ${FREE_TIMES_HORIZON_DAYS} days ahead. Say your colleague will arrange a date that far out.` }
  const end = Math.min(toN, start + FREE_TIMES_MAX_DAYS - 1, todayN + FREE_TIMES_HORIZON_DAYS)
  const typeName = typeof value.appointment_type === 'string' && value.appointment_type.trim() ? value.appointment_type.trim() : null
  return { from: dateOfDay(start), days: end - start + 1, typeName }
}
