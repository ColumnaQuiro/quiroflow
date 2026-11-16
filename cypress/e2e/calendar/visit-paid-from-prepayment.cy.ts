import { SEEDED_PRACTITIONER, assertDayGridShows, dateInputValue, openNewAppointmentPanel, yesterday } from '../../support/calendar'

// A patient paid 50 EUR ahead -- in PracticeHub, imported as a payment with no
// invoice and no account_credits row, which is the normal shape for one. Their
// balance read +50, and the visit that money was for was charged in full: the
// appointment panel offered "Credit on account" only off the credit ledger,
// which that payment never reaches.
//
// And spending it has to leave the balance at zero. A 'credit' payment is not
// money, so a -50 ledger row beside it took the same 50 off a second time.
//
// Yesterday, for the reason split-payment.cy.ts gives: no billing UI for a
// visit that has not happened yet.
const bookedDay = yesterday()

describe('Paying a visit from money paid ahead', () => {
  it('offers the prepayment as credit, and leaves the balance at zero', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task<{ id: string }>('db:createServiceProduct', { accountId: account.accountId, name: 'Adjustment', priceCents: 5000 }).as('service')
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paula', lastName: 'Prepaid' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 5000, method: 'other' })

        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        openNewAppointmentPanel()

        cy.get('[data-cy=create-sheet]').within(() => {
          cy.get('[data-cy=create-patient-search]').type('Paula')
          cy.contains('[data-cy=create-patient-result]', 'Paula Prepaid').click()
          cy.contains('[data-cy=create-type]', 'Consultation').click()
          cy.contains('[data-cy=create-practitioner]', SEEDED_PRACTITIONER).click()
          cy.get('input[type="date"]').clear().type(dateInputValue(bookedDay))
          cy.get('[data-cy=create-submit]').click()
        })
        cy.get('[data-cy=create-sheet]').should('not.exist')
        cy.get('[aria-label="Previous"]').click()
        assertDayGridShows(bookedDay)
        cy.contains('Paula Prepaid').click({ force: true })
        cy.get('[data-cy=appt-sheet]').should('be.visible')

        cy.get('[data-cy=appt-sheet]').within(() => {
          cy.get('[data-cy=appt-tab-billing]').click()
          cy.contains('button', 'Charge this visit').click()
          // By id: the label carries a formatted amount, and matching it as
          // text is not what this spec is about.
          cy.get<{ id: string }>('@service').then((service) => {
            cy.get(`select option[value="${service.id}"]`).should('exist').parent().select(service.id)
          })
          cy.contains('Balance due: 50,00 €').should('be.visible')

          // Still 50 to spend with the visit invoiced against it -- paying that
          // invoice is what the money is for.
          cy.contains('button', 'Process').parents('form').as('paymentForm')
          // \s, not a space: formatEur puts a no-break space before the euro
          // sign, and contain.text compares the raw text (utils/billing.ts).
          cy.get('@paymentForm').find('select').eq(0).find('option[value="credit"]').invoke('text').should('match', /50,00\s€ available/)
          cy.get('@paymentForm').find('select').eq(0).select('credit')
          cy.get('@paymentForm').find('input[type="number"]').eq(0).clear().type('50')
          cy.get('@paymentForm').contains('button', 'Process').click()
          cy.contains('Balance due: 0,00 €').should('be.visible')
        })

        // No ledger row: the 50 never had one to take it off.
        cy.task<unknown[]>('db:creditsFor', { patientId: patient.id }).should('have.length', 0)
        // Spending credit is not a new fiscal event.
        cy.task<unknown[]>('db:facturasFor', { patientId: patient.id }).should('have.length', 0)
        // 50 paid, 50 charged, nothing owed either way.
        cy.task<{ balance_cents: number; outstanding_cents: number }[]>('db:selectRows', {
          table: 'patient_live_balances',
          columns: 'balance_cents, outstanding_cents',
          match: { patient_id: patient.id },
        }).should('deep.equal', [{ balance_cents: 0, outstanding_cents: 0 }])
      })
    })
  })
})
