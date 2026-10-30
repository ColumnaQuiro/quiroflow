import { todayAt } from '../../support/calendar'

// My Day opens on the day's visits. The clock card, low stock, every open
// task and "Needs confirming" used to come first, and an automation can raise
// twenty tasks at once, so the first patient sat screens down. The visits now
// lead, the tasks follow them cut to three, and what is hidden is still counted.

describe('My Day leads with the visits', () => {
  it('shows the visit above the tasks, and three tasks until asked for all', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Iris', lastName: 'Molina' }).then((patient) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: todayAt(10, 0) })
      })
      for (let i = 0; i < 4; i++) cy.task('db:createHandoverTask', { accountId: account.accountId, title: 'Llamar para reprogramar' })
      cy.task('db:createHandoverTask', { accountId: account.accountId, title: 'Enviar presupuesto' })

      cy.login(account.email, account.password)
      cy.visit('/practitioner')

      cy.contains('li:not([data-cy=needs-confirming-row])', 'Iris Molina', { timeout: 20000 }).then(($visit) => {
        cy.get('[data-cy=my-day-tasks]').then(($tasks) => {
          expect($visit[0]!.getBoundingClientRect().top).to.be.lessThan($tasks[0]!.getBoundingClientRect().top)
        })
      })

      cy.get('[data-cy=my-day-task]').should('have.length', 3)
      cy.get('[data-cy=my-day-tasks-more]').should('have.text', 'Show all 5').and('have.attr', 'aria-expanded', 'false')
      // The two hidden are still counted, by title.
      cy.contains('[data-cy=my-day-tasks] span', /^Also .*«(Llamar para reprogramar|Enviar presupuesto)»/).should('be.visible')

      cy.get('[data-cy=my-day-tasks-more]').click()
      cy.get('[data-cy=my-day-task]').should('have.length', 5)
      cy.get('[data-cy=my-day-tasks-more]').should('have.text', 'Show fewer')
    })
  })
})
