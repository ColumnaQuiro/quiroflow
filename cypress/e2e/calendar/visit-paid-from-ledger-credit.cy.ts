import { SEEDED_PRACTITIONER, assertDayGridShows, dateInputValue, openNewAppointmentPanel, yesterday } from '../../support/calendar'

// A patient put 50 EUR on account at the desk ("Add credit": a payment, and a
// credit row naming it), then had a 50 EUR visit paid out of it. Paid 50,
// charged 50 -- and the balance read -50.
//
// Spending credit writes a 'credit' payment and a negative ledger row. The
// payment is not money (20260924095218), so it stays out of the balance; the
// ledger row was still counted, and took the same 50 off again. One patient
// read -165 EUR having paid exactly what they were charged.
//
// The spend row is marked is_spend now: it takes the credit off what the
// patient can still spend, and leaves the balance alone.
//
// Yesterday, for the reason split-payment.cy.ts gives: no billing UI for a
// visit that has not happened yet.
const bookedDay = yesterday()

describe('Paying a visit from credit added on account', () => {
  it('draws the ledger down to zero and leaves the balance at zero', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task<{ id: string }>('db:createServiceProduct', { accountId: account.accountId, name: 'Adjustment', priceCents: 5000 }).as('service')
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lena', lastName: 'Ledger' }).then((patient) => {
        // What "Add credit" writes: the money, and the credit row restating it.
        cy.task<{ id: string }>('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 5000, method: 'card', purpose: 'on_account' }).then((payment) => {
          cy.task('db:createAccountCredit', { accountId: account.accountId, patientId: patient.id, amountCents: 5000, paymentId: payment.id, reason: 'Top-up' })
        })

        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        openNewAppointmentPanel()

        cy.get('[data-cy=create-sheet]').within(() => {
          cy.get('[data-cy=create-patient-search]').type('Lena')
          cy.contains('[data-cy=create-patient-result]', 'Lena Ledger').click()
          cy.contains('[data-cy=create-type]', 'Consultation').click()
          cy.contains('[data-cy=create-practitioner]', SEEDED_PRACTITIONER).click()
          cy.get('input[type="date"]').clear().type(dateInputValue(bookedDay))
          cy.get('[data-cy=create-submit]').click()
        })
        cy.get('[data-cy=create-sheet]').should('not.exist')
        cy.get('[aria-label="Previous"]').click()
        assertDayGridShows(bookedDay)
        cy.contains('Lena Ledger').click({ force: true })
        cy.get('[data-cy=appt-sheet]').should('be.visible')

        cy.get('[data-cy=appt-sheet]').within(() => {
          cy.get('[data-cy=appt-tab-billing]').click()
          cy.contains('button', 'Charge this visit').click()
          cy.get<{ id: string }>('@service').then((service) => {
            cy.get(`select option[value="${service.id}"]`).should('exist').parent().select(service.id)
          })
          cy.contains('Balance due: 50,00 €').should('be.visible')

          cy.contains('button', 'Process').parents('form').as('paymentForm')
          // \s: formatEur puts a no-break space before the euro sign.
          cy.get('@paymentForm').find('select').eq(0).find('option[value="credit"]').invoke('text').should('match', /50,00\s€ available/)
          cy.get('@paymentForm').find('select').eq(0).select('credit')
          cy.get('@paymentForm').find('input[type="number"]').eq(0).clear().type('50')
          cy.get('@paymentForm').contains('button', 'Process').click()
          cy.contains('Balance due: 0,00 €').should('be.visible')
        })

        // The ledger: the top-up, and the spend that used it up -- marked as one.
        cy.task<{ amount_cents: number; payment_id: string | null; invoice_id: string | null; is_spend: boolean }[]>('db:creditsFor', { patientId: patient.id }).should((credits) => {
          expect(credits.map((c) => [c.amount_cents, c.is_spend])).to.deep.equal([
            [5000, false],
            [-5000, true],
          ])
          expect(credits[0].payment_id, 'the top-up restates its payment').to.not.eq(null)
          expect(credits[1].invoice_id, 'the spend names the receipt it paid').to.not.eq(null)
        })
        // Spending credit is not a new fiscal event.
        cy.task<unknown[]>('db:facturasFor', { patientId: patient.id }).should('have.length', 0)
        // 50 paid, 50 charged: nothing owed either way.
        cy.task<{ balance_cents: number; outstanding_cents: number }[]>('db:selectRows', {
          table: 'patient_live_balances',
          columns: 'balance_cents, outstanding_cents',
          match: { patient_id: patient.id },
        }).should('deep.equal', [{ balance_cents: 0, outstanding_cents: 0 }])
      })
    })
  })
})
