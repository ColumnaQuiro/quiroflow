import { describe, expect, it } from 'vitest'
import { clampRows, clampSpan, normaliseBlocks, reportLibrary, savedReportConfig } from '../../utils/reportBlocks'
import { computeMetric, computePivot, metricLabel, METRIC_BY_KEY, type Appt, type Ctx, type MoneyPayment, type PatientRow, type ReportData } from '../../utils/reportMetrics'

// The metrics that follow new patients from their first visit (conversion to
// visit N, lost after the first visit, income per new patient), the block
// filters, and the free block sizes.

const t = (en: string) => en
const DAY = 86_400_000
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime()
let seq = 0
function appt(over: Partial<Appt>): Appt {
  return { id: `a${++seq}`, patient_id: 'p1', at: at(2026, 6, 10), status: 'completed', appointment_type_id: null, practitioner_id: 'a', clinic_id: 'c', source: 'staff', confirmation_status: null, stage: null, ...over }
}
function data(appts: Appt[], extra: { patients?: PatientRow[]; payments?: MoneyPayment[] } = {}): ReportData {
  return {
    appts,
    money: () => ({ payments: extra.payments ?? [], invoices: [], appointmentById: new Map(), patientById: new Map(), paidByInvoice: new Map(), lines: [], purchaseById: new Map() }),
    patients: extra.patients ?? [],
    bonos: { purchases: [], invoicesById: new Map(), schedulesByPurchase: new Map(), payments: [] },
    memberships: [],
    whatsapp: () => [],
    leads: () => ({ leads: [], spend: [], defaultValueCents: null }),
    recalls: [],
    carePlans: [],
    visitValues: () => new Map(),
    names: { member: new Map([['a', 'Ana'], ['b', 'Bea']]), clinic: new Map(), type: new Map(), service: new Map(), package: new Map(), method: (k) => k },
  }
}
const june: Ctx = { from: new Date(2026, 5, 1), to: new Date(2026, 5, 30, 23, 59, 59, 999), now: new Date(2026, 5, 30), t }
const metric = (key: string) => METRIC_BY_KEY.get(key)!

/** A patient whose first visit is on `start`, with `visits` completed visits in all, a week apart. */
function journey(patient: string, start: number, visits: number, first: Partial<Appt> = {}): Appt[] {
  return Array.from({ length: visits }, (_, i) => appt({ patient_id: patient, at: start + i * 7 * DAY, ...(i === 0 ? { stage: 'first_visit', ...first } : { stage: 'adjustment' }) }))
}

