// Books yesterday rather than the panel's default of 09:00 today --
// AppointmentBillingTab raises no invoice for a visit that hasn't happened
// yet, so a 09:00-today appointment leaves this spec with no billing UI on
// any CI run starting before 09:00 UTC. See the same note in
// appointment-booking-and-billing.cy.ts.
function yesterdayInputValue() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

describe('Taking a visit from a bono in the calendar', () => {
  it('records the session and leaves no invoice behind for the covered visit', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bea', lastName: 'Bonocover' }).then((patient: any) => {
        // 12 sessions at €528 => €44 a visit.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 52800,
        }).then((purchase: any) => {
          cy.login(account.email, account.password)
          cy.visit('/calendar')
          cy.contains('select', 'Work week').select('day')
          cy.clickUntil('button:contains("New Appointment")', 'input[placeholder="Search by name, phone, or email…"]')

          cy.get('.fixed.inset-0.z-50').within(() => {
            cy.get('input[placeholder="Search by name, phone, or email…"]').type('Bea')
            cy.contains('li', 'Bea Bonocover').click()
            cy.get('select').eq(0).should('contain.text', 'Consultation').select('Consultation (30 min)')
            cy.get('input[type="date"]').clear().type(yesterdayInputValue())
            cy.contains('button', /^Create$/).click()
          })
          cy.get('.fixed.inset-0.z-50').should('not.exist')
          // Booked for yesterday, so step the calendar back a day to see it.
          cy.get('[aria-label="Previous"]').click()
          cy.contains('Bea Bonocover').should('be.visible').click({ force: true })
          cy.contains('h2', 'Edit Appointment').should('be.visible')

          cy.get('.fixed.inset-0.z-50').within(() => {
            cy.contains('button', 'billing').click()
            // Opening the tab used to raise an invoice eagerly, before anyone
            // had said how the visit would be paid -- which is how bono visits
            // ended up carrying a phantom debt. Nothing is billed until a
            // person chooses, so there is no invoice to clean up here.
            cy.contains('Not billed yet').should('be.visible')
            cy.contains('INV-').should('not.exist')

            cy.contains('button', 'Bono 12').click()

            // Replaced by an explicit statement of why there is no invoice.
            cy.contains('Covered by Bono 12', { timeout: 15000 }).should('be.visible')
            cy.contains('INV-').should('not.exist')
          })

          cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((eff: any) => {
            expect(eff.purchase.sessions_used, 'one session spent').to.eq(1)

            expect(eff.sessions, 'the visit recorded on the bono').to.have.length(1)
            expect(eff.sessions[0].amount_cents, 'worth the bono rate, not the walk-in price').to.eq(4400)

            // The whole point: the bono was paid for once, at the sale. A
            // covered visit must not raise a second charge, nor spend an
            // account-credit balance standing in for the same money.
            expect(eff.invoices, 'no invoice survives for a covered visit').to.have.length(0)
            expect(eff.payments, 'nothing collected for it').to.have.length(0)
            expect(eff.credits, 'no credit written either way').to.have.length(0)

            expect(eff.appointments, 'the appointment').to.have.length(1)
            expect(eff.appointments[0].status, 'completed by taking the session').to.eq('completed')
          })
        })
      })
    })
  })
})
