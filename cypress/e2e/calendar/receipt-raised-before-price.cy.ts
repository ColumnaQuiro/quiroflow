import { todayAt } from '../../support/calendar'

// A receipt raised while the visit's type still cost 0 €.
//
// A new clinic charged its first visit before filling in its prices: the
// receipt was raised at 0 €, its 0 € line removed, and the type priced two
// minutes later. A receipt never looks at the type's price again, "Charge"
// only shows while there is no receipt, and the add-a-line picker lists
// services and products -- so the visit could not be charged at all. Both
// ways of charging it now put the visit back on at today's price.

function seedReceiptAtZero() {
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Adjustment', durationMinutes: 30, defaultPriceCents: 6500 }).then((type) =>
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Cero', lastName: 'Recibo' }).then((patient) =>
        // Checked in, so billable whatever time of day the spec runs.
        cy
          .task<{ id: string }>('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            practitionerId: account.teamMemberId,
            appointmentTypeId: type.id,
            startsAt: todayAt(10, 0),
            durationMinutes: 30,
            checkedIn: true,
          })
          .then((appt) =>
            // The receipt as the clinic was left with it: 0 €, no lines.
            cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, appointmentId: appt.id, totalCents: 0, status: 'unpaid' }).then(() => ({ account, appt })),
          ),
      ),
    ),
  )
}

function openVisit(account: { email: string; password: string }) {
  cy.login(account.email, account.password)
  cy.visit('/calendar')
  cy.contains('select', 'Work week').select('day')
  cy.contains('[data-cy=appt-block]', 'Cero Recibo').click()
  cy.get('[data-cy=appt-sheet]').should('be.visible')
}

describe('A receipt raised before the visit had a price', () => {
  it('puts the visit back on from the Billing tab', () => {
    seedReceiptAtZero().then(({ account, appt }) => {
      openVisit(account)
      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.get('[data-cy=appt-tab-billing]').click()
        cy.get('[data-cy=appt-add-visit-line]').should('contain.text', 'The visit is not on this receipt.')
        cy.contains('[data-cy=appt-add-visit-line] button', 'Add Adjustment').click()
        cy.get('[data-cy=appt-add-visit-line]').should('not.exist')
        cy.contains('Adjustment ×1').should('be.visible')
        cy.contains('Balance due:').should('contain.text', '65,00')
      })
      cy.task<any[]>('db:invoicesForAppointment', { appointmentId: appt.id }).then((invoices) => {
        expect(invoices, 'the same receipt, not a second one').to.have.length(1)
        expect(invoices[0].total_cents).to.eq(6500)
        expect(invoices[0].invoice_line_items.map((l: any) => [l.description, l.price_cents])).to.deep.eq([['Adjustment', 6500]])
      })
    })
  })

  it('charges the price from the first screen in one press', () => {
    seedReceiptAtZero().then(({ account, appt }) => {
      openVisit(account)
      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.get('[data-cy=visit-checkout]').within(() => {
          // cy.contains: formatEur puts a non-breaking space before the €.
          cy.contains('[data-cy=checkout-process]', 'charge 65,00 €').click()
        })
        cy.get('[data-cy=visit-checkout]', { timeout: 15000 }).should('not.exist')
      })
      cy.task<any[]>('db:invoicesForAppointment', { appointmentId: appt.id }).then((invoices) => {
        expect(invoices).to.have.length(1)
        expect(invoices[0].status).to.eq('paid')
        expect(invoices[0].total_cents).to.eq(6500)
        expect(invoices[0].payments.map((p: any) => p.amount_cents), 'paid in full, once').to.deep.eq([6500])
      })
    })
  })
})
