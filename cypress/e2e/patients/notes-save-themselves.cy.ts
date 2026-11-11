import { todayAt } from '../../support/calendar'

// A visit note is saved as it is typed. Each screen that writes one used to
// wait for a button -- "Add note", "Save note", "Save" -- and a note typed and
// then left (the dialog closed, the next patient opened) was lost. Nothing in
// these tests presses a save button.
describe('Visit notes save themselves', () => {
  function pastVisit(account: any, firstName: string) {
    return cy
      .task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Autoguardado' })
      .then((patient: any) =>
        cy
          .task('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            startsAt: new Date(Date.now() - 3600000).toISOString(),
            status: 'completed',
          })
          .then((appt: any) => ({ patient, appt })),
      )
  }

  it('keeps a note typed in the dialog and closed without "Add note"', () => {
    cy.seedStaffAccount().then((account) => {
      pastVisit(account, 'Nadia').then(({ patient, appt }) => {
        cy.intercept({ url: '**/rest/v1/visit_notes*', method: /^(POST|PATCH)$/ }).as('noteSave')
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)

        cy.contains('button', 'Add note').click()
        cy.get('[data-cy=notes-dialog]').within(() => {
          cy.get('[data-cy=new-visit-note]').type('Refiere dolor lumbar al levantarse.')
          cy.get('[data-cy=note-save-status]').should('have.text', 'Saved')
        })
        cy.get('body').type('{esc}')
        cy.get('[data-cy=notes-dialog]').should('not.exist')

        cy.task<{ body: string }[]>('db:selectRows', { table: 'visit_notes', columns: 'body', match: { appointment_id: appt.id } }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]!.body).to.eq('Refiere dolor lumbar al levantarse.')
        })

        // Reopened, it is a note like any other, and the box is empty for the next.
        cy.contains('button', 'Add note').click()
        cy.get('[data-cy=notes-dialog]').within(() => {
          cy.contains('li', 'Refiere dolor lumbar al levantarse.').should('be.visible')
          cy.get('[data-cy=new-visit-note]').should('have.value', '')
        })
      })
    })
  })

  it('saves what was typed when the dialog closes before the pause', () => {
    cy.seedStaffAccount().then((account) => {
      pastVisit(account, 'Teo').then(({ patient, appt }) => {
        cy.intercept({ url: '**/rest/v1/visit_notes*', method: /^(POST|PATCH)$/ }).as('noteSave')
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)

        cy.contains('button', 'Add note').click()
        cy.get('[data-cy=new-visit-note]').type('Mejor', { delay: 0 })
        // Closed at once: no time for the save that follows a pause.
        cy.get('body').type('{esc}')
        cy.wait('@noteSave')
        cy.task<{ body: string }[]>('db:selectRows', { table: 'visit_notes', columns: 'body', match: { appointment_id: appt.id } }).its('0.body').should('eq', 'Mejor')
      })
    })
  })

  it('keeps a correction made with the pencil and never confirmed', () => {
    cy.seedStaffAccount().then((account) => {
      pastVisit(account, 'Lola').then(({ patient, appt }) => {
        cy.task('db:addVisitNote', { accountId: account.accountId, appointmentId: appt.id, body: 'Cervicalgia desde mayo.' })
        cy.intercept({ url: '**/rest/v1/visit_notes*', method: 'PATCH' }).as('noteUpdate')
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)

        cy.contains('button', 'Add note').click()
        cy.get('[data-cy=notes-dialog]').within(() => {
          cy.get('button[aria-label="Edit"]').click()
          cy.get('li textarea').clear().type('Cervicalgia desde marzo.')
          cy.get('[data-cy=note-save-status]').should('have.text', 'Saved')
        })
        cy.get('body').type('{esc}')

        cy.task<{ body: string }[]>('db:selectRows', { table: 'visit_notes', columns: 'body', match: { appointment_id: appt.id } }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]!.body).to.eq('Cervicalgia desde marzo.')
        })
      })
    })
  })

  it('saves the My Day note as it is typed, without "Save note"', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruno', lastName: 'Autoguardado' }).then((patient) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: todayAt(10, 0) }).then((today) => {
          cy.intercept({ url: '**/rest/v1/visit_notes*', method: /^(POST|PATCH)$/ }).as('noteSave')
          cy.login(account.email, account.password)
          cy.visit('/practitioner')
          cy.contains('li:not([data-cy=needs-confirming-row])', 'Bruno Autoguardado', { timeout: 20000 }).click()

          cy.get('[data-cy=soap-subjective]').type('Dolor 4/10.')
          cy.get('[data-cy=myday-today] [data-cy=note-save-status]').should('have.text', 'Saved')
          cy.get('[data-cy=soap-plan]').type('Revisar en 1 semana.')
          cy.get('[data-cy=myday-today] [data-cy=note-save-status]').should('have.text', 'Saved')

          cy.task<{ body: string }[]>('db:selectRows', { table: 'visit_notes', columns: 'body', match: { appointment_id: today.id } }).then((rows) => {
            // One note, updated -- not one per save.
            expect(rows).to.have.length(1)
            expect(rows[0]!.body).to.include('Dolor 4/10.')
            expect(rows[0]!.body).to.include('Revisar en 1 semana.')
          })
        })
      })
    })
  })
})
