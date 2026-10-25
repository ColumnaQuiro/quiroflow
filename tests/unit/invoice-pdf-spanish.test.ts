import { describe, expect, it } from 'vitest'
import { generateInvoicePdf, type InvoiceDocumentData } from '../../server/utils/invoiceData'
import { pdfTasks } from '../../cypress/support/tasks/pdf'

// The receipt and the factura are one Spanish document each. They used to
// print English labels ("Balance due", "Tax ID", "Issued 25 Oct 2026") and
// "€45.00" around the Spanish fiscal lines, so a single factura read in two
// languages. The e2e specs check the same text through the real routes; this
// pins the layout itself without a database.

// What the extractor returns for "45,00 €": Intl's non-breaking space, then
// the euro sign, whose WinAnsi byte reads back as \u0080 in latin1.
const eur = (amount: string) => `${amount}\u00a0\u0080`

async function pdfText(data: InvoiceDocumentData): Promise<string> {
  const pdf = await generateInvoicePdf(data)
  return pdfTasks['pdf:text']({ binary: pdf.toString('binary') }).join('\n')
}

function document(overrides: Partial<InvoiceDocumentData> = {}): InvoiceDocumentData {
  return {
    accountId: 'account',
    patientId: 'patient',
    invoiceNumber: 'INV-0042',
    // 23:30 UTC on the 24th is 01:30 on the 25th in Madrid: the clinic's day.
    createdAt: '2026-10-24T23:30:00Z',
    timeZone: 'Europe/Madrid',
    totalCents: 4500,
    paidCents: 2000,
    balanceDueCents: 2500,
    lineItems: [{ description: 'Sesión de quiropráctica', quantity: 1, price_cents: 4500 }],
    patient: {
      firstName: 'Marta',
      lastName: 'Ejemplo',
      email: null,
      address: 'Calle Inventada 1',
      city: 'Valencia',
      postalCode: '46001',
      country: null,
      nationalId: '12345678Z',
    },
    clinic: { name: 'Clínica Demo', legalName: 'Clínica Demo S.L.', address: 'Avenida Ficticia 9', taxId: 'B12345678', footerText: null },
    logoBuffer: null,
    nextAppointmentDate: '2026-11-03T09:00:00Z',
    hideNextVisit: false,
    ...overrides,
  }
}

describe('The receipt PDF', () => {
  it('prints Spanish labels and es-ES amounts', async () => {
    const text = await pdfText(
      document({
        receipt: {
          showDob: false,
          showNationalId: true,
          showTaxes: false,
          showPayments: true,
          showBalance: true,
          showAccountBalance: true,
          showPractitioner: false,
          showLogo: true,
          practitionerName: null,
          accountBalanceCents: 7500,
          tax: { baseCents: 4500, rateBp: 0, amountCents: 0, exemptionClause: null },
        },
      }),
    )
    expect(text).toContain('Recibo INV-0042')
    expect(text).toContain('Fecha de expedición: 25/10/2026')
    expect(text).toContain('NIF: B12345678')
    expect(text).toContain('DNI/NIE: 12345678Z')
    for (const label of ['Concepto', 'Cant.', 'Precio', 'Importe']) expect(text).toContain(label)
    expect(text).toContain(`Total: ${eur('45,00')}`)
    expect(text).toContain(`Pagado: ${eur('20,00')}`)
    expect(text).toContain(`Pendiente: ${eur('25,00')}`)
    expect(text).toContain(`Saldo de la cuenta (a favor): ${eur('75,00')}`)
    expect(text).toContain('Tu próxima visita: 3 de noviembre de 2026')
    for (const english of ['Issued', 'Tax ID', 'Description', 'Qty', 'Subtotal', 'Paid', 'Balance due', 'Account balance', 'next visit']) {
      expect(text).not.toContain(english)
    }
    // No amount with the sign in front, the old "€45.00".
    expect(text).not.toMatch(/\u0080\d/)
  })

  it('says an account in debt is pendiente', async () => {
    const text = await pdfText(
      document({
        receipt: {
          showDob: false,
          showNationalId: true,
          showTaxes: false,
          showPayments: true,
          showBalance: true,
          showAccountBalance: true,
          showPractitioner: false,
          showLogo: true,
          practitionerName: null,
          accountBalanceCents: -12000,
          tax: { baseCents: 4500, rateBp: 0, amountCents: 0, exemptionClause: null },
        },
      }),
    )
    expect(text).toContain(`Saldo de la cuenta (pendiente): ${eur('120,00')}`)
  })
})

describe('The factura PDF', () => {
  it('reads in one language, around fiscal lines it leaves as they were', async () => {
    const text = await pdfText(
      document({
        invoiceNumber: 'F-2026-0007',
        documentTitle: 'Factura F-2026-0007',
        showTotalsBreakdown: false,
        hideNextVisit: true,
        nextAppointmentDate: null,
        totalCents: 12100,
        paidCents: 12100,
        balanceDueCents: 0,
        lineItems: [{ description: 'Bono 5 sesiones', quantity: 1, price_cents: 12100 }],
        tax: { baseCents: 10000, rateBp: 2100, amountCents: 2100, exemptionClause: null },
      }),
    )
    expect(text).toContain('Factura F-2026-0007')
    expect(text).toContain('Fecha de expedición: 25/10/2026')
    expect(text).toContain('NIF: 12345678Z')
    expect(text).toContain(`Base imponible: ${eur('100,00')}`)
    expect(text).toContain(`IVA (21%): ${eur('21,00')}`)
    expect(text).toContain(`Total: ${eur('121,00')}`)
    expect(text).not.toContain('Pagado')
    expect(text).not.toContain('Pendiente')
    expect(text).not.toContain('Recibo')
  })
})
