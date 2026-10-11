import { describe, it, expect } from 'vitest'
import { overdueWindow, OVERDUE_SLACK_DAYS } from '../../utils/invoiceReminders'
import { automationFieldValue } from '../../utils/automationFields'

// Payment reminders (invoice.overdue): which invoices a rule looks at, and
// the merge fields a reminder carries.
describe('Which invoices a payment reminder looks at', () => {
  const now = new Date('2026-10-20T08:00:00Z')
  it('takes the ones that have just reached N days, with a few days of slack', () => {
    const { from, to } = overdueWindow(7, now)
    expect(to.toISOString()).toBe('2026-10-13T08:00:00.000Z')
    expect(from.toISOString()).toBe(new Date(now.getTime() - (7 + OVERDUE_SLACK_DAYS) * 86_400_000).toISOString())
  })
  it('never reaches back to old debts', () => {
    const { from } = overdueWindow(7, now)
    expect(from.getTime()).toBeGreaterThan(new Date('2026-10-01T00:00:00Z').getTime())
  })
  it('treats nonsense as one day', () => {
    expect(overdueWindow(0, now).to.toISOString()).toBe('2026-10-19T08:00:00.000Z')
  })
})

describe('The reminder merge fields', () => {
  const who = { firstName: 'Lucía', lastName: null, email: null }
  const context = { invoiceNumber: 'F-2026-0142', invoiceAmountOwed: '45,00 €', invoicePayLink: 'https://app.quiroflow.com/api/pay/abc' }
  it('fills the number, the amount and the link', () => {
    expect(automationFieldValue(who, 'invoice_number', context)).toBe('F-2026-0142')
    expect(automationFieldValue(who, 'invoice_amount_owed', context)).toBe('45,00 €')
    expect(automationFieldValue(who, 'invoice_pay_link', context)).toBe('https://app.quiroflow.com/api/pay/abc')
  })
})
