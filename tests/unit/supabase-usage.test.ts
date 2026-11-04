import { describe, it, expect } from 'vitest'
import { buildUsage, parsePrometheus, usageAlerts, PRO_STORAGE_BYTES } from '../../server/utils/supabaseUsage'

// The shape of the project's real /customer/v1/privileged/metrics output,
// trimmed to the series the check reads.
const L = 'supabase_project_ref="ref",service_type="db"'
const scrape = (idle: number, iowait: number, user: number, extra = '') => `
# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.
node_cpu_seconds_total{${L},cpu="0",mode="idle"} ${idle}
node_cpu_seconds_total{${L},cpu="0",mode="iowait"} ${iowait}
node_cpu_seconds_total{${L},cpu="0",mode="user"} ${user}
node_cpu_seconds_total{${L},cpu="1",mode="idle"} ${idle}
node_cpu_seconds_total{${L},cpu="1",mode="iowait"} ${iowait}
node_cpu_seconds_total{${L},cpu="1",mode="user"} ${user}
node_load15{${L}} 0.1
node_memory_MemTotal_bytes{${L}} 9.48195328e+08
node_memory_MemAvailable_bytes{${L}} 4.08092672e+08
node_memory_SwapTotal_bytes{${L}} 1.073737728e+09
node_memory_SwapFree_bytes{${L}} 6.26782208e+08
node_filesystem_size_bytes{${L},device="/dev/nvme0n1p2",fstype="ext4",mountpoint="/"} 1.0359754752e+10
node_filesystem_avail_bytes{${L},device="/dev/nvme0n1p2",fstype="ext4",mountpoint="/"} 2.244685824e+09
node_filesystem_size_bytes{${L},device="/dev/nvme1n1",fstype="ext4",mountpoint="/data"} 2.077073408e+09
node_filesystem_avail_bytes{${L},device="/dev/nvme1n1",fstype="ext4",mountpoint="/data"} 1.580945408e+09
pg_stat_database_num_backends{supabase_project_ref="ref",service_type="postgresql",server="localhost:5432"} 31
${extra}`

const sql = {
  database_bytes: 182_701_203,
  connections: 18,
  max_connections: 60,
  buckets: [
    { bucket: 'patient-files', objects: 2744, bytes: 7_718_000_000 },
    { bucket: 'help-videos', objects: 293, bytes: 96_000_000 },
  ],
}

describe('Supabase usage', () => {
  it('reads the database volume, not the system disk', () => {
    const u = buildUsage(parsePrometheus(scrape(1000, 10, 100)), sql, null)
    expect(u.disk).to.deep.equal({ size_bytes: 2_077_073_408, avail_bytes: 1_580_945_408 })
    expect(u.cpu?.cores).to.equal(2)
    expect(u.storage?.bytes).to.equal(7_814_000_000)
    expect(u.connections).to.deep.equal({ used: 18, max: 60 })
  })

  it('needs two samples for CPU, then reports the window between them', () => {
    const t0 = new Date('2026-11-04T10:00:00Z')
    const first = buildUsage(parsePrometheus(scrape(1000, 10, 100)), sql, null, t0)
    expect(first.cpu?.busy_pct).to.equal(null)

    // 15 minutes on two cores: 1800 CPU-seconds, of which 360 idle.
    const second = buildUsage(parsePrometheus(scrape(1180, 100, 730)), sql, first, new Date('2026-11-04T10:15:00Z'))
    expect(second.cpu?.busy_pct).to.equal(80)
    expect(second.cpu?.iowait_pct).to.equal(10)
    expect(second.cpu?.window_minutes).to.equal(15)
    expect(usageAlerts(second).map((a) => a.name)).to.include('supabase-cpu')
  })

  it('starts over after a restart instead of reporting nonsense', () => {
    const before = buildUsage(parsePrometheus(scrape(1_000_000, 10, 100)), sql, null)
    const after = buildUsage(parsePrometheus(scrape(500, 1, 50)), sql, before)
    expect(after.cpu?.busy_pct).to.equal(null)
  })

  it('stays quiet at today\'s numbers', () => {
    const u = buildUsage(parsePrometheus(scrape(1000, 10, 100)), sql, null)
    expect(usageAlerts(u)).to.deep.equal([])
  })

  it('alerts on storage, disk, swap and connections near their limits', () => {
    const u = buildUsage(parsePrometheus(scrape(1000, 10, 100)), { ...sql, connections: 50, buckets: [{ bucket: 'patient-files', objects: 1, bytes: 0.85 * PRO_STORAGE_BYTES }] }, null)
    u.disk = { size_bytes: 100, avail_bytes: 15 }
    u.memory!.swap_free_bytes = 0.1 * u.memory!.swap_total_bytes
    expect(usageAlerts(u).map((a) => a.name).sort()).to.deep.equal(['supabase-connections', 'supabase-disk', 'supabase-memory', 'supabase-storage'])
  })

  it('records what it can when the metrics endpoint is unreachable', () => {
    const u = buildUsage(null, sql, null)
    expect(u.cpu).to.equal(null)
    expect(u.disk).to.equal(null)
    expect(u.storage?.buckets[0].bucket).to.equal('patient-files')
  })
})
