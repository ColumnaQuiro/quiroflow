import { dayKeyFor, hasBusinessHoursConfigured, practitionerWindowsForDay, windowsForDay, type BusinessHours } from './businessHours'

// The calendar's Month view (components/calendar/MonthOccupancy.vue): for
// each day, how much of the practitioners' working time is booked and how
// much is still free -- the month's gaps and its general occupancy, where the
// week view only showed seven days at a time.
//
// Working time is each practitioner's own hours for that weekday, or the
// clinic's for someone who never set any (practitionerWindowsForDay, the
// calendar's own rule), less the blocks that keep them away: their own, and
// any for the whole clinic. A room's block closes a room, not a person, so it
// takes nothing off. Booked time is their visits, overlapping ones counted
// once.
//
// A visit outside those hours is still time they worked, so it adds to the
// working time as well as to the booked: a day can be full but never over
// 100 %, and never 0 % with visits on it. The hours are a weekly template
// with no history. A practitioner whose Thursdays moved from mornings to
// afternoons had every morning Thursday before the change come out as 0 %
// and "5 h libres" beside four visits, and a Thursday whose afternoon they had
// blocked as "Cerrado".
//
// When nobody has configured any hours there is no working time to measure
// against: the day still counts its visits and booked hours, without a
// percentage, the same opt-in rule the calendar's hatching follows.
//
// Minutes are on the browser's clock, as the calendar grid's are.

export interface OccupancyPractitioner {
  id: string
  business_hours: BusinessHours | null
}
export interface OccupancyRange {
  practitioner_id: string | null
  room_id?: string | null
  starts_at: string
  ends_at: string
}
export interface DayOccupancy {
  /** Local midnight of the day. */
  day: Date
  /** Working minutes, or null when no hours are configured to measure against. */
  capacityMin: number | null
  bookedMin: number
  freeMin: number | null
  /** 0..1, or null without a capacity. */
  share: number | null
  visits: number
}

type Span = [number, number]

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}
const total = (spans: Span[]) => spans.reduce((s, [a, b]) => s + (b - a), 0)

function merge(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const [a, b] of [...spans].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}
function subtract(spans: Span[], cut: Span[]): Span[] {
  let out = merge(spans)
  for (const [ca, cb] of merge(cut)) {
    out = out.flatMap(([a, b]): Span[] => (cb <= a || ca >= b ? [[a, b]] : ([[a, Math.min(b, ca)], [Math.max(a, cb), b]] as Span[]).filter(([x, y]) => y > x)))
  }
  return out
}

/** A timestamp range as minutes into `day` (local), clipped to that day; null when it misses it. */
function spanOn(day: Date, r: { starts_at: string; ends_at: string }): Span | null {
  const start = day.getTime()
  const next = new Date(day)
  next.setDate(next.getDate() + 1)
  const dayLen = (next.getTime() - start) / 60000
  const a = Math.max(0, (new Date(r.starts_at).getTime() - start) / 60000)
  const b = Math.min(dayLen, (new Date(r.ends_at).getTime() - start) / 60000)
  return b > a ? [a, b] : null
}

export function monthOccupancy(input: {
  days: Date[]
  practitioners: OccupancyPractitioner[]
  clinicHours: BusinessHours | null | undefined
  appointments: OccupancyRange[]
  blocks: OccupancyRange[]
}): DayOccupancy[] {
  const clinicConfigured = hasBusinessHoursConfigured(input.clinicHours)
  const ids = new Set(input.practitioners.map((p) => p.id))
  return input.days.map((day) => {
    let capacity: number | null = 0
    let booked = 0
    const clinicWide = input.blocks.filter((b) => !b.practitioner_id && !b.room_id).map((b) => spanOn(day, b)).filter((s): s is Span => !!s)
    for (const p of input.practitioners) {
      const visits = input.appointments.filter((a) => a.practitioner_id === p.id).map((a) => spanOn(day, a)).filter((s): s is Span => !!s)
      if (!clinicConfigured && !hasBusinessHoursConfigured(p.business_hours)) {
        // Nothing says when they work: their visits still count as booked.
        capacity = null
        booked += total(merge(visits))
        continue
      }
      const windows = practitionerWindowsForDay(windowsForDay(day, input.clinicHours), p.business_hours, dayKeyFor(day)).map(([s, e]) => [toMin(s), toMin(e)] as Span)
      const away = input.blocks.filter((b) => b.practitioner_id === p.id).map((b) => spanOn(day, b)).filter((s): s is Span => !!s)
      const working = merge([...subtract(windows, [...clinicWide, ...away]), ...visits])
      if (capacity !== null) capacity += total(working)
      booked += total(merge(visits))
    }
    const visits = input.appointments.filter((a) => a.practitioner_id && ids.has(a.practitioner_id) && spanOn(day, a)).length
    const bookedMin = Math.round(booked)
    const capacityMin = capacity === null ? null : Math.round(capacity)
    return {
      day,
      capacityMin,
      bookedMin,
      freeMin: capacityMin === null ? null : Math.max(0, capacityMin - bookedMin),
      share: capacityMin ? Math.min(1, bookedMin / capacityMin) : null,
      visits,
    }
  })
}

/** "3 h 30" / "45 min" / "0 h". */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (!h) return `${m} min`
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}