describe('conversion to visit N', () => {
  const d = data([
    ...journey('p1', at(2026, 6, 2), 3),
    ...journey('p2', at(2026, 6, 3), 2),
    ...journey('p3', at(2026, 6, 4), 5, { stage: 'first_visit_offer' }),
    ...journey('p4', at(2026, 6, 5), 1, { stage: 'first_visit_offer' }),
    // a first visit before the period is not a new patient of June
    ...journey('p5', at(2026, 5, 2), 6),
  ])

  it('is the share of new patients who reached their Nth visit, the first visit being the 1st', () => {
    expect(computeMetric(metric('conversion_to_visit'), 'none', d, { ...june, visitNumber: 2 }).value).toBe(75)
    expect(computeMetric(metric('conversion_to_visit'), 'none', d, { ...june, visitNumber: 3 }).value).toBe(50)
    expect(computeMetric(metric('conversion_to_visit'), 'none', d, { ...june, visitNumber: 5 }).value).toBe(25)
  })

  it('sets first visits with the offer beside the rest, as a split or as a filter', () => {
    const byStage = computeMetric(metric('conversion_to_visit'), 'stage', d, { ...june, visitNumber: 3 })
    expect(Object.fromEntries(byStage.rows.map((r) => [r.key, r.value]))).toEqual({ first_visit: 50, first_visit_offer: 50 })
    expect(computeMetric(metric('conversion_to_visit'), 'none', d, { ...june, visitNumber: 2, stages: ['first_visit_offer'] }).value).toBe(50)
  })

  it('pivots practitioner by offer', () => {
    const p = computePivot(metric('conversion_to_visit'), 'practitioner', 'stage', d, { ...june, visitNumber: 2 })!
    expect(p.columns.map((c) => c.key)).toEqual(['first_visit_offer', 'first_visit'])
    expect(p.rows[0]!.cells).toEqual({ first_visit_offer: 50, first_visit: 100 })
  })

  it('counts only visits within the window when one is set', () => {
    // p1's 3rd visit is 14 days after the first.
    expect(computeMetric(metric('conversion_to_visit'), 'none', d, { ...june, visitNumber: 3, withinDays: 10 }).value).toBe(0)
    expect(computeMetric(metric('conversion_to_visit'), 'none', d, { ...june, visitNumber: 3, withinDays: 14 }).value).toBe(50)
  })

  it('filters the first visit by appointment type, and counts later visits whatever their type', () => {
    const typed = data([...journey('p1', at(2026, 6, 2), 3, { appointment_type_id: 'promo' }), ...journey('p2', at(2026, 6, 2), 1, { appointment_type_id: 'full' })])
    expect(computeMetric(metric('conversion_to_visit'), 'none', typed, { ...june, visitNumber: 3, typeIds: ['promo'] }).value).toBe(100)
    expect(computeMetric(metric('conversion_to_visit'), 'none', typed, { ...june, visitNumber: 3, typeIds: ['nothing'] }).value).toBeNull()
  })

  it('names itself after N', () => {
    expect(metricLabel(metric('conversion_to_visit'), { visitNumber: 3 }, t)).toBe('Conversion to visit 3')
    expect(metricLabel(metric('conversion_to_visit'), { visitNumber: 2, withinDays: 30 }, t)).toBe('Conversion to visit 2 within 30 days')
    expect(metricLabel(metric('conversion_to_visit'), { visitNumber: 11 }, (_en, es) => es)).toBe('Conversión a la visita 11')
  })
})

describe('new patients after their first visit', () => {
  it('counts those who never came back and have nothing booked', () => {
    const d = data([
      ...journey('p1', at(2026, 6, 2), 1),
      ...journey('p2', at(2026, 6, 3), 1),
      appt({ patient_id: 'p2', status: 'booked', at: at(2026, 7, 3) }),
      ...journey('p3', at(2026, 6, 4), 2),
    ])
    expect(computeMetric(metric('first_visit_dropouts'), 'none', d, june).value).toBe(1)
  })

  it('averages what each new patient paid from the day of their first visit', () => {
    const d = data([...journey('p1', at(2026, 6, 2), 2), ...journey('p2', at(2026, 6, 20), 1)], {
      payments: [
        { amount_cents: 4000, method: 'card', at: at(2026, 6, 2, 8), invoice_id: null, patient_id: 'p1' },
        { amount_cents: 6000, method: 'card', at: at(2026, 7, 1), invoice_id: null, patient_id: 'p1' },
        // after p1's 30 days
        { amount_cents: 9000, method: 'card', at: at(2026, 7, 10), invoice_id: null, patient_id: 'p1' },
        // credit is not money
        { amount_cents: 5000, method: 'credit', at: at(2026, 6, 21), invoice_id: null, patient_id: 'p2' },
        { amount_cents: 2000, method: 'cash', at: at(2026, 6, 21), invoice_id: null, patient_id: 'p2' },
      ],
    })
    expect(computeMetric(metric('income_per_new_patient'), 'none', d, { ...june, withinDays: 30 }).value).toBe(6000)
  })
})

