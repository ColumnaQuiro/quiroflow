import { describe, it, expect } from 'vitest'
import {
  parsePracticeHubInvoiceList,
  practiceHubInvoiceDay,
  practiceHubInvoicePdfPath,
  practiceHubInvoicePdfReference,
  practiceHubInvoicePdfReferenceForInvoice,
  samePracticeHubInvoice,
  samePracticeHubPatientName,
  type PracticeHubImportedInvoice,
} from '../../utils/practicehubWebPages'

// An invoice's original is the PDF PracticeHub's Print button gives, behind a
// sign-in. These are the shapes its Finances > Invoices list returned on
// 26 Nov 2026; names, ids and amounts are made up.
const row = (number: string, webId: string, extra: Record<string, unknown> = {}) => ({
  date: '13th October, 2026',
  status: '<span class="label" style="background:#3c3">Paid</span>',
  type: 0,
  invNumber: `<strong>${number}</strong> <div class="invoice-id hidden">${webId}</div>`,
  patient: 'Lucía Ferrer Soler',
  amount: '46.00',
  bal: '0.00',
  ...extra,
})

describe("PracticeHub's invoice list, as the invoice-originals import reads it", () => {
  it('reads the printed number, the website id, the day, the amount and the patient', () => {
    const { rows, total } = parsePracticeHubInvoiceList({ iTotalRecords: '7241', aaData: [row('7239', 'AbCdEf12GhIj34Kl')] })
    expect(total).toBe(7241)
    expect(rows).toEqual([{ number: 7239, webId: 'AbCdEf12GhIj34Kl', day: '2026-10-13', amountCents: 4600, patient: 'Lucía Ferrer Soler' }])
  })

  it('keeps a voided invoice, which prints no number, and an amount the list leaves out', () => {
    const { rows } = parsePracticeHubInvoiceList({
      aaData: [row('-', 'ZzCdEf12GhIj34K9', { status: 'Void' }), row('1127', 'YyCdEf12GhIj34K8', { amount: 'null', date: '2nd March, 2024' })],
    })
    expect(rows.map((r) => [r.number, r.amountCents, r.day])).toEqual([
      [null, 4600, '2026-10-13'],
      [1127, null, '2024-03-02'],
    ])
  })

  it('drops a row with no website id: there is no way to its PDF', () => {
    expect(parsePracticeHubInvoiceList({ aaData: [{ invNumber: '<strong>12</strong>' }] }).rows).toEqual([])
    expect(parsePracticeHubInvoiceList(null)).toEqual({ rows: [], total: 0 })
  })

  it('asks only for a download, never for invoiceActions.php’s other actions', () => {
    expect(practiceHubInvoicePdfPath('AbCdEf12GhIj34Kl')).toBe('/config/scripts/invoices/invoiceActions.php?id=AbCdEf12GhIj34Kl&action=download&place=internal')
    // A website id is letters and digits; anything else is escaped, not passed through as more parameters.
    expect(practiceHubInvoicePdfPath('x&action=void')).toBe('/config/scripts/invoices/invoiceActions.php?id=x%26action%3Dvoid&action=download&place=internal')
  })

  it('files the original beside the invoice the Ledger step imported', () => {
    expect(practiceHubInvoicePdfReference(7239)).toBe('PH-invoice-pdf-7239')
    expect(practiceHubInvoicePdfReferenceForInvoice('PHI-7239')).toBe('PH-invoice-pdf-7239')
    expect(practiceHubInvoicePdfReferenceForInvoice('INV-0001')).toBeNull()
    expect(practiceHubInvoicePdfReferenceForInvoice(null)).toBeNull()
  })
})

describe('whether a PracticeHub invoice is the one imported under its number', () => {
  const ours: PracticeHubImportedInvoice = {
    patient_id: 'p1',
    invoice_number: 'PHI-7239',
    total_cents: 4600,
    // 23:30 UTC on the 12th is already the 13th in Madrid.
    created_at: '2026-10-12T23:30:00Z',
    patients: { first_name: 'Lucía', last_name: 'Ferrer Soler' },
  }
  const listed = parsePracticeHubInvoiceList({ aaData: [row('7239', 'AbCdEf12GhIj34Kl')] }).rows[0]!

  it('is, when the day as the clinic saw it, the amount and the patient agree', () => {
    expect(practiceHubInvoiceDay(ours.created_at, 'Europe/Madrid')).toBe('2026-10-13')
    expect(samePracticeHubInvoice(listed, ours, 'Europe/Madrid')).toBe(true)
  })

  it('is not, when any of them differs: a PDF filed on the wrong patient hands their invoice to someone else', () => {
    expect(samePracticeHubInvoice(listed, { ...ours, created_at: '2026-10-14T10:00:00Z' }, 'Europe/Madrid')).toBe(false)
    expect(samePracticeHubInvoice(listed, { ...ours, total_cents: 4300 }, 'Europe/Madrid')).toBe(false)
    expect(samePracticeHubInvoice(listed, { ...ours, patients: { first_name: 'Mario', last_name: 'Ferrer Soler' } }, 'Europe/Madrid')).toBe(false)
    expect(samePracticeHubInvoice(listed, { ...ours, patients: null }, 'Europe/Madrid')).toBe(false)
  })

  it('does not hold an amount the list left out against it', () => {
    expect(samePracticeHubInvoice({ ...listed, amountCents: null }, { ...ours, total_cents: 0 }, 'Europe/Madrid')).toBe(true)
  })
})

describe('the same patient, by name', () => {
  it('ignores accents, case and punctuation, and a surname one side left off', () => {
    expect(samePracticeHubPatientName('Maria Jose Garcia', 'María José García Pérez')).toBe(true)
    expect(samePracticeHubPatientName('ANA  LÓPEZ-RUIZ', 'Ana López Ruiz')).toBe(true)
  })

  it('tells different people apart, and never matches an empty name', () => {
    expect(samePracticeHubPatientName('Maria Garcia', 'Mario Garcia')).toBe(false)
    expect(samePracticeHubPatientName('Ana Ana', 'Ana Ruiz')).toBe(false)
    expect(samePracticeHubPatientName('', 'Ana Ruiz')).toBe(false)
  })
})
