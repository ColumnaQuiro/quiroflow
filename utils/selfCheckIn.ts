// When a patient may check themselves in ("Ya estoy aquí"): from 90 minutes
// before their visit until it ends, while it is still booked. The same window
// check_in_my_appointment enforces; this only decides whether to show the
// button, so the database stays the rule.
export const SELF_CHECK_IN_EARLY_MINUTES = 90

export function canSelfCheckIn(a: { starts_at: string; ends_at: string; status: string; checked_in_at?: string | null }, now: Date): boolean {
  if (a.status !== 'booked' || a.checked_in_at) return false
  const t = now.getTime()
  return t >= Date.parse(a.starts_at) - SELF_CHECK_IN_EARLY_MINUTES * 60_000 && t <= Date.parse(a.ends_at)
}
