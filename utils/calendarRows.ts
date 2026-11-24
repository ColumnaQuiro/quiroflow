// The calendar grid's vertical scale, and the "rows" way of drawing visits
// that share a time.
//
// The grid has always been linear: every hour the same height, so a visit's
// top and height are its start and length times one number. Overlapping
// visits then split the column's width into lanes (pages/calendar.vue,
// assignOverlapLayout). A clinic with an open treatment room -- one room,
// several tables, ten visits at 09:00 -- gets ten lanes there, and past six
// the names are slivers and the rest a "+N".
//
// Rows mode stacks them instead: one under the other at full width, a row
// each, and an hour grows as tall as the most rows any column needs in it.
// So the scale is no longer one number but where each hour starts, and
// everything that turned a time into a position (the hour lines, the
// now-line, a click on a free slot, a drag) reads it through gridYAt and
// gridMinuteAt. A linear scale is the special case, and gives exactly the
// positions the grid had before.

/** Where each hour of the grid starts, in px from its top, plus one more
 *  entry for where the last hour ends (the grid's height). */
export type HourTops = number[]

/** The hour the grid ends at: 20:00, or later when anyone closes later or a
 *  visit on screen ends later. A fixed 20:00 hid everything after it -- a
 *  clinic open until 20:30 could not see its last half hour, nor the visits
 *  booked in it. The app's calendar (mobile/pages/calendar) stretches the
 *  same way. `closingTimes` are "HH:MM"; `visitEndMinutes` count from
 *  midnight of the day the visit starts on, so one ending after midnight is
 *  past 1440 and stops the grid at 24:00. */
export function gridEndHour(closingTimes: string[], visitEndMinutes: number[], fallbackHour = 20): number {
  let end = fallbackHour * 60
  for (const t of closingTimes) {
    const [h, m] = t.split(':').map(Number)
    if (Number.isFinite(h)) end = Math.max(end, h * 60 + (Number.isFinite(m) ? m : 0))
  }
  for (const m of visitEndMinutes) end = Math.max(end, m)
  return Math.min(24, Math.ceil(end / 60))
}

/** The hours the grid spans when it shows only the opening hours ("Solo
 *  horario de apertura"): from the first hour anyone on screen starts to the
 *  last hour anyone ends, over the days on screen, widened to take in every
 *  visit drawn there -- a visit booked before opening must never fall off the
 *  top. The default grid runs 08:00 to closing whatever the hours are, so a
 *  clinic that opens at 16:00 on Tuesdays faces eight grey hours before its
 *  first patient.
 *
 *  `windows` are the working windows ("HH:MM" pairs) of the days on screen;
 *  `visits` are [start, end] minutes from midnight of the day each starts on.
 *  Null when there is nothing to fit to (nobody works those days and nothing
 *  is booked), so the caller keeps its usual range rather than a zero-hour
 *  grid. */
export function gridOpenHourRange(windows: [string, string][], visits: [number, number][]): { start: number; end: number } | null {
  let from = Infinity
  let to = -Infinity
  const minutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : NaN
  }
  for (const [a, b] of windows) {
    const s = minutes(a)
    const e = minutes(b)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue
    from = Math.min(from, s)
    to = Math.max(to, e)
  }
  for (const [s, e] of visits) {
    from = Math.min(from, s)
    to = Math.max(to, Math.max(e, s))
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  const start = Math.max(0, Math.floor(from / 60))
  const end = Math.min(24, Math.max(start + 1, Math.ceil(to / 60)))
  return { start, end }
}

export function gridLinearTops(hours: number, hourPx: number): HourTops {
  return Array.from({ length: hours + 1 }, (_, i) => i * hourPx)
}

/** Every hour at least hourPx tall, and tall enough for rowsPerHour[h] rows. */
export function gridStretchedTops(hourPx: number, rowsPerHour: number[], rowPx: number): HourTops {
  const tops = [0]
  for (const rows of rowsPerHour) tops.push(tops[tops.length - 1] + Math.max(hourPx, rows * rowPx))
  return tops
}

/** The y of a minute counted from the grid's first hour. Outside the grid it
 *  carries on at the first or last hour's height, so a visit starting before
 *  opening keeps its length rather than collapsing to the edge. */
export function gridYAt(tops: HourTops, minute: number): number {
  const h = gridHourOf(minute, tops.length - 1)
  return tops[h] + ((minute - h * 60) / 60) * (tops[h + 1] - tops[h])
}

/** The inverse of gridYAt: which minute (fractional) a y falls on. */
export function gridMinuteAt(tops: HourTops, y: number): number {
  const hours = tops.length - 1
  let h = 0
  while (h < hours - 1 && y >= tops[h + 1]) h++
  return h * 60 + ((y - tops[h]) / (tops[h + 1] - tops[h])) * 60
}

/** Which hour of the grid a minute is drawn in; before and after the grid
 *  count as its first and last hours. */
export function gridHourOf(minute: number, hours: number): number {
  return Math.min(Math.max(Math.floor(minute / 60), 0), hours - 1)
}

/** How many visits start in each hour, from their start minutes. */
export function gridRowsPerHour(startMinutes: number[], hours: number): number[] {
  const rows = new Array<number>(hours).fill(0)
  for (const m of startMinutes) rows[gridHourOf(m, hours)]++
  return rows
}

/**
 * The top of one row per visit, in start order, inside the hour it starts in.
 *
 * Each sits at its own time -- a 19:30 visit on the 19:30 line, where the
 * time column labels it -- and moves only as far as it must: down, when it
 * would overlap the row above it; up, when the rows below it would
 * otherwise run past the end of the hour. So in an hour with room to spare
 * every row is exactly where the linear grid would draw it, and in a full
 * hour the rows close up, still in start order and inside their hour.
 *
 * (It used to place row i of n at i rows plus its fraction of the hour's
 * room left over, which put a lone 09:30 visit at 09:22 and two visits at
 * 19:00 and 19:30 at 19:00 and ~19:22: never on the line the time column
 * printed beside them.)
 *
 * `starts` must be sorted. While a drag holds the scale still, a visit can
 * be dragged into an hour that is already full; its rows are then packed
 * from the top of the hour and run on past its end until the drop.
 */
export function gridStackRows(starts: number[], tops: HourTops, rowPx: number): number[] {
  const hours = tops.length - 1
  const out = new Array<number>(starts.length)
  // Sorted starts put each hour's visits next to each other.
  for (let i = 0; i < starts.length;) {
    const h = gridHourOf(starts[i], hours)
    let j = i
    while (j < starts.length && gridHourOf(starts[j], hours) === h) j++
    const top = tops[h]
    const end = tops[h + 1]
    if ((j - i) * rowPx > end - top) {
      for (let k = i; k < j; k++) out[k] = top + (k - i) * rowPx
    } else {
      // Down the hour: at its own time, or just below the row above.
      for (let k = i; k < j; k++) {
        const fraction = Math.min(Math.max((starts[k] - h * 60) / 60, 0), 1)
        const own = top + fraction * (end - top)
        out[k] = k === i ? own : Math.max(own, out[k - 1] + rowPx)
      }
      // Back up it: the last row ends inside the hour, each above clears it.
      let limit = end - rowPx
      for (let k = j - 1; k >= i; k--) {
        out[k] = Math.min(out[k], limit)
        limit = out[k] - rowPx
      }
    }
    i = j
  }
  return out
}
