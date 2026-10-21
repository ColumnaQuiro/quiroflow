import type { StaffAccount } from '../../support/commands'
import { seedVisit } from '../../support/calendar'

// Red flags and tags used to live only on the patient's record, so the person
// about to treat them -- or the desk about to book them -- had to open it to
// know. Now the calendar block, its hover card, the visit panel and My Day say
// so. The flags' TEXT is clinical: the front desk (no visit notes) sees that
// there are some, not what they say.

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))

function seed(): Cypress.Chainable<{ account: StaffAccount }> {
  return cy.seedStaffAccount().then((account) => {
    cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
    seedVisit(account, null, 'Rojo', 'Alerta', 10, 0).then(({ patientId }) => {
      cy.task('db:setPatientClinical', { patientId, redFlags: 'No cervical manipulation' })
      cy.task('db:setPatientTags', { patientId, tags: ['VIP', 'Google review'] })
    })
    seedVisit(account, null, 'Sin', 'Nada', 12, 0)
    return cy.wrap({ account })
  })
}

function openDay() {
  cy.visit('/calendar')
  cy.contains('select', 'Work week').select('day')
  cy.contains('[data-cy=appt-block]', 'Rojo Alerta').should('exist')
}

describe('Patient warnings on the calendar', () => {
  it('marks the visit and shows the flags and tags to a clinical role', () => {
    seed().then(({ account }) => {
      cy.login(account.email, account.password)
      openDay()
      cy.contains('[data-cy=appt-block]', 'Rojo Alerta').find('[data-cy=appt-block-red-flags]').should('exist')
      cy.contains('[data-cy=appt-block]', 'Sin Nada').find('[data-cy=appt-block-red-flags]').should('not.exist')

      cy.contains('[data-cy=appt-block]', 'Rojo Alerta').click()
      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.get('[data-cy=appt-panel-red-flags]').should('contain.text', 'No cervical manipulation')
        cy.get('[data-cy=appt-panel-tags]').should('contain.text', 'VIP').and('contain.text', 'Google review')
      })

      cy.visit('/practitioner')
      cy.get('[data-cy=worklist-red-flags]', { timeout: 15000 }).should('have.length', 1).and('have.attr', 'title').and('contain', 'No cervical manipulation')
    })
  })

  it('tells the front desk there are flags without showing what they say', () => {
    seed().then(({ account }) => {
      const email = `desk-${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: 'Password123!', fullName: 'Desk Person' })
      cy.login(email, 'Password123!')
      openDay()
      cy.contains('[data-cy=appt-block]', 'Rojo Alerta').find('[data-cy=appt-block-red-flags]').should('exist').click()
      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.get('[data-cy=appt-panel-red-flags]').should('contain.text', 'Let the practitioner know').and('not.contain.text', 'No cervical manipulation')
        cy.get('[data-cy=appt-panel-tags]').should('contain.text', 'VIP')
      })
    })
  })
})
