import { todayAt } from '../../support/calendar'

// A clinic with no rooms has one column a day. It used to be headed
// "Unassigned" -- in the day view and under every day of the week -- which
// read as "these visits are missing something", when there was nothing to
// assign them to. A clinic with two practitioners and one open treatment room
// made a room per practitioner to get rid of it. With no rooms the column has
// no heading at all.

describe('Calendar of a clinic with no rooms', () => {
  it('draws no "Unassigned" column heading, in the week or the day', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:deleteRooms', { clinicId: account.clinicId })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Sinsala' }).then((p) =>
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: todayAt(10), roomId: null }),
      )

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('Sinsala').should('be.visible')
      cy.get('[data-cy=grid-scroller]').should('not.contain.text', 'Unassigned')

      cy.contains('select', 'Work week').select('day')
      cy.contains('Sinsala').should('be.visible')
      cy.get('[data-cy=day-column-head]').should('not.exist')
    })
  })
})
