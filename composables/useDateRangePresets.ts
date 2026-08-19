export interface DateRangePreset {
  label: string
  months?: number
  days?: number
  lastMonth?: boolean
}

export interface DateRange {
  from: string // ISO date, yyyy-mm-dd
  to: string
}

// Local date components, not toISOString() -- that converts to UTC first,
// which silently rolls midnight-local dates back a day in any UTC+
// timezone (e.g. "Last month" landing on the 30th instead of the 1st).
function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// months presets align to the 1st of the month so "Last 3 months" reads as
// 3 whole calendar months ending today, not a rolling 90-day window; days
// presets are a plain rolling window. Shared between DateRangeSelect (to
// compute what a preset click produces) and each report page (to seed its
// initial range without duplicating this math).
export function computePresetRange(preset: DateRangePreset): DateRange {
  if (preset.lastMonth) {
    const to = new Date()
    to.setDate(0) // day 0 of this month = last day of the previous month
    const from = new Date(to.getFullYear(), to.getMonth(), 1)
    return { from: toISODate(from), to: toISODate(to) }
  }
  const to = new Date()
  const from = new Date()
  if (preset.months) {
    from.setMonth(from.getMonth() - (preset.months - 1))
    from.setDate(1)
  } else if (preset.days) {
    from.setDate(from.getDate() - preset.days)
  }
  return { from: toISODate(from), to: toISODate(to) }
}

// The same four options on every report's date picker, so switching reports
// doesn't mean re-learning a different preset list each time.
export const STANDARD_PRESETS: DateRangePreset[] = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'This month', months: 1 },
  { label: 'Last month', lastMonth: true },
]

// Query-ready bounds for a DateRange: start of the "from" day through the
// end of the "to" day, in the browser's local time.
export function rangeBounds(range: DateRange): { from: Date; to: Date } {
  const from = new Date(`${range.from}T00:00:00`)
  const to = new Date(`${range.to}T23:59:59.999`)
  return { from, to }
}

// Every "YYYY-MM" month key from range.from's month through range.to's
// month, inclusive -- for bucketing a chart over an arbitrary custom range
// rather than a fixed "last N months ending today".
export function monthKeysInRange(range: DateRange): string[] {
  const { from, to } = rangeBounds(range)
  const keys: string[] = []
  const c = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(), to.getMonth(), 1)
  while (c <= end) {
    keys.push(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`)
    c.setMonth(c.getMonth() + 1)
  }
  return keys
}
