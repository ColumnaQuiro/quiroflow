import { dateInputValue, openNewAppointmentPanel } from '../../support/calendar'

// "Collect payment now" on the new-appointment panel: the receipt, its line
// and the payment are written together by raise_invoice(), or not at all.
//
// They were four separate inserts, the receipt written as PAID first and no
// error read after it. A payment the database refused left a visit marked
// paid with nothing paying it -- a debt no list would ever show -- and the
// panel closed as though the money had been taken.
//
// What has to hold when the payment fails: the booking still stands (the
// visit is in, and retrying from the panel would book it twice), no receipt
// says "paid" without a payment behind it, and the desk is told in so many
// words that the money was NOT recorded.

type BookingMoney = {
  appointments: { id: string; status: string }[]
  invoices: { id: string; invoice_number: string; status: string; total_cents: number; appointment_id: string | null; invoice_line_items: { description: string; price_cents: number }[]; payments: { id: string; amount_cents: number; method: string }[] }[]
  payments: { id: string; amount_cents: number; method: string; invoice_id: string | null }[]
}

function tomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d
}

/** Seeds a clinic with a 45 € visit type and one patient, and opens the panel. */
function openPanelFor(lastName: string, then: (ctx: { accountId: string; patientId: string }) => void, seed?: (accountId: string, patientId: string) => void) {
  cy.seedStaffAccount().then((account) => {
    cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30, defaultPriceCents: 4500 })
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName }).then((patient) => {
      seed?.(account.accountId, patient.id)
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      openNewAppointmentPanel()
      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-patient-search]').type(lastName)
        cy.contains('[data-cy=create-patient-result]', `Nora ${lastName}`).click()
        cy.contains('[data-cy=create-type]', 'Ajuste').click()
        cy.get('input[type="date"]').clear().type(dateInputValue(tomorrow()))
        cy.get('input[type="time"]').clear().type('10:00')
        // Not the WhatsApp confirmation: nothing here is about messages.
        cy.get('[data-cy=create-send-confirmation]').uncheck()
        cy.get('[data-cy=create-more] summary').click()
        cy.get('[data-cy=create-collect-payment]').click().should('have.attr', 'aria-checked', 'true')
      })
      then({ accountId: account.accountId, patientId: patient.id })
    })
  })
}

function expectNoPaidReceiptWithoutPayment(money: BookingMoney) {
  for (const inv of money.invoices) {
    if (inv.status === 'paid') expect(inv.payments, `${inv.invoice_number} is paid, so a payment must settle it`).to.have.length.greaterThan(0)
    expect(inv.invoice_line_items, `${inv.invoice_number} has a total, so it must have a line`).to.have.length.greaterThan(0)
  }
}

