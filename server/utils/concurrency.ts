// Runs `fn` over `items` with at most `limit` calls in flight at once --
// used by the cron endpoints (appointment reminders, same-day info,
// birthdays) so a tick with many rows across many accounts finishes in a
// bounded number of round-trips instead of one at a time, while still
// staying well under Resend's shared 10 req/sec team-wide rate limit (each
// concurrent slot can trigger both a WhatsApp and an email send, so this
// stays conservative rather than pushing toward that ceiling).
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
