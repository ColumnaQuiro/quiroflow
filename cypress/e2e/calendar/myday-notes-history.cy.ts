import { todayAt } from '../../support/calendar'

// My Day's History tab: every earlier note under its S / O / A / P headings
// rather than as text with "Subjective:" inside it, and the note's Edit and
// Delete in its header -- always shown, never over the note, and on a touch
// screen too, where the hover that used to reveal them never happens.

const NOTE = 'Subjective: Pain 3/10, better than last week.\n\nObjective: Restricted L5.\n\nAction: Adjusted L5.\n\nPlan: Weekly, reassess at visit 6.'
const FREE_TEXT = 'Short review. Much better, no pain at rest.'

function daysAgo(n: number) {
  const d = new Date(todayAt(10, 0))
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

describe('My Day notes history', () => {
  it('reads a note by its sections, corrects one section, and deletes only after asking', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Historial' }).then((patient) => {
        const visit = (startsAt: string, status?: string) =>
          cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt, ...(status ? { status } : {}) })
        visit(daysAgo(7), 'completed').then((prev) => {
          cy.task('db:addVisitNote', { accountId: account.accountId, appointmentId: prev.id, body: NOTE })
          visit(daysAgo(14), 'completed').then((older) => {
            cy.task('db:addVisitNote', { accountId: account.accountId, appointmentId: older.id, body: FREE_TEXT })
            visit(todayAt(10, 0)).then(() => {
              cy.intercept({ url: '**/rest/v1/visit_notes*', method: 'PATCH' }).as('noteUpdate')
              cy.login(account.email, account.password)
              cy.visit('/practitioner')
              cy.contains('li:not([data-cy=needs-confirming-row])', 'Olga Historial', { timeout: 20000 }).click()
              cy.get('[data-cy=myday-tab-history]').click()

              cy.get('[data-cy=note-history-item]', { timeout: 20000 }).should('have.length', 2)
              cy.get('[data-cy=note-history-item]').first().within(() => {
                // Headings, in order, and the text without its label.
                cy.get('[data-cy=note-section]').then(($s) => {
                  expect([...$s].map((el) => el.dataset.section)).to.deep.equal(['Subjective', 'Objective', 'Action', 'Plan'])
                })
                cy.contains('dt', 'Subjective').should('be.visible')
                cy.get('[data-section=Plan] dd').should('have.text', 'Weekly, reassess at visit 6.')
                cy.contains('Subjective:').should('not.exist')
                // The actions are there without hovering.
                cy.get('[data-cy=note-history-edit]').should('be.visible')
                cy.get('[data-cy=note-history-delete]').should('be.visible')
              })
              // A note written as free text is shown as itself, under one heading.
              cy.get('[data-cy=note-history-item]').eq(1).should('contain', FREE_TEXT).find('dt').should('have.length', 1)

              // Corrected section by section, and saved in the charting pane's shape.
              cy.get('[data-cy=note-history-item]').first().within(() => {
                cy.get('[data-cy=note-history-edit]').click()
                cy.get('[data-cy=note-history-edit-Plan]').should('have.value', 'Weekly, reassess at visit 6.').clear().type('Every two weeks.', { delay: 0 })
                cy.wait('@noteUpdate')
                cy.get('[data-cy=note-save-status]').should('have.text', 'Saved')
                cy.get('[data-cy=note-history-save]').click()
                cy.get('[data-section=Plan] dd').should('have.text', 'Every two weeks.')
              })
              cy.task<{ body: string }[]>('db:selectRows', { table: 'visit_notes', columns: 'body', match: { appointment_id: prev.id } }).then((rows) => {
                expect(rows).to.have.length(1)
                expect(rows[0]!.body).to.eq('Subjective: Pain 3/10, better than last week.\n\nObjective: Restricted L5.\n\nAction: Adjusted L5.\n\nPlan: Every two weeks.')
              })

              // Delete asks first, naming the visit, and Cancel keeps the note.
              cy.get('[data-cy=note-history-item]').first().find('[data-cy=note-history-delete]').click()
              cy.contains('Delete this note?').should('be.visible')
              cy.contains('will be deleted').should('be.visible')
              cy.contains('button', 'Cancel').click()
              cy.get('[data-cy=note-history-item]').should('have.length', 2)
              cy.get('[data-cy=note-history-item]').first().find('[data-cy=note-history-delete]').click()
              cy.contains('Delete this note?').parents('[role=dialog], [role=alertdialog]').first().contains('button', 'Delete note').click()
              cy.get('[data-cy=note-history-item]').should('have.length', 1).and('contain', FREE_TEXT)
            })
          })
        })
      })
    })
  })
})
