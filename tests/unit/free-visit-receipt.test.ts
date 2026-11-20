import { describe, it, expect } from 'vitest'
import { newVisitReceiptStatus, receiptStatusAfterLinesChange, visitReceiptEditable } from '../../utils/visitCharging'

// A visit priced at 0 € (a free adjustment, a report-of-findings, a talk) was
// charged into an unpaid 0 € receipt that nothing could ever settle -- see
// utils/visitCharging newVisitReceiptStatus.

describe('newVisitReceiptStatus', () => {
  it('settles a free visit as it is raised', () => {
    expect(newVisitReceiptStatus(0)).toBe('paid')
  })

  it('leaves a priced visit owed until it is paid', () => {
    expect(newVisitReceiptStatus(4000)).toBe('unpaid')
  })
})

describe('visitReceiptEditable', () => {
  const base = { totalCents: 0, paidCents: 0, coveredByBono: false }

  it('lets an unpaid receipt be edited', () => {
    expect(visitReceiptEditable({ ...base, status: 'unpaid', totalCents: 4000 })).toBe(true)
  })

  it('keeps a free visit open for selling a product on it', () => {
    expect(visitReceiptEditable({ ...base, status: 'paid' })).toBe(true)
  })

  it('closes a receipt that money was taken on', () => {
    expect(visitReceiptEditable({ ...base, status: 'paid', totalCents: 4000, paidCents: 4000 })).toBe(false)
  })

  it('closes a visit drawn from a bono, paid with no payment row', () => {
    expect(visitReceiptEditable({ ...base, status: 'paid', coveredByBono: true })).toBe(false)
  })

  it('closes a void receipt and has nothing to edit without one', () => {
    expect(visitReceiptEditable({ ...base, status: 'void' })).toBe(false)
    expect(visitReceiptEditable({ ...base, status: null })).toBe(false)
  })
})

describe('receiptStatusAfterLinesChange', () => {
  it('reopens a free visit once something priced is added to it', () => {
    expect(receiptStatusAfterLinesChange({ status: 'paid', totalCents: 1500, paidCents: 0, coveredByBono: false })).toBe('unpaid')
  })

  it('leaves a free visit settled while it still totals 0 €', () => {
    expect(receiptStatusAfterLinesChange({ status: 'paid', totalCents: 0, paidCents: 0, coveredByBono: false })).toBe('paid')
  })

  it('does not settle an unpaid receipt by editing it', () => {
    expect(receiptStatusAfterLinesChange({ status: 'unpaid', totalCents: 0, paidCents: 0, coveredByBono: false })).toBe('unpaid')
  })

  it('never reopens a bono visit', () => {
    expect(receiptStatusAfterLinesChange({ status: 'paid', totalCents: 4000, paidCents: 0, coveredByBono: true })).toBe('paid')
  })
})