describe('Collecting payment while booking', () => {
  it('keeps the booking, writes no paid receipt and says so when the payment request fails', () => {
    openPanelFor('Fallo', ({ patientId }) => {
      cy.intercept('POST', '**/rest/v1/rpc/raise_invoice', { statusCode: 500, body: { code: 'XX000', message: 'forced failure' } }).as('raise')
      cy.get('[data-cy=create-sheet] [data-cy=create-submit]').click()
      cy.wait('@raise')

      // The booking stands and the panel closes -- Book again would book it twice.
      cy.get('[data-cy=create-sheet]').should('not.exist')
      cy.contains('The appointment is booked, but the payment was NOT recorded').should('be.visible').and('contain.text', "Take it from the patient's Money tab")

      cy.task<BookingMoney>('db:bookingMoneyFor', { patientId }).then((money) => {
        expect(money.appointments, 'the visit is booked').to.have.length(1)
        expect(money.invoices, 'no receipt at all').to.have.length(0)
        expect(money.payments).to.have.length(0)
        expectNoPaidReceiptWithoutPayment(money)
      })
    })
  })

  it('rolls the receipt and its number back when the database refuses the payment itself', () => {
    openPanelFor('Rechazo', ({ accountId, patientId }) => {
      // The real write, with a method the payments table does not know: the
      // receipt and its line go in, then the payment insert breaks the
      // payment_methods foreign key -- the failure the old code turned into a
      // paid receipt with nothing behind it.
      cy.intercept('POST', '**/rest/v1/rpc/raise_invoice', (req) => {
        req.body.p_payment_method = 'not_a_method'
      }).as('raise')
      cy.get('[data-cy=create-sheet] [data-cy=create-submit]').click()
      cy.wait('@raise').its('response.statusCode').should('be.gte', 400)

      cy.get('[data-cy=create-sheet]').should('not.exist')
      cy.contains('The appointment is booked, but the payment was NOT recorded').should('be.visible')

      cy.task<BookingMoney>('db:bookingMoneyFor', { patientId }).then((money) => {
        expect(money.appointments, 'the visit is booked').to.have.length(1)
        expect(money.invoices, 'the receipt went back with the payment').to.have.length(0)
        expect(money.payments).to.have.length(0)
        expectNoPaidReceiptWithoutPayment(money)
      })
      // And its number with it: the series has no hole where the refused
      // receipt would have been.
      cy.task('db:nextInvoiceNumber', { accountId }).should('eq', 'INV-0001')
    })
  })

  it('records the receipt, its line, the payment and one factura when it works', () => {
    openPanelFor('Pago', ({ patientId }) => {
      cy.get('[data-cy=create-sheet] [data-cy=create-payment-method]').select('cash')
      cy.get('[data-cy=create-sheet] [data-cy=create-submit]').click()
      cy.get('[data-cy=create-sheet]').should('not.exist')
      cy.contains('payment was NOT recorded').should('not.exist')

      cy.task<BookingMoney>('db:bookingMoneyFor', { patientId }).should((money) => {
        expect(money.appointments).to.have.length(1)
        expect(money.invoices).to.have.length(1)
        const [inv] = money.invoices
        expect(inv.status).to.eq('paid')
        expect(inv.total_cents).to.eq(4500)
        expect(inv.appointment_id).to.eq(money.appointments[0].id)
        expect(inv.invoice_line_items).to.deep.equal([{ description: 'Ajuste', price_cents: 4500 }])
        expect(inv.payments.map((p) => [p.method, p.amount_cents])).to.deep.equal([['cash', 4500]])
      })
      // Exactly one factura, for that payment.
      cy.task<BookingMoney>('db:bookingMoneyFor', { patientId }).then((money) => {
        cy.task<{ payment_id: string }[]>('db:facturasFor', { patientId }).should((facturas) => {
          expect(facturas, 'one factura for the one payment').to.have.length(1)
          expect(facturas[0].payment_id).to.eq(money.payments[0].id)
        })
      })
    })
  })

  it('spends credit as a payment and a credit entry together, with no factura', () => {
    openPanelFor(
      'Credito',
      ({ patientId }) => {
        cy.get('[data-cy=create-sheet] [data-cy=create-payment-method]').select('credit')
        cy.get('[data-cy=create-sheet] [data-cy=create-submit]').click()
        cy.get('[data-cy=create-sheet]').should('not.exist')

        cy.task<BookingMoney>('db:bookingMoneyFor', { patientId }).should((money) => {
          expect(money.invoices).to.have.length(1)
          expect(money.invoices[0].status).to.eq('paid')
          expect(money.invoices[0].payments.map((p) => [p.method, p.amount_cents])).to.deep.equal([['credit', 4500]])
        })
        cy.task<{ amount_cents: number; invoice_id: string | null }[]>('db:creditsFor', { patientId }).should((credits) => {
          expect(credits.map((c) => c.amount_cents)).to.deep.equal([10000, -4500])
          expect(credits[1].invoice_id, 'the spend names the receipt it paid').to.not.eq(null)
        })
        cy.task<unknown[]>('db:facturasFor', { patientId }).should('have.length', 0)
      },
      (accountId, patientId) => {
        cy.task('db:createAccountCredit', { accountId, patientId, amountCents: 10000 })
      },
    )
  })
})
