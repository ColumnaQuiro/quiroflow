// The Patient Flow report's arithmetic (pages/reports/patient-flow.vue): how
// long people wait, how late the clinic runs, how long a session lasts, from
// the three timestamps the front desk stamps as a patient moves through the
// visit (checked_in_at, flow_with_practitioner_at, flow_checkout_at).
//
// Pure, so the rules are pinned by tests/unit/patient-flow-stats.test.ts.
//
// A stamp is a button someone presses, so some are forgotten and pressed
// hours later, or out of order. A stage outside 0..MAX_STAGE_MINUTES is
// taken as such a slip and left out of that stage (not the whole visit), so
// one forgotten "checkout" at closing time does not turn the clinic's
// average session into an hour.
export const MAX_STAGE_MINUTES = 180

export interface FlowVisit {
  starts_at: string
  practitioner_id: string | null
  checked_in_at: string | null
  flow_with_practitioner_at: string | null
  flow_checkout_at: string | null
}

export type FlowStage = 'wait' | 'delay' | 'session' | 'arrival'

/** Minutes for each stage of one visit; null where it cannot be told. */
export function visitStages(v: FlowVisit): Record<FlowStage, number | null> {
  const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null)
  const start = ms(v.starts_at)
  const arrived = ms(v.checked_in_at)
  const inRoom = ms(v.flow_with_practitioner_at)
  const out = ms(v.flow_checkout_at)
  const span = (a: number | null, b: number | null) => {
    if (a === null || b === null) return null
    const m = (b - a) / 60_000
    return m >= 0 && m <= MAX_STAGE_MINUTES ? m : null
  }
  // Delay: how long after the booked time they went in, never "negative
  // delay" -- seeing someone early is not the clinic running ahead.
  let delay: number | null = null
  if (start !== null && inRoom !== null) {
    const m = (inRoom - start) / 60_000
    if (m >= -MAX_STAGE_MINUTES && m <= MAX_STAGE_MINUTES) delay = Math.max(0, m)
  }
  // Arrival: minutes after the booked time they checked in (negative = early).
  let arrival: number | null = null
  if (start !== null && arrived !== null) {
    const m = (arrived - start) / 60_000
    if (Math.abs(m) <= MAX_STAGE_MINUTES) arrival = m
  }
  return { wait: span(arrived, inRoom), delay, session: span(inRoom, out), arrival }
}

export const FLOW_BUCKETS = [
  { key: '0-5', max: 5 },
  { key: '5-10', max: 10 },
  { key: '10-15', max: 15 },
  { key: '15-20', max: 20 },
  { key: '20+', max: Infinity },
] as const

export interface StageSummary {
  /** Visits this stage could be measured for. */
  count: number
  average: number | null
  median: number | null
  /** Share of `count` in each FLOW_BUCKETS bucket, 0..1. */
  buckets: number[]
}

export function summariseFlowStage(values: number[]): StageSummary {
  if (!values.length) return { count: 0, average: null, median: null, buckets: FLOW_BUCKETS.map(() => 0) }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const buckets = FLOW_BUCKETS.map(() => 0)
  for (const v of values) {
    const i = FLOW_BUCKETS.findIndex((b) => v < b.max)
    buckets[i === -1 ? FLOW_BUCKETS.length - 1 : i]++
  }
  return {
    count: values.length,
    average: values.reduce((s, v) => s + v, 0) / values.length,
    median,
    buckets: buckets.map((n) => n / values.length),
  }
}

export interface FlowReport {
  /** Visits that were checked in at all: the ones the flow was used for. */
  tracked: number
  stages: Record<FlowStage, StageSummary>
  /** Share of measured visits that went in within 5 minutes of the booked time. */
  onTime: number | null
  byPractitioner: { practitionerId: string | null; visits: number; wait: number | null; delay: number | null; session: number | null }[]
}

export function flowReport(visits: FlowVisit[]): FlowReport {
  const tracked = visits.filter((v) => v.checked_in_at)
  const per = tracked.map((v) => ({ v, s: visitStages(v) }))
  const values = (stage: FlowStage, rows = per) => rows.map((r) => r.s[stage]).filter((m): m is number => m !== null)
  const delays = values('delay')
  const groups = new Map<string | null, typeof per>()
  for (const r of per) groups.set(r.v.practitioner_id, [...(groups.get(r.v.practitioner_id) ?? []), r])
  return {
    tracked: tracked.length,
    stages: { wait: summariseFlowStage(values('wait')), delay: summariseFlowStage(delays), session: summariseFlowStage(values('session')), arrival: summariseFlowStage(values('arrival')) },
    onTime: delays.length ? delays.filter((d) => d <= 5).length / delays.length : null,
    byPractitioner: [...groups.entries()]
      .map(([practitionerId, rows]) => ({
        practitionerId,
        visits: rows.length,
        wait: summariseFlowStage(values('wait', rows)).average,
        delay: summariseFlowStage(values('delay', rows)).average,
        session: summariseFlowStage(values('session', rows)).average,
      }))
      .sort((a, b) => b.visits - a.visits),
  }
}

/** "4 min", "1 h 05 min", "–" -- minutes as the report shows them. */
export function formatFlowMinutes(m: number | null): string {
  if (m === null) return '–'
  const r = Math.round(m)
  if (Math.abs(r) < 60) return `${r} min`
  const sign = r < 0 ? '-' : ''
  const a = Math.abs(r)
  return `${sign}${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')} min`
}
