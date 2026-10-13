import { todayAt } from '../../support/calendar'

// My Day charts a visit in one place: today's note with its listing beside it
// (what is tapped there is written into Action as "Adjusted: …"), and the
// previous visit alongside, with "Bring over" per section and "Use today" for
// its listing. Reopening the visit loads the note already written for it
// rather than starting a second one.

const PREVIOUS_NOTE = 'Subjective: Pain 6/10, worse sitting.\n\nObjective: Restricted L5.\n\nAction: Adjusted L5.\n\nPlan: Weekly plan, reassess at visit 6.'

describe('My Day visit notes', () => {
  it('writes the listing into the note, brings over the last visit, and reopens the same note', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Iris', lastName: 'Molina' }).then((patient) => {
        const lastWeek = new Date(todayAt(10, 0))
        lastWeek.setDate(lastWeek.getDate() - 7)
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: lastWeek.toISOString(), status: 'completed' }).then((prev) => {
          cy.task('db:addVisitNote', { accountId: account.accountId, appointmentId: prev.id, body: PREVIOUS_NOTE })
          cy.task('db:insertRows', { table: 'visit_listings', rows: [{ account_id: account.accountId, appointment_id: prev.id, listings: { Sacrum: 'R', L5: 'B' } }] })
        })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: todayAt(10, 0) }).then((today) => {
          cy.intercept({ url: '**/rest/v1/visit_notes*', method: /^(POST|PATCH)$/ }).as('noteSave')
          cy.login(account.email, account.password)
          cy.visit('/practitioner')
          cy.contains('li', 'Iris Molina', { timeout: 20000 }).click()

          cy.get('[data-cy=previous-visit-listing]').should('contain', 'L5 L/R · Sacrum R')
          cy.get('[data-cy=previous-visit-section]').should('have.length', 4)

          // Tapping a segment writes it into Action, and the note saves itself.
          cy.get('[data-cy=myday-today] [data-cy="listing-C5"] [data-cy="listing-R"]').click()
          cy.get('[data-cy=soap-action]').should('have.value', 'Adjusted: C5 R')
          cy.wait('@noteSave')

          // A section of the last visit, brought into today's.
          cy.get('[data-cy=previous-visit-bring-Plan]').click()
          cy.get('[data-cy=soap-plan]').should('have.value', 'Weekly plan, reassess at visit 6.')
          cy.wait('@noteSave')

          // Its listing, used today: the Action line follows it.
          cy.get('[data-cy=previous-visit-use-listing]').click()
          cy.get('[data-cy=soap-action]').should('have.value', 'Adjusted: L5 L/R · Sacrum R')
          cy.wait('@noteSave')
          cy.task<{ listings: Record<string, string> }[]>('db:selectRows', { table: 'visit_listings', columns: 'listings', match: { appointment_id: today.id } })
            .its('0.listings').should('deep.equal', { Sacrum: 'R', L5: 'B' })

          // Reopened, it is the same note -- not a second one -- and the
          // worklist shows what was adjusted.
          cy.reload()
          cy.get('[data-cy=worklist-listing]', { timeout: 20000 }).should('have.text', 'L5 L/R · Sacrum R')
          cy.contains('li', 'Iris Molina').click()
          cy.get('[data-cy=soap-action]').should('have.value', 'Adjusted: L5 L/R · Sacrum R')
          cy.get('[data-cy=soap-plan]').should('have.value', 'Weekly plan, reassess at visit 6.')
          cy.get('[data-cy=soap-subjective]').type('Pain 3/10.')
          cy.get('[data-cy=myday-sign]').click()
          cy.wait('@noteSave')
          cy.task<{ body: string }[]>('db:selectRows', { table: 'visit_notes', columns: 'body', match: { appointment_id: today.id } }).then((rows) => {
            expect(rows).to.have.length(1)
            expect(rows[0]!.body).to.include('Pain 3/10.')
            expect(rows[0]!.body).to.include('Adjusted: L5 L/R · Sacrum R')
            expect(rows[0]!.body).to.include('Weekly plan, reassess at visit 6.')
          })
        })
      })
    })
  })
})
