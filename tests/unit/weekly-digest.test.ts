import { describe, expect, it } from 'vitest'
import { digestChange, digestDue, digestEmailHtml, digestNoShowRate, digestPushBody, digestWeek } from '../../utils/weeklyDigest'

// The owner's Monday summary (utils/weeklyDigest.ts): money counted as Daily
// Transactions counts it, visits by outcome, each figure against the week
// before.
const week = digestWeek({
  payments: [
    { amount_cents: 4500, method: 'cash', invoice_status: 'paid' },
    { amount_cents: 6000, method: 'card', invoice_status: 'paid' },
    { amount_cents: 4500, method: 'card', invoice_status: 'paid' },
    // A refund comes off.
    { amount_cents: -1500, method: 'card', invoice_status: 'paid' },
    // Not money arriving: spent credit, a write-off, a void invoice.
    { amount_cents: 3000, method: 'credit', invoice_status: 'paid' },
    { amount_cents: 2000, method: 'write_off', invoice_status: 'paid' },
    { amount_cents: 9900, method: 'cash', invoice_status: 'void' },
  ],
  invoicedCents: 20000,
  visits: [{ status: 'completed' }, { status: 'completed' }, { status: 'completed' }, { status: 'no_show' }, { status: 'cancelled' }, { status: 'booked' }],
  newPatients: 2,
})

describe('digestWeek', () => {
  it('counts receipts only, nets refunds, and splits by method', () => {
    expect(week.collectedCents).toBe(13500)
    expect(week.payments).toBe(4)
    expect(week.byMethod).toEqual([
      { method: 'card', cents: 9000 },
      { method: 'cash', cents: 4500 },
    ])
  })
  it('counts visits by what happened', () => {
    expect([week.completed, week.noShows, week.cancelled]).toEqual([3, 1, 1])
    expect(digestNoShowRate(week)).toBe(25)
    expect(digestNoShowRate({ completed: 0, noShows: 0 })).toBeNull()
  })
})

describe('digestChange', () => {
  it('says the change as a percentage for money and as a count otherwise', () => {
    expect(digestChange(12000, 10000, { money: true })).toBe('+20 %')
    expect(digestChange(8000, 10000, { money: true })).toBe('−20 %')
    expect(digestChange(5, 3)).toBe('+2')
    expect(digestChange(3, 3)).toBe('=')
  })
})

describe('the push and the email', () => {
  const lastWeek = { ...week, collectedCents: 10000, completed: 2, newPatients: 1 }
  it('puts the headline figures in one line', () => {
    expect(digestPushBody({ thisWeek: week, lastWeek })).toMatch(/^Cobrado 135,00\s€ \(\+35 %\) · 3 visitas · 25 % no vinieron · 2 pacientes nuevos$/)
  })
  it('lists the money by method with the clinic names, and links the reports', () => {
    const html = digestEmailHtml({ clinicName: 'Clínica Demo', weekLabel: '5–11 oct', thisWeek: week, lastWeek, owedCents: 32000, nextWeekBooked: 41, methodName: (k) => (k === 'card' ? 'TPV' : 'Efectivo'), origin: 'https://app.quiroflow.com' })
    expect(html).toContain('Clínica Demo')
    expect(html).toContain('TPV')
    expect(html).toMatch(/90,00\s€/)
    expect(html).toMatch(/320,00\s€/)
    expect(html).toContain('https://app.quiroflow.com/reports/daily-transactions')
    expect(html).toContain('Citas reservadas para esta semana')
  })
})

describe('digestDue', () => {
  it('is Monday 8:00 to 8:20 where the clinic is', () => {
    // Monday 12 Oct 2026: 8:05 in Madrid is 06:05Z.
    expect(digestDue(new Date('2026-10-12T06:05:00Z'), 'Europe/Madrid')).toBe(true)
    expect(digestDue(new Date('2026-10-12T05:55:00Z'), 'Europe/Madrid')).toBe(false)
    expect(digestDue(new Date('2026-10-12T06:20:00Z'), 'Europe/Madrid')).toBe(false)
    // The Canaries are an hour behind: 8:05 there is 07:05Z.
    expect(digestDue(new Date('2026-10-12T07:05:00Z'), 'Atlantic/Canary')).toBe(true)
    // Tuesday.
    expect(digestDue(new Date('2026-10-13T06:05:00Z'), 'Europe/Madrid')).toBe(false)
  })
})
