// The day a payment was taken, when it is written down later than that.
//
// The desk sometimes records money after the fact -- a visit nobody charged
// for at the time, settled days later. The payment has to land on the day the
// money actually came in, or the day's takings, the cash shift and the income
// reports all put it on the wrong date.
//
// A payment recorded for today keeps the database's own now(): the exact
// moment is what the cash-shift and day-takings screens order by. One for an
// earlier day has no moment, only a date, so it is stamped at midday at the
// desk -- far enough from either midnight that a report reading it in UTC or
// Europe/Madrid still puts it on the same calendar day.

/** Today's date at the desk, as YYYY-MM-DD. */
export function todayPaymentDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Money cannot have come in on a day that has not happened yet. */
export function isFuturePaymentDate(date: string, today: string = todayPaymentDate()): boolean {
  return !!date && date > today
}

/**
 * The `paid_at` to insert for a payment taken on `date`, or undefined to let
 * the database stamp it now (today, or no date given).
 */
export function backdatedPaidAt(date: string, today: string = todayPaymentDate()): string | undefined {
  if (!date || date >= today) return undefined
  return new Date(`${date}T12:00:00`).toISOString()
}
