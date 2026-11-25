import { describe, expect, it } from 'vitest'
import { averageVisitValueCents, visitValues } from '../../utils/visitValue'
import { computeMetric, METRIC_BY_KEY, type Appt, type ReportData } from '../../utils/reportMetrics'

describe('what a visit was worth', () => {
  it('takes the bono session over any invoice on the same visit, and the invoice otherwise', () => {
    const v = visitValues(
      [{ appointment_id: 'bono', amount_cents: 4000 }, { appointment_id: null, amount_cents: 4000 }],
      [
        // the bono's own sale, raised at the visit that used its first session
        { appointment_id: 'bono', total_cents: 40000, status: 'paid' },
        { appointment_id: 'walkin', total_cents: 5500, status: 'paid' },
        // charged and not yet paid is still what the visit was worth
        { appointment_id: 'owed', total_cents: 5500, status: 'unpaid' },
        { appointment_id: 'voided', total_cents: 5500, status: 'void' },
      ],
    )
    expect(Object.fromEntries(v)).toEqual({ bono: 4000, walkin: 5500, owed: 5500 })
  })

  it('leaves visits with no value out of the average instead of counting them as free', () => {
    const v = new Map([['a', 4000], ['b', 6000]])
    expect(averageVisitValueCents(['a', 'b', 'membership'], v)).toBe(5000)
    expect(averageVisitValueCents(['membership'], v)).toBeNull()
  })
})

describe('Average income per visit', () => {
  const t = (en: string) => en
  const june = { from: new Date(2026, 5, 1), to: new Date(2026, 5, 30, 23, 59, 59, 999), now: new Date(2026, 5, 30), t }
  const appt = (id: string, over: Partial<Appt> = {}): Appt => ({ id, patient_id: 'p1', at: new Date(2026, 5, 10, 10).getTime(), status: 'completed', appointment_type_id: null, practitioner_id: 'a', clinic_id: 'c', source: 'staff', confirmation_status: null, stage: null, ...over })
  function data(appts: Appt[], values: Map<string, number>): ReportData {
    return {
      appts,
      // A month of takings that has nothing to do with these visits: the bonos
      // they used were paid for in earlier months. It must not move the figure.
      money: () => ({ payments: [{ amount_cents: 100, method: 'cash', at: june.from.getTime() + 1, invoice_id: null, patient_id: 'p1' }], invoices: [], appointmentById: new Map(), patientById: new Map(), paidByInvoice: new Map(), lines: [], purchaseById: new Map() }),
      patients: [],
      bonos: { purchases: [], invoicesById: new Map(), schedulesByPurchase: new Map(), payments: [] },
      memberships: [],
      whatsapp: () => [],
      leads: () => ({ leads: [], spend: [], defaultValueCents: null }),
      recalls: [],
      carePlans: [],
      visitValues: () => values,
      names: { member: new Map([['a', 'Ana'], ['b', 'Bea']]), clinic: new Map(), type: new Map(), service: new Map(), package: new Map(), method: (k) => k },
    }
  }

  it('averages what the period’s completed visits were worth, not what was taken in it', () => {
    const d = data(
      [appt('s1'), appt('s2'), appt('paid', { practitioner_id: 'b' }), appt('cancelled', { status: 'cancelled' }), appt('may', { at: new Date(2026, 4, 20).getTime() })],
      new Map([['s1', 4000], ['s2', 4400], ['paid', 6000], ['cancelled', 9900], ['may', 9900]]),
    )
    const metric = METRIC_BY_KEY.get('income_per_visit')!
    expect(metric.needs).not.toContain('money')
    const all = computeMetric(metric, 'practitioner', d, june)
    expect(all.value).toBe(4800)
    expect(Object.fromEntries(all.rows.map((r) => [r.label, r.value]))).toEqual({ Ana: 4200, Bea: 6000 })
    expect(computeMetric(metric, 'none', d, { ...june, practitionerId: 'a' }).value).toBe(4200)
  })
})
