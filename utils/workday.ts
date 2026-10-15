// Registro de jornada: what a day of clock entries adds up to. One reading,
// shared by My Day's clock card, "My month", the owners' team page and the
// export (server/api/time-records/export.get.ts), so the hours a person sees
// are the hours that are signed.
//
// Entries are time_entries rows that are still in force (superseded_by is
// null), one person, one work_date. A day is a run of
//   in -> [break_start -> break_end]* -> out
// possibly more than once (a split shift clocks out at lunch and in again).
// Worked time is everything between an entrada or a vuelta and the next pausa
// or salida; a pausa left open at the salida ends there.

export type WorkEntryKind = 'in' | 'break_start' | 'break_end' | 'out'
export interface WorkEntry {
  id: string
  kind: string
  at: string
  work_date: string
}
export type WorkState = 'off' | 'working' | 'on_break'

/** A day left open this long is not still going: it is missing its salida. */
export const WORKDAY_STALE_HOURS = 16

export interface WorkdaySummary {
  date: string
  entries: WorkEntry[]
  firstIn: string | null
  lastOut: string | null
  breaks: { start: string; end: string | null }[]
  workedMinutes: number
  /** Where the person is now, for a day that is still going. */
  state: WorkState
  /** The last entry is not a salida. */
  open: boolean
  /** Open, and left that way for longer than WORKDAY_STALE_HOURS. */
  missingOut: boolean
}

export function workdaySummary(date: string, dayEntries: WorkEntry[], now: Date = new Date()): WorkdaySummary {
  const entries = [...dayEntries].sort((a, b) => a.at.localeCompare(b.at))
  let worked = 0
  let since: number | null = null
  let state: WorkState = 'off'
  const breaks: { start: string; end: string | null }[] = []
  for (const e of entries) {
    const t = Date.parse(e.at)
    if (e.kind === 'in' || e.kind === 'break_end') {
      if (e.kind === 'break_end' && breaks.length && breaks[breaks.length - 1]!.end === null) breaks[breaks.length - 1]!.end = e.at
      since = t
      state = 'working'
    } else if (e.kind === 'break_start' || e.kind === 'out') {
      if (since !== null) worked += t - since
      since = null
      if (e.kind === 'break_start') {
        breaks.push({ start: e.at, end: null })
        state = 'on_break'
      } else {
        if (breaks.length && breaks[breaks.length - 1]!.end === null) breaks[breaks.length - 1]!.end = e.at
        state = 'off'
      }
    }
  }
  const last = entries[entries.length - 1]
  const open = !!last && last.kind !== 'out'
  const missingOut = open && now.getTime() - Date.parse(last!.at) > WORKDAY_STALE_HOURS * 3600_000
  // Still going: the time since the last entrada counts up to now.
  if (since !== null && !missingOut) worked += Math.max(0, now.getTime() - since)
  const ins = entries.filter((e) => e.kind === 'in')
  const outs = entries.filter((e) => e.kind === 'out')
  return {
    date,
    entries,
    firstIn: ins[0]?.at ?? null,
    lastOut: open ? null : (outs[outs.length - 1]?.at ?? null),
    breaks,
    workedMinutes: Math.floor(worked / 60_000),
    state: missingOut ? 'off' : state,
    open,
    missingOut,
  }
}

/** Every day in `entries`, newest first. */
export function workdaysOf(entries: WorkEntry[], now: Date = new Date()): WorkdaySummary[] {
  const byDate = new Map<string, WorkEntry[]>()
  for (const e of entries) byDate.set(e.work_date, [...(byDate.get(e.work_date) ?? []), e])
  return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, es]) => workdaySummary(d, es, now))
}

/** "7 h 05" -- hours and minutes, the way a timesheet writes them. */
export function formatWorked(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h} h ${String(m).padStart(2, '0')}`
}

/** The Monday of the week `date` (YYYY-MM-DD) falls in. */
export function workdayWeekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y!, m! - 1, d!))
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}

/** First and last day of a month given as YYYY-MM. */
export function workdayMonthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
  return { first: `${month}-01`, last }
}

export function workEntryLabel(kind: string, t: (en: string, es: string) => string): string {
  if (kind === 'in') return t('In', 'Entrada')
  if (kind === 'break_start') return t('Break', 'Pausa')
  if (kind === 'break_end') return t('Back', 'Vuelta')
  return t('Out', 'Salida')
}

/** "08:52" in the clinic's time zone. */
export function workdayClock(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at))
}