describe('more patient and visit metrics', () => {
  it('counts first visits with the offer, and all first visits', () => {
    const d = data([appt({ stage: 'first_visit' }), appt({ patient_id: 'p2', stage: 'first_visit_offer' }), appt({ patient_id: 'p3', stage: 'first_visit_offer', status: 'no_show' })])
    expect(computeMetric(metric('first_visit_offers'), 'none', d, june).value).toBe(1)
    expect(computeMetric(metric('first_visits_all'), 'none', d, june).value).toBe(2)
    expect(computeMetric(metric('first_visits'), 'none', d, june).value).toBe(1)
  })

  it('counts each patient seen once, and those back after 90 days', () => {
    const d = data([
      appt({ patient_id: 'p1', at: at(2026, 6, 2) }),
      appt({ patient_id: 'p1', at: at(2026, 6, 9) }),
      appt({ patient_id: 'p2', at: at(2026, 2, 1) }),
      appt({ patient_id: 'p2', at: at(2026, 6, 9) }),
      appt({ patient_id: 'p3', at: at(2026, 5, 20) }),
      appt({ patient_id: 'p3', at: at(2026, 6, 9) }),
    ])
    expect(computeMetric(metric('patients_seen'), 'none', d, june).value).toBe(3)
    expect(computeMetric(metric('reactivated_patients'), 'none', d, june).value).toBe(1)
  })

  it('counts a visit as rebooked when the next one was created by the end of that day', () => {
    const d = data([
      appt({ patient_id: 'p1', at: at(2026, 6, 2, 10) }),
      appt({ patient_id: 'p1', at: at(2026, 6, 9), status: 'booked', created: at(2026, 6, 2, 11) }),
      appt({ patient_id: 'p2', at: at(2026, 6, 2, 11) }),
      appt({ patient_id: 'p2', at: at(2026, 6, 20), status: 'booked', created: at(2026, 6, 5) }),
    ])
    expect(computeMetric(metric('rebooking_rate'), 'none', d, june).value).toBe(50)
  })

  it('narrows visit metrics by stage, who booked, and the patient’s origin', () => {
    const d = data(
      [
        appt({ patient_id: 'p1', stage: 'adjustment', source: 'online' }),
        appt({ patient_id: 'p2', stage: 'maintenance', source: 'staff' }),
        appt({ patient_id: 'p3', stage: 'adjustment', source: 'staff' }),
      ],
      { patients: [{ id: 'p1', default_practitioner_id: null, clinic_id: null, referral_source: 'Instagram', recall_status: null }] },
    )
    const m = metric('visits_completed')
    expect(computeMetric(m, 'none', d, { ...june, stages: ['adjustment'] }).value).toBe(2)
    expect(computeMetric(m, 'none', d, { ...june, bookedVia: 'patient' }).value).toBe(1)
    expect(computeMetric(m, 'none', d, { ...june, bookedVia: 'staff', stages: ['adjustment'] }).value).toBe(1)
    expect(computeMetric(m, 'none', d, { ...june, referralSource: 'Instagram' }).value).toBe(1)
  })
})

describe('block sizes and saved configs', () => {
  it('keeps any width from 2 to 12 columns, and a dragged height within bounds', () => {
    expect([clampSpan(5), clampSpan(1), clampSpan(40), clampSpan('x')]).toEqual([5, 2, 12, 6])
    expect([clampRows(2), clampRows(10), clampRows(99), clampRows(undefined)]).toEqual([3, 10, 24, null])
    const [b] = normaliseBlocks([{ id: 'x', title: 'X', span: 7, rows: 9, config: { metric: 'conversion_to_visit', split: 'none', chart: 'number', params: { visitNumber: 4 } } }])
    expect([b!.span, b!.rows, b!.config.params]).toEqual([7, 9, { visitNumber: 4, withinDays: null }])
  })

  it('keeps the visit number of a saved report', () => {
    expect(savedReportConfig({ v: 2, metric: 'conversion_to_visit', split: 'stage', chart: 'bar', params: { visitNumber: 5, withinDays: 60 } })?.params).toEqual({ visitNumber: 5, withinDays: 60 })
  })

  it('offers the offer-or-not comparison ready-made', () => {
    const stats = reportLibrary(t)[0]!.blocks
    expect(stats.some((b) => b.config.metric === 'conversion_to_visit' && b.config.split === 'stage' && b.config.params?.visitNumber === 3)).toBe(true)
    expect(stats.some((b) => b.config.metric === 'first_visit_offers')).toBe(true)
  })
})
