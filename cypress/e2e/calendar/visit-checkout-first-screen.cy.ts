import { SEEDED_PRACTITIONER, assertDayGridShows, dateInputValue, openNewAppointmentPanel, yesterday } from '../../support/calendar'

// The checkout on the appointment panel's first screen (CalendarVisitCheckout):
// open the visit, press one button. Clinics arriving from PracticeHub process
// a visit in two clicks there; here it took the whole stage track and then the
// Cobro tab, and they read that as how it had to be done.
//
// Yesterday, for the reason bono-covered-visit.cy.ts gives: a visit that has
// not happened yet is not offered for charging.
const bookedDay = yesterday()

function bookAndOpen(patientName: string, typeName: string) {
  cy.visit('/calendar')
  cy.contains('select', 'Work week').select('day')
  openNewAppointmentPanel()
  cy.get('[data-cy=create-sheet]').within(() => {
    cy.get('[data-cy=create-patient-search]').type(patientName.split(' ')[0])
    cy.contains('[data-cy=create-patient-result]', patientName).click()
    cy.contains('[data-cy=create-type]', typeName).click()
    cy.contains('[data-cy=create-practitioner]', SEEDED_PRACTITIONER).click()
    cy.get('input[type="date"]').clear().type(dateInputValue(bookedDay))
    cy.get('[data-cy=create-submit]').click()
  })
  cy.get('[data-cy=create-sheet]').should('not.exist')
  cy.get('[aria-label="Previous"]').click()
  assertDayGridShows(bookedDay)
  cy.contains(patientName).should('be.visible').click({ force: true })
  cy.get('[data-cy=appt-sheet]').should('be.visible')
}

describe('Charging a visit from the first screen of its panel', () => {
  it('opens with the bono chosen and takes the session in one press', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30, defaultPriceCents: 5500 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Quima', lastName: 'Quickbono' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 8,
          priceCents: 52800,
        }).then((purchase: any) => {
          cy.login(account.email, account.password)
          bookAndOpen('Quima Quickbono', 'Consultation')

          cy.get('[data-cy=appt-sheet]').within(() => {
            // On Resumen, without visiting the Cobro tab.
            cy.get('[data-cy=appt-tab-summary]').should('have.attr', 'aria-selected', 'true')
            cy.get('[data-cy=visit-checkout]').within(() => {
              // The bono, not the walk-in price, is what opens selected.
              cy.get('[data-cy=checkout-bono]').should('have.attr', 'aria-checked', 'true').and('contain.text', 'Bono 12').and('contain.text', '4 left, 3 after this visit')
              cy.get('[data-cy=checkout-money]').should('have.attr', 'aria-checked', 'false')
              cy.get('[data-cy=checkout-process]').should('contain.text', '1 session of Bono 12').click()
            })
            // Charged: the offer goes, and the way back is named for what it does.
            cy.get('[data-cy=visit-checkout]', { timeout: 15000 }).should('not.exist')
            cy.get('[data-cy=undo-visit]').should('contain.text', 'Remove bono')
          })

          cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((eff: any) => {
            expect(eff.purchase.sessions_used, 'one session spent').to.eq(9)
            expect(eff.sessions, 'recorded once').to.have.length(1)
            expect(eff.invoices, 'charged once, at the bono rate').to.have.length(1)
            expect(eff.invoices[0].total_cents).to.eq(4400)
            expect(eff.payments, 'no money taken').to.have.length(0)
            expect(eff.appointments[0].status).to.eq('completed')
          })

          // Taken by mistake: undone, the visit is offered again on the spot,
          // with the session back -- not only after closing and reopening it.
          cy.get('[data-cy=undo-visit]').click()
          cy.get('[data-cy=confirm-dialog-confirm]').click()
          cy.get('[data-cy=visit-checkout]', { timeout: 15000 }).should('be.visible')
          cy.get('[data-cy=checkout-bono]').should('contain.text', '4 left, 3 after this visit')
        })
      })
    })
  })

  it('charges the price instead when "No bono" is chosen, receipt and payment together', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30, defaultPriceCents: 5500 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nilo', lastName: 'Nobono' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 8,
          priceCents: 52800,
        }).then((purchase: any) => {
          cy.login(account.email, account.password)
          bookAndOpen('Nilo Nobono', 'Consultation')

          cy.get('[data-cy=appt-sheet]').within(() => {
            cy.get('[data-cy=visit-checkout]').within(() => {
              cy.get('[data-cy=checkout-money]').click().should('have.attr', 'aria-checked', 'true')
              cy.get('[data-cy=checkout-method]').should('be.visible')
              // cy.contains: formatEur puts a non-breaking space before the €.
              cy.contains('[data-cy=checkout-process]', 'charge 55,00 €').click()
            })
            cy.get('[data-cy=visit-checkout]', { timeout: 15000 }).should('not.exist')
          })

          cy.task('db:paymentsFor', { patientId: patient.id }).then((payments: any) => {
            expect(payments, 'one payment').to.have.length(1)
            expect(payments[0].amount_cents, 'for the whole price').to.eq(5500)
            expect(payments[0].purpose).to.eq('visit')
          })
          cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((eff: any) => {
            expect(eff.purchase.sessions_used, 'the bono is untouched').to.eq(8)
            expect(eff.sessions).to.have.length(0)
            expect(eff.invoices.map((i: any) => i.status), 'one receipt, paid').to.deep.eq(['paid'])
            expect(eff.appointments[0].status).to.eq('completed')
          })
        })
      })
    })
  })
})
