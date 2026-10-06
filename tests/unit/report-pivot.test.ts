import { describe, expect, it } from 'vitest'
import { normaliseBlocks, pageTemplates, reportLibrary, savedReportConfig } from '../../utils/reportBlocks'
import { canPivot, computePivot, METRIC_BY_KEY, pivotColumnsFor, type Appt, type ReportData } from '../../utils/reportMetrics'

const t = (en: string) => en
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime()
function appt(over: Partial<Appt>): Appt {
  return { id: Math.random().toString(36), patient_id: 'p1', at: at(2026, 9, 10), status: 'completed', appointment_type_id: null, practitioner_id: 'a', clinic_id: 'c', source: 'staff', confirmation_status: null, stage: null, ...over }
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
const september = { from: new Date(2026, 8, 1), to: new Date(2026, 8, 30, 23, 59, 59, 999), now: new Date(2026, 8, 30), t }
const completed = METRIC_BY_KEY.get('visits_completed')!

// Ana's September: 2 offer first visits, 1 report, 3 adjustments, 1 maintenance.
// Bea's: 1 report, 2 adjustments. Plus what must not count.
const month = data([
  appt({ practitioner_id: 'a', stage: 'first_visit_offer' }),
  appt({ practitioner_id: 'a', stage: 'first_visit_offer' }),
  appt({ practitioner_id: 'a', stage: 'report' }),
  appt({ practitioner_id: 'a', stage: 'adjustment' }),
  appt({ practitioner_id: 'a', stage: 'adjustment' }),
  appt({ practitioner_id: 'a', stage: 'adjustment' }),
  appt({ practitioner_id: 'a', stage: 'maintenance' }),
  appt({ practitioner_id: 'b', stage: 'report' }),
  appt({ practitioner_id: 'b', stage: 'adjustment' }),
  appt({ practitioner_id: 'b', stage: 'adjustment' }),
  // Not completed, and not in September.
  appt({ practitioner_id: 'a', stage: 'adjustment', status: 'no_show' }),
  appt({ practitioner_id: 'b', stage: 'report', at: at(2026, 8, 31) }),
])

describe('a table split two ways', () => {
  it('counts each practitioner\'s completed visits per stage, with totals both ways', () => {
    const p = computePivot(completed, 'practitioner', 'stage', month, september)!
    expect(p.rows.map((r) => [r.label, r.cells.first_visit_offer, r.cells.report, r.cells.adjustment, r.cells.maintenance, r.value])).toEqual([
      ['Ana', 2, 1, 3, 1, 7],
      ['Bea', 0, 1, 2, 0, 3],
    ])
    expect(p.columnTotals).toEqual({ first_visit_offer: 2, report: 2, adjustment: 5, maintenance: 1 })
    expect(p.value).toBe(10)
  })

  it('puts the stages in the order a patient meets them, not by how many there were', () => {
    const p = computePivot(completed, 'practitioner', 'stage', month, september)!
    expect(p.columns.map((c) => c.label)).toEqual(['First visit (offer)', 'Report', 'Adjustment', 'Maintenance'])
  })

  it('keeps to the practitioner the page is filtered to', () => {
    const p = computePivot(completed, 'practitioner', 'stage', month, { ...september, practitionerId: 'b' })!
    expect(p.rows.map((r) => r.label)).toEqual(['Bea'])
    expect(p.value).toBe(3)
  })

  it('leaves a rate empty where a cell has nothing to divide by', () => {
    const shows = data([
      appt({ practitioner_id: 'a', stage: 'adjustment', status: 'completed' }),
      appt({ practitioner_id: 'a', stage: 'adjustment', status: 'no_show' }),
      appt({ practitioner_id: 'b', stage: 'report', status: 'completed' }),
    ])
    const p = computePivot(METRIC_BY_KEY.get('show_rate')!, 'practitioner', 'stage', shows, september)!
    const ana = p.rows.find((r) => r.key === 'a')!
    expect([ana.cells.adjustment, ana.cells.report]).toEqual([50, null])
  })

  it('runs months along the top in order, every month present', () => {
    const p = computePivot(completed, 'practitioner', 'month', month, { ...september, from: new Date(2026, 7, 1) })!
    expect(p.columns).toHaveLength(2)
    expect(p.rows.find((r) => r.key === 'b')!.cells[p.columns[0]!.key]).toBe(1)
  })

  it('is offered only for figures that can be cut into cells', () => {
    expect(canPivot(completed)).toBe(true)
    expect(canPivot(METRIC_BY_KEY.get('pva')!)).toBe(false)
    expect(pivotColumnsFor(completed, 'practitioner')).toContain('stage')
    expect(pivotColumnsFor(completed, 'practitioner')).not.toContain('practitioner')
    expect(pivotColumnsFor(completed, 'none')).toEqual([])
    expect(computePivot(METRIC_BY_KEY.get('pva')!, 'practitioner', 'stage', month, september)).toBeNull()
  })
})

describe('the block for it', () => {
  it('is in the library and on the practitioner performance page', () => {
    const block = reportLibrary(t).flatMap((g) => g.blocks).find((b) => b.config.columns === 'stage')!
    expect(block.config).toMatchObject({ metric: 'visits_completed', split: 'practitioner', chart: 'table', columns: 'stage' })
    const page = pageTemplates(t).find((p) => p.key === 'practitioners')!
    expect(page.blocks.some((b) => b.config.columns === 'stage')).toBe(true)
  })

  it('keeps its columns through a save, and an older block without them reads as none', () => {
    const [kept, old] = normaliseBlocks([
      { id: 'x', title: 'X', span: 12, config: { metric: 'visits_completed', split: 'practitioner', columns: 'stage', chart: 'table' } },
      { id: 'y', title: 'Y', span: 6, config: { metric: 'visits_completed', split: 'practitioner', chart: 'bar' } },
    ])
    expect(kept!.config.columns).toBe('stage')
    expect(old!.config.columns).toBeNull()
    expect(savedReportConfig({ v: 2, metric: 'visits_completed', split: 'practitioner', columns: 'stage', chart: 'table' })?.columns).toBe('stage')
  })
})
