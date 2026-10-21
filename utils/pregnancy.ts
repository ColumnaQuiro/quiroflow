// Where a pregnancy is, from its due date: weeks + days of gestation, the
// trimester, and how far along the 40 weeks it is. The due date is the one
// fact the clinic records (patients.pregnancy_due_date); everything else is
// counted from it, so it is never out of date.
//
// Dates are calendar days ("YYYY-MM-DD"), compared at UTC midnight so a
// clinic's time zone never moves a day.

const TERM_DAYS = 280

export interface PregnancyProgress {
  /** Completed weeks of gestation, 0..42+. */
  weeks: number
  /** Days past the completed weeks, 0..6. */
  days: number
  trimester: 1 | 2 | 3
  /** 0..1 along the 40 weeks, clamped. */
  fraction: number
  /** Days until the due date; negative once past it. */
  daysToDue: number
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!) / 86_400_000
}

export function pregnancyProgress(dueDate: string, today: string): PregnancyProgress {
  const daysToDue = dayNumber(dueDate) - dayNumber(today)
  const gestation = Math.max(0, TERM_DAYS - daysToDue)
  const weeks = Math.floor(gestation / 7)
  return {
    weeks,
    days: gestation % 7,
    // Weeks 0-13, 14-27, 28 onwards.
    trimester: weeks < 14 ? 1 : weeks < 28 ? 2 : 3,
    fraction: Math.min(1, gestation / TERM_DAYS),
    daysToDue,
  }
}

/** "24+3 wk" / "24+3 sem", the way it is written on a chart. */
export function pregnancyWeeksLabel(p: PregnancyProgress, t: (en: string, es: string) => string): string {
  return t(`${p.weeks}+${p.days} wk`, `${p.weeks}+${p.days} sem`)
}
