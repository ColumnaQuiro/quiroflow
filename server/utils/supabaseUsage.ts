import { serviceSupabase, serverSecretKey } from './serviceSupabase'
import { alertOps, readPlatformStatus, writePlatformStatus } from './opsAlert'

// What the Supabase project has left, sampled every 15 minutes by
// /api/platform/supabase-usage-cron, recorded in platform_status as
// 'supabase.usage' for the admin panel, and emailed through alertOps when
// something is close to its limit.
//
// Two sources:
//
// - The project's Prometheus endpoint (/customer/v1/privileged/metrics, basic
//   auth with the secret key): CPU, memory, swap and the database disk. These
//   are the limits of the compute size (Micro), not of the plan, and the ones
//   that grow with every clinic onboarded.
// - platform_supabase_usage() (20261104173154_supabase_usage.sql): storage per
//   bucket and client connections, which only SQL can count.
//
// Egress is in neither. Supabase reports it only on the organisation's usage
// page, and its own quota emails go to the organisation's billing address.
//
// CPU comes as counters of seconds since boot, so a single sample says
// nothing about now. Each run keeps the counters it read, and the next one
// reports the share of time busy in between -- one window of ~15 minutes.

/** Pro plan allowances; beyond them Supabase bills per GB, or restricts the project when the spend cap is on. */
export const PRO_STORAGE_BYTES = 100 * 1024 ** 3
export const PRO_DATABASE_BYTES = 8 * 1024 ** 3

const ALERT_AT = 0.8

export interface SupabaseUsage {
  sampled_at: string
  cpu: {
    busy_pct: number | null
    iowait_pct: number | null
    window_minutes: number | null
    cores: number
    load15: number | null
    counters: { total: number; idle: number; iowait: number }
  } | null
  memory: { total_bytes: number; available_bytes: number; swap_total_bytes: number; swap_free_bytes: number } | null
  disk: { size_bytes: number; avail_bytes: number } | null
  database_bytes: number | null
  connections: { used: number; max: number } | null
  storage: { bytes: number; objects: number; buckets: { bucket: string; objects: number; bytes: number }[] } | null
}

interface Sample {
  name: string
  labels: Record<string, string>
  value: number
}

/** The Prometheus text format, as much of it as these metrics use. */
export function parsePrometheus(text: string): Sample[] {
  const out: Sample[] = []
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const m = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)/.exec(line)
    if (!m) continue
    const labels: Record<string, string> = {}
    for (const l of (m[2] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2]
    const value = Number(m[3])
    if (Number.isFinite(value)) out.push({ name: m[1], labels, value })
  }
  return out
}

interface SqlUsage {
  database_bytes: number
  connections: number
  max_connections: number
  buckets: { bucket: string; objects: number; bytes: number }[]
}

