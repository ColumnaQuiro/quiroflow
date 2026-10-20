import type { StaffAccount } from '../../support/commands'
import { seedVisit, todayAt } from '../../support/calendar'

// The justificante de asistencia: the paper a patient asks for at the desk to
// show their employer or school they were here. It may only ever certify a
// visit that took place, so the server refuses the rest, and the panel only
// offers it once the patient has arrived.

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))

function seed(): Cypress.Chainable<{ account: StaffAccount; attended: string; future: string; cancelled: string }> {
  return cy.seedStaffAccount().then((account) => {
    cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
    return seedVisit(account, null, 'Vino', 'Hoy', 10, 0, { status: 'completed', checkedInAt: todayAt(9, 58) }).then((attended) =>
      seedVisit(account, null, 'Aun', 'Noviene', 12, 0).then((future) =>
        seedVisit(account, null, 'Cancelo', 'Antes', 14, 0, { status: 'cancelled' }).then((cancelled) =>
          cy.wrap({ account, attended: attended.appointmentId, future: future.appointmentId, cancelled: cancelled.appointmentId }),
        ),
      ),
    )
  })
}

describe('Certificate of attendance', () => {
  it('is a PDF for a visit that took place, and refused for one that did not', () => {
    seed().then(({ account, attended, future, cancelled }) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.request({ url: `/api/appointments/${attended}/attendance-certificate`, encoding: 'binary' }).then((res) => {
        expect(res.status).to.eq(200)
        expect(res.headers['content-type']).to.contain('application/pdf')
        expect(res.body.slice(0, 5)).to.eq('%PDF-')
      })
      for (const id of [future, cancelled]) {
        cy.request({ url: `/api/appointments/${id}/attendance-certificate`, failOnStatusCode: false }).then((res) => {
          expect(res.status).to.eq(409)
          expect(res.body.statusMessage).to.eq('Only a visit that took place has a certificate of attendance.')
        })
      }
    })
  })

  it('is offered on the visit panel once the patient has arrived', () => {
    seed().then(({ account }) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      cy.contains('[data-cy=appt-block]', 'Aun Noviene').click()
      cy.get('[data-cy=appt-sheet]').should('be.visible').find('[data-cy=attendance-certificate]').should('not.exist')
      cy.get('body').type('{esc}')

      cy.intercept('GET', '/api/appointments/*/attendance-certificate').as('certificate')
      cy.contains('[data-cy=appt-block]', 'Vino Hoy').click()
      cy.get('[data-cy=appt-sheet]').find('[data-cy=attendance-certificate]').click()
      cy.wait('@certificate').its('response.statusCode').should('eq', 200)
    })
  })
})
