// When a PracticeHub website job (signed forms, invoice originals) has stopped
// being called and needs starting again.
//
// Each run of those jobs does a few seconds of work and then calls the next
// run itself, over HTTP, to the same site. Netlify cuts that short: a function
// calling its own site is treated as a loop after about nine hops, and the
// next call is dropped before it reaches the function -- no log line, no
// status, nothing. Measured on 26 Nov 2026: both chains of the first
// invoice-originals run stopped after exactly nine runs (~45 s), and it only
// moved again when a cron started a new one. Signed forms had been stopping
// the same way all along (193 patients took eleven minutes).
//
// A call from pg_cron is not part of anyone's loop, so a chain it starts gets
// its own nine hops. That is what practicehub-web-cron does, every minute:
// it finds a job that says running and has stopped, and starts it again.
// The self-calls stay: they are most of the throughput, and the cron is what
// carries a job across Netlify's limit.

/**
 * How long a running job may go without saving before it counts as stopped.
 * A live chain saves at the start and the end of every run and hands over in
 * about a second, so a quarter of a minute of silence with no lease held is a
 * chain that has ended, not one between runs.
 */
export const PRACTICEHUB_WEB_STALLED_AFTER_MS = 15_000

/** A job that says running, with no run holding it and nothing saved for a while. */
export function practiceHubWebJobStalled(job: { leaseUntil: number; updatedAt: string | null }, now: number): boolean {
  const updated = Date.parse(job.updatedAt ?? '')
  return job.leaseUntil < now && (Number.isNaN(updated) || now - updated > PRACTICEHUB_WEB_STALLED_AFTER_MS)
}