/** One snapshot from a metrics scrape and the SQL totals, either of which may be missing. */
export function buildUsage(metrics: Sample[] | null, sql: SqlUsage | null, previous: SupabaseUsage | null, now = new Date()): SupabaseUsage {
  const db = (metrics ?? []).filter((s) => s.labels.service_type === 'db')
  const one = (name: string, labels: Record<string, string> = {}) =>
    db.find((s) => s.name === name && Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? null

  let cpu: SupabaseUsage['cpu'] = null
  const cpuSamples = db.filter((s) => s.name === 'node_cpu_seconds_total')
  if (cpuSamples.length) {
    const sum = (mode?: string) => cpuSamples.filter((s) => !mode || s.labels.mode === mode).reduce((t, s) => t + s.value, 0)
    const counters = { total: sum(), idle: sum('idle'), iowait: sum('iowait') }
    const prev = previous?.cpu?.counters
    const dTotal = prev ? counters.total - prev.total : 0
    // A drop means the instance restarted (a compute resize does that): the
    // counters began again, and this run only sets the baseline.
    const usable = prev && dTotal > 0 && counters.idle >= prev.idle
    cpu = {
      busy_pct: usable ? round(100 * (1 - (counters.idle - prev.idle) / dTotal)) : null,
      iowait_pct: usable ? round((100 * (counters.iowait - prev.iowait)) / dTotal) : null,
      window_minutes: usable && previous ? Math.round((now.getTime() - new Date(previous.sampled_at).getTime()) / 60_000) : null,
      cores: new Set(cpuSamples.map((s) => s.labels.cpu)).size,
      load15: one('node_load15'),
      counters,
    }
  }

  const memTotal = one('node_memory_MemTotal_bytes')
  const memAvail = one('node_memory_MemAvailable_bytes')
  const memory = memTotal != null && memAvail != null
    ? { total_bytes: memTotal, available_bytes: memAvail, swap_total_bytes: one('node_memory_SwapTotal_bytes') ?? 0, swap_free_bytes: one('node_memory_SwapFree_bytes') ?? 0 }
    : null

  // /data is the database volume; / is the instance's own system disk, which
  // Supabase manages and we cannot resize.
  const diskSize = one('node_filesystem_size_bytes', { mountpoint: '/data' })
  const diskAvail = one('node_filesystem_avail_bytes', { mountpoint: '/data' })
  const disk = diskSize != null && diskAvail != null ? { size_bytes: diskSize, avail_bytes: diskAvail } : null

  const buckets = (sql?.buckets ?? []).map((b) => ({ bucket: b.bucket, objects: Number(b.objects), bytes: Number(b.bytes) }))

  return {
    sampled_at: now.toISOString(),
    cpu,
    memory,
    disk,
    database_bytes: sql ? Number(sql.database_bytes) : null,
    connections: sql ? { used: Number(sql.connections), max: Number(sql.max_connections) } : null,
    storage: sql
      ? { bytes: buckets.reduce((t, b) => t + b.bytes, 0), objects: buckets.reduce((t, b) => t + b.objects, 0), buckets }
      : null,
  }
}

export interface UsageAlert {
  name: string
  subject: string
  lines: string[]
  everyHours: number
}

const COMPUTE = 'Upgrading the compute size (Dashboard &rarr; Project Settings &rarr; Compute and Disk) restarts the database for a few minutes, so do it outside clinic hours.'

/** What in a snapshot is worth an email, if anything. */
export function usageAlerts(u: SupabaseUsage): UsageAlert[] {
  const alerts: UsageAlert[] = []

  if (u.disk && u.disk.size_bytes > 0) {
    const used = 1 - u.disk.avail_bytes / u.disk.size_bytes
    if (used >= ALERT_AT) {
      alerts.push({
        name: 'supabase-disk',
        subject: `Supabase database disk is ${pct(used)} full`,
        lines: [
          `${gb(u.disk.size_bytes - u.disk.avail_bytes)} of ${gb(u.disk.size_bytes)} used on the database disk.`,
          'Supabase grows the disk on its own at 90%, but at most once every six hours. At 95% it puts the database in read-only mode: no appointment, payment or note can be saved in any clinic until it has grown.',
          'If it is filling fast, grow it now under Dashboard &rarr; Project Settings &rarr; Compute and Disk.',
        ],
        everyHours: 6,
      })
    }
  }

  if (u.database_bytes != null && u.database_bytes >= ALERT_AT * PRO_DATABASE_BYTES) {
    alerts.push({
      name: 'supabase-database-size',
      subject: `Supabase database is ${gb(u.database_bytes)} of the 8 GB the plan includes`,
      lines: [
        'Past 8 GB each extra GB is billed; with the spend cap on, the disk cannot grow past it at all and the database goes read-only when it fills.',
        'Check the spend cap under Organization &rarr; Billing before this runs out.',
      ],
      everyHours: 24,
    })
  }

  if (u.storage && u.storage.bytes >= ALERT_AT * PRO_STORAGE_BYTES) {
    const top = u.storage.buckets.slice(0, 3).map((b) => `${b.bucket} ${gb(b.bytes)}`).join(', ')
    alerts.push({
      name: 'supabase-storage',
      subject: `Supabase file storage is ${gb(u.storage.bytes)} of the 100 GB the plan includes`,
      lines: [
        `Largest buckets: ${top}.`,
        'Past 100 GB each extra GB is billed; with the spend cap on, Supabase can restrict the project instead, and uploads of patient files stop.',
        'Check the spend cap under Organization &rarr; Billing before this runs out.',
      ],
      everyHours: 24,
    })
  }

  if (u.cpu?.busy_pct != null && u.cpu.busy_pct >= ALERT_AT * 100) {
    alerts.push({
      name: 'supabase-cpu',
      subject: `Supabase database CPU at ${Math.round(u.cpu.busy_pct)}%`,
      lines: [
        `The database's ${u.cpu.cores} CPU cores were busy ${Math.round(u.cpu.busy_pct)}% of the last ${u.cpu.window_minutes ?? '?'} minutes${u.cpu.iowait_pct ? ` (${Math.round(u.cpu.iowait_pct)}% waiting on disk)` : ''}.`,
        'Nothing fails at 100%, but every page and every API call in every clinic waits its turn. If this repeats, the compute size is too small for the number of clinics.',
        COMPUTE,
      ],
      everyHours: 6,
    })
  }

  if (u.memory && u.memory.swap_total_bytes > 0) {
    const swapUsed = 1 - u.memory.swap_free_bytes / u.memory.swap_total_bytes
    if (swapUsed >= ALERT_AT) {
      alerts.push({
        name: 'supabase-memory',
        subject: `Supabase database is out of memory (swap ${pct(swapUsed)} used)`,
        lines: [
          `${gb(u.memory.available_bytes)} of ${gb(u.memory.total_bytes)} memory available, and ${pct(swapUsed)} of ${gb(u.memory.swap_total_bytes)} swap in use.`,
          'Once swap fills, Postgres is killed and restarted, which drops every connection in every clinic.',
          COMPUTE,
        ],
        everyHours: 6,
      })
    }
  }

  if (u.connections && u.connections.max > 0 && u.connections.used >= ALERT_AT * u.connections.max) {
    alerts.push({
      name: 'supabase-connections',
      subject: `Supabase connections at ${u.connections.used} of ${u.connections.max}`,
      lines: [
        'At the limit, new connections are refused and requests fail outright rather than waiting.',
        'The limit is set by the compute size. ' + COMPUTE,
      ],
      everyHours: 6,
    })
  }

  return alerts
}

/** Samples, records and alerts. Best-effort: a source that cannot be read leaves its part null. */
export async function recordSupabaseUsage(): Promise<{ usage: SupabaseUsage; alerts: string[] } | null> {
  const service = serviceSupabase()
  if (!service) return null

  const [metrics, sql, previous] = await Promise.all([
    scrapeMetrics(),
    service.rpc('platform_supabase_usage').then(({ data, error }) => {
      if (error) console.error('[supabase-usage] platform_supabase_usage failed', error.message)
      return (data as SqlUsage | null) ?? null
    }),
    readPlatformStatus<SupabaseUsage>('supabase.usage'),
  ])

  const usage = buildUsage(metrics, sql, previous)
  await writePlatformStatus('supabase.usage', usage as any)

  const alerts = usageAlerts(usage)
  for (const a of alerts) await alertOps(a.name, a.subject, a.lines, a.everyHours)
  return { usage, alerts: alerts.map((a) => a.name) }
}

async function scrapeMetrics(): Promise<Sample[] | null> {
  try {
    const url = `${useRuntimeConfig().public.supabase.url}/customer/v1/privileged/metrics`
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${serverSecretKey()}`).toString('base64')}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error(`[supabase-usage] metrics endpoint answered ${res.status}`)
      return null
    }
    return parsePrometheus(await res.text())
  } catch (e: any) {
    // Local Supabase has no such endpoint; production should always answer.
    console.error('[supabase-usage] could not read metrics', e?.message ?? e)
    return null
  }
}

function round(n: number) {
  return Math.round(n * 10) / 10
}

function pct(fraction: number) {
  return `${Math.round(fraction * 100)}%`
}

function gb(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}
