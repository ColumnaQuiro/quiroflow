// The week strip under a home exercise: the last seven days ending today,
// each marked done or not from the patient's log. Pure, so it is tested and
// shared by the staff card and the patient's own screen.

/** yyyy-mm-dd of a Date in the device's own calendar (not UTC). Not named localDay:
 * utils/clinicClock has one, and auto-imports would let this replace it. */
export function deviceDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export interface WeekDay {
  date: string
  /** Monday-first initial, Spanish: L M X J V S D. */
  initial: string
  done: boolean
  isToday: boolean
}

const INITIALS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

export function exerciseWeek(doneDays: string[], today: Date = new Date()): WeekDay[] {
  const done = new Set(doneDays)
  const todayKey = deviceDay(today)
  const days: WeekDay[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = deviceDay(d)
    days.push({ date: key, initial: INITIALS[d.getDay()]!, done: done.has(key), isToday: key === todayKey })
  }
  return days
}
