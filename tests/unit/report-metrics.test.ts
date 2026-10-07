import { describe, expect, it } from 'vitest'
import { pageTemplates, reportLibrary, savedReportConfig } from '../../utils/reportBlocks'
import { comparisonRange, computeMetric, formatDelta, formatMetric, METRIC_BY_KEY, type Appt, type ReportData } from '../../utils/reportMetrics'

const t = (en: string) => en
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime()
function appt(over: Partial<Appt>): Appt {
  return { id: Math.random().toString(36), patient_id: 'p1', at: at(2026, 6, 10), status: 'completed', appointment_type_id: null, practitioner_id: 'a', clinic_id: 'c', source: 'staff', confirmation_status: null, stage: null, ...over }
}
function data(appts: Appt[]): ReportData {
  return {
    appts,
    money: () => ({ payments: [], invoices: [], appointmentById: new Map(), patientById: new Map(), paidByInvoice: new Map(), lines: [], purchaseById: new Map() }),
    patients: [],
    bonos: { purchases: [], invoicesById: new Map(), schedulesByPurchase: new Map(), payments: [] },
    memberships: [],
    whatsapp: () => [],
    leads: () => ({ leads: [], spend: [], defaultValueCents: null }),
    recalls: [],
    carePlans: [],
    names: { member: new Map([['a', 'Ana'], ['b', 'Bea']]), clinic: new Map(), type: new Map(), service: new Map(), package: new Map(), method: (k) => k },
  }
}
const june = { from: new Date(2026, 5, 1), to: new Date(2026, 5, 30, 23, 59, 59, 999), now: new Date(2026, 5, 30), t }

describe('report metrics', () => {
  it('compares whole months with the same months before, and other periods with the days just before', () => {
    const r = comparisonRange(new Date(2026, 5, 1), new Date(2026, 5, 17, 23, 59), 'previous_period')!
    expect([r.from.getMonth(), r.from.getDate(), r.to.getMonth(), r.to.getDate()]).toEqual([4, 1, 4, 17])
    const q = comparisonRange(new Date(2026, 3, 1), new Date(2026, 5, 30), 'previous_period')!
    expect([q.from.getMonth(), q.to.getMonth()]).toEqual([0, 2])
    const y = comparisonRange(new Date(2026, 5, 1), new Date(2026, 5, 30), 'previous_year')!
    expect(y.from.getFullYear()).toBe(2025)
    expect(comparisonRange(new Date(2026, 5, 1), new Date(2026, 5, 30), 'none')).toBeNull()
  })

  it('words a change in a rate as points, and says nothing against zero', () => {
    expect(formatDelta(60, 50, 'pct')).toEqual({ text: '+10 pts', up: true })
    expect(formatDelta(90, 100, 'count')).toEqual({ text: '−10%', up: false })
    expect(formatDelta(5, 0, 'count')).toBeNull()
    expect(formatMetric(null, 'eur')).toBe('—')
    expect(formatMetric(8.64, 'decimal')).toBe('8,6')
  })

  it('computes a show rate per shift, and a practitioner rate as if the page were filtered to them', () => {
    const d = data([
      appt({ status: 'completed', at: at(2026, 6, 3, 9) }),
      appt({ status: 'no_show', at: at(2026, 6, 4, 9) }),
      appt({ status: 'completed', at: at(2026, 6, 5, 17) }),
      appt({ status: 'cancelled', at: at(2026, 6, 6, 17) }),
      // deleted ones never reach the engine; outside the period does not count
      appt({ status: 'no_show', at: at(2026, 5, 20, 9) }),
    ])
    const byShift = computeMetric(METRIC_BY_KEY.get('show_rate')!, 'shift', d, june)
    expect(byShift.value).toBe(67)
    expect(byShift.rows.map((r) => [r.key, r.value])).toEqual([['morning', 50], ['afternoon', null], ['evening', 100]])

    const pva = data([
      appt({ patient_id: 'p1', stage: 'first_visit', practitioner_id: 'a' }),
      appt({ patient_id: 'p1', stage: 'adjustment', practitioner_id: 'a' }),
      appt({ patient_id: 'p1', stage: 'adjustment', practitioner_id: 'a' }),
      appt({ patient_id: 'p2', stage: 'first_visit', practitioner_id: 'b' }),
    ])
    const r = computeMetric(METRIC_BY_KEY.get('pva')!, 'practitioner', pva, june)
    expect(r.value).toBe(2)
    expect(Object.fromEntries(r.rows.map((x) => [x.label, x.value]))).toEqual({ Ana: 3, Bea: 1 })
  })

  it('counts a new patient once however many first visits they had', () => {
    const d = data([appt({ patient_id: 'p1', stage: 'first_visit' }), appt({ patient_id: 'p1', stage: 'first_visit_offer' }), appt({ patient_id: 'p2', stage: 'first_visit' })])
    expect(computeMetric(METRIC_BY_KEY.get('new_patients')!, 'none', d, june).value).toBe(2)
  })

  it('reads reports saved by the old Custom Reports page', () => {
    expect(savedReportConfig({ source: 'payments', metric: 'sum', groupBy: 'method', chartType: 'bar' })).toMatchObject({ metric: 'income_paid', split: 'method', chart: 'bar' })
    expect(savedReportConfig({ source: 'patients', metric: 'count', groupBy: 'recall_status', chartType: 'table' })).toMatchObject({ metric: 'total_patients', split: 'status', chart: 'table' })
    expect(savedReportConfig({ v: 2, metric: 'pva', split: 'month', chart: 'line' })).toMatchObject({ metric: 'pva', split: 'month', chart: 'line' })
    expect(savedReportConfig({ source: 'nonsense' })).toBeNull()
  })

  it('offers visits by appointment type ready-made, and on the monthly template', () => {
    const blocks = reportLibrary(t).flatMap((g) => g.blocks)
    expect(blocks.some((b) => b.config.metric === 'visits_completed' && b.config.split === 'appointment_type')).toBe(true)
    expect(blocks.some((b) => b.config.metric === 'visits_booked' && b.config.split === 'appointment_type')).toBe(true)
    const monthly = pageTemplates(t).find((p) => p.key === 'monthly')!
    expect(monthly.blocks.some((b) => b.config.split === 'appointment_type')).toBe(true)
  })

  it('counts completed visits per appointment type', () => {
    const d = data([appt({ appointment_type_id: 'pv' }), appt({ appointment_type_id: 'aj' }), appt({ appointment_type_id: 'aj' }), appt({ appointment_type_id: 'aj', status: 'cancelled' })])
    d.names.type.set('pv', 'Primera visita')
    d.names.type.set('aj', 'Ajuste')
    const r = computeMetric(METRIC_BY_KEY.get('visits_completed')!, 'appointment_type', d, june)
    expect(Object.fromEntries(r.rows.map((x) => [x.label, x.value]))).toEqual({ Ajuste: 2, 'Primera visita': 1 })
  })
})
