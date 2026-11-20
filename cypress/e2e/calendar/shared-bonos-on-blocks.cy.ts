import type { StaffAccount } from '../../support/commands'
import { seedVisit } from '../../support/calendar'

// A bono SHARED with a patient (package_purchase_shares -- a parent's bono a
// child draws from) is theirs to use as much as one of their own, and the
// checkout offers it. The calendar's block and hover card read the bonos from
// calendar_range_details, which returned the patient's own only, so a child
// whose only bono is the family one showed none at all; and a patient with
// two live bonos had one named although the checkout asks which.
//
// Today, at times well inside the seeded hours, so the day view shows them all.

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))

function block(name: string) {
  return cy.contains('[data-cy=appt-block]', name)
}

function hover(name: string) {
  block(name).trigger('pointerenter', { pointerType: 'mouse' })
  return cy.get('[data-cy=appt-hover]').should('contain.text', name)
}

function leave(name: string) {
  block(name).trigger('pointerleave', { pointerType: 'mouse' })
  cy.get('[data-cy=appt-hover]').should('not.exist')
}

describe('Bonos shared with a patient, on the calendar', () => {
  it('counts a family bono on the block and the hover card, and names none when there are two', () => {
    cy.seedStaffAccount().then((account: StaffAccount) => {
      cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 1' }).then((room) => {
        cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
        // The owner of the family bono, with no visit of their own today.
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pablo', lastName: 'Familia' }).then((owner) => {
          cy.task<{ id: string }>('db:createPackagePurchase', { accountId: account.accountId, patientId: owner.id, packageName: 'Bono Familia 10', sessionsTotal: 10, sessionsUsed: 4, priceCents: 40000 }).then((family) => {
            // A closed family bono, shared too: history, not something to draw from.
            cy.task<{ id: string }>('db:createPackagePurchase', { accountId: account.accountId, patientId: owner.id, packageName: 'Bono Viejo 5', sessionsTotal: 5, sessionsUsed: 2, priceCents: 20000, isClosed: true }).then((closed) => {
              // Only the family bono: it is named, with its count.
              seedVisit(account, room.id, 'Lucía', 'Familia', 10, 0).then(({ patientId }) => {
                cy.task('db:sharePackageWith', { accountId: account.accountId, packagePurchaseId: family.id, patientId })
                cy.task('db:sharePackageWith', { accountId: account.accountId, packagePurchaseId: closed.id, patientId })
              })
              // Their own bono AND the family one: the checkout asks which, so the calendar names neither.
              seedVisit(account, room.id, 'Marta', 'Doble', 12, 0).then(({ patientId }) => {
                cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId, packageName: 'Bono Marta 5', sessionsTotal: 5, sessionsUsed: 1, priceCents: 20000 })
                cy.task('db:sharePackageWith', { accountId: account.accountId, packagePurchaseId: family.id, patientId })
              })
              // Their own bono only: as before.
              seedVisit(account, room.id, 'Sergio', 'Propio', 14, 0).then(({ patientId }) => {
                cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId, packageName: 'Bono Sergio 10', sessionsTotal: 10, sessionsUsed: 9, priceCents: 40000 })
              })
            })
          })
        })

        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')

        block('Lucía Familia').find('[data-cy=appt-block-bono]').should('have.text', 'Bono 6/10')
        hover('Lucía Familia').find('[data-cy=appt-hover-bono]').should('contain.text', 'Bono Familia 10').and('contain.text', '6 left')
        leave('Lucía Familia')

        block('Marta Doble').find('[data-cy=appt-block-bono]').should('have.text', '2 bonos')
        hover('Marta Doble')
          .find('[data-cy=appt-hover-bono]')
          .should('contain.text', '2 bonos')
          .and('contain.text', 'choose which one at checkout')
          .and('not.contain.text', 'Bono Marta 5')
          .and('not.contain.text', 'Bono Familia 10')
        leave('Marta Doble')

        block('Sergio Propio').find('[data-cy=appt-block-bono]').should('have.text', 'Bono 1/10')
        hover('Sergio Propio').find('[data-cy=appt-hover-bono]').should('contain.text', 'Bono Sergio 10').and('contain.text', '1 left')
        leave('Sergio Propio')

        // The practitioner's day loads one visit on its own (appointment_panel)
        // and reads the shared bono the same way.
        cy.visit('/practitioner')
        // The details button shows on hover or keyboard focus; Cypress's pointer is neither.
        cy.contains('li', 'Lucía Familia').find('[data-cy=practitioner-open-appointment]').click({ force: true })
        cy.get('[data-cy=appt-sheet]').find('[data-cy=visit-money]').should('contain.text', 'Bono Familia 10').and('contain.text', '6 of 10 left')
      })
    })
  })
})
