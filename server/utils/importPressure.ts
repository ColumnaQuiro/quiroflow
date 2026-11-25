import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { buildUsage, scrapeMetrics, type SupabaseUsage } from './supabaseUsage'

// The brake on server-side imports: how hard the database is working right
// now, read before every slice of an import job (server/utils/importJobs.ts).
//
// On 25 Nov 2026 an import of a 33,000-appointment clinic ran on the Micro
// database at full speed during clinic hours. The memory monitor
// (supabaseUsage.ts) emailed "low on memory" at 16:30 UTC; the import kept
// writing; every query in every clinic slowed to 5-16 s from 16:40, and from
// 16:52 to 17:00 the database accepted no connections at all until it was
// restarted. Disk was idle the whole time -- it was memory: 1 GB of RAM, swap
// full, 2.5 GB committed. An import is the one large load QuiroFlow puts on
// the database that can wait, so it is the one that waits.
//
// Two signals, because each misses something:
//
// - Memory and swap from the project's metrics endpoint: what ran out that
//   day, and it shows the trouble coming before anything slows down. It is
//   not there locally, nor if Supabase stops answering it.
// - How long one trivial query takes from here: what every clinic feels.
//   It was 5-16 s for ten minutes before the database stopped.
//
// Three answers:
//
// - 'ok': work at full speed.
// - 'busy': work this slice, but rest before the next (the job waits for
//   import-jobs-cron, a minute, instead of handing straight on).
// - 'strained': do no work; the job pauses and tries again later.

export type PressureLevel = 'ok' | 'busy' | 'strained'

export interface DbPressure {
  level: PressureLevel
  /** What tipped it, in words for a log line or an email. Empty when 'ok'. */
  reasons: string[]
  probe_ms: number | null
  /** Share of RAM the kernel can still hand out, 0-1. */
  available: number | null
  /** Share of swap in use, 0-1. */
  swap_used: number | null
}

// Memory. The ops alert (usageAlerts) fires at swap >= 95%, or >= 80% with
// under 20% of RAM available, as what comes before the kernel kills Postgres;
// 'strained' is that same line, so an import stops when that email goes out.
// Swap alone stays high for days after a peak with nothing wrong (23 Nov:
// 86% with a third of RAM free), so it never makes an import stop by itself
// below 95%. Idle, the Micro sits at ~70% swap and ~19% available (25 Nov,
// 18:15 UTC), which is 'busy': an import there rests between slices.
const STRAINED_SWAP = 0.95
const STRAINED_SWAP_WITH_LOW_RAM = 0.8
const STRAINED_AVAILABLE = 0.2
const BUSY_SWAP = 0.8
const BUSY_AVAILABLE = 0.25

// Latency. A primary-key read is a few milliseconds in Postgres and ~30-80 ms
// from a Netlify function in the same region; a second means queries are
// queueing.
const STRAINED_PROBE_MS = 2000
const BUSY_PROBE_MS = 600

const pct = (n: number) => `${Math.round(n * 100)}%`

/** The verdict for one reading. Pure, so the thresholds can be tested. */
export function judgePressure(memory: SupabaseUsage['memory'], probeMs: number | null): DbPressure {
  const strained: string[] = []
  const busy: string[] = []

  let available: number | null = null
  let swapUsed: number | null = null
  if (memory && memory.total_bytes > 0) {
    available = memory.available_bytes / memory.total_bytes
    swapUsed = memory.swap_total_bytes > 0 ? 1 - memory.swap_free_bytes / memory.swap_total_bytes : null
    if (swapUsed != null && swapUsed >= STRAINED_SWAP) strained.push(`swap ${pct(swapUsed)} used`)
    else if (swapUsed != null && swapUsed >= STRAINED_SWAP_WITH_LOW_RAM && available < STRAINED_AVAILABLE) strained.push(`swap ${pct(swapUsed)} used with ${pct(available)} of memory free`)
    else if ((swapUsed != null && swapUsed >= BUSY_SWAP) || available < BUSY_AVAILABLE) busy.push(`${pct(available)} of memory free${swapUsed != null ? `, swap ${pct(swapUsed)} used` : ''}`)
  }

  if (probeMs == null) strained.push('the database did not answer')
  else if (probeMs >= STRAINED_PROBE_MS) strained.push(`a one-row query took ${probeMs} ms`)
  else if (probeMs >= BUSY_PROBE_MS) busy.push(`a one-row query took ${probeMs} ms`)

  const level: PressureLevel = strained.length ? 'strained' : busy.length ? 'busy' : 'ok'
  return { level, reasons: strained.length ? strained : busy, probe_ms: probeMs, available, swap_used: swapUsed }
}

/** Times one primary-key read; null when it fails or takes longer than `timeoutMs`. */
async function probeDatabase(admin: SupabaseClient<Database>, jobId: string, timeoutMs: number): Promise<number | null> {
  const started = Date.now()
  try {
    const { error } = await admin.from('import_jobs').select('id').eq('id', jobId).abortSignal(AbortSignal.timeout(timeoutMs)).maybeSingle()
    if (error) return null
    return Date.now() - started
  } catch {
    return null
  }
}

/** Reads both signals at once. Never throws: a reading it cannot take counts against going on, not for it. */
export async function readDbPressure(admin: SupabaseClient<Database>, jobId: string): Promise<DbPressure> {
  const [probeMs, metrics] = await Promise.all([
    probeDatabase(admin, jobId, 8000),
    scrapeMetrics(4000),
  ])
  const memory = metrics ? buildUsage(metrics, null, null).memory : null
  return judgePressure(memory, probeMs)
}
