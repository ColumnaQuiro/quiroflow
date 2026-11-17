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
 * Each sits at its own time as far as the hour's spare room allows: with
 * room to spare a 09:30 visit is at the half-hour line, as on the linear
 * grid; in a full hour the rows close up. Row i of n in an hour of height H
 * goes i rows down plus its fraction of the hour times the room left over
 * (H - n rows), so rows never overlap and the last one still ends inside
 * its hour.
 *
 * `starts` must be sorted. While a drag holds the scale still, a visit can
 * be dragged into an hour that is already full; the room left over is then
 * taken as nothing and that hour's rows run on past its end until the drop.
 */
export function gridStackRows(starts: number[], tops: HourTops, rowPx: number): number[] {
  const hours = tops.length - 1
  const inHour = gridRowsPerHour(starts, hours)
  const seen = new Array<number>(hours).fill(0)
  return starts.map((m) => {
    const h = gridHourOf(m, hours)
    const spare = Math.max(0, tops[h + 1] - tops[h] - inHour[h] * rowPx)
    const fraction = Math.min(Math.max((m - h * 60) / 60, 0), 1)
    return tops[h] + seen[h]++ * rowPx + fraction * spare
  })
}
