import { todayAt } from '../../support/calendar'

// The patient's completed forms sit beside today's note on My Day, and an
// answer -- or the whole form -- comes into Subjective with a tap, instead of
// being retyped from the intake form. Answers already on the record (name,
// DNI...) and blocks that are not answers are left out.

describe('Form answers on My Day', () => {
  it('shows the intake answers and brings them into Subjective', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Forma', lastName: 'Rellena' }).then((patient) => {
        cy.task('db:createPatientDoc', {
          accountId: account.accountId,
          patientId: patient.id,
          title: 'First visit form',
          completed: true,
          fields: [
            { id: 'h', type: 'heading', label: 'About you' },
            { id: 'n', type: 'short_text', label: 'First name', value: 'Forma', patientField: 'first_name' },
            { id: 'w', type: 'long_text', label: 'Where does it hurt?', value: 'Lower back, left side' },
            { id: 'p', type: 'scale', label: 'Pain today', value: 7 },
          ],
        })
        // Not completed yet: not shown.
        cy.task('db:createPatientDoc', { accountId: account.accountId, patientId: patient.id, title: 'Consent', fields: [{ id: 'c', type: 'checkbox', label: 'I agree', value: true }] })
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: todayAt(10, 0) })

        cy.intercept({ url: '**/rest/v1/visit_notes*', method: /^(POST|PATCH)$/ }).as('noteSave')
        cy.login(account.email, account.password)
        cy.visit('/practitioner')
        cy.contains('li:not([data-cy=needs-confirming-row])', 'Forma Rellena', { timeout: 20000 }).click()

        cy.get('[data-cy=form-answers-doc]').should('have.length', 1).and('contain.text', 'First visit form')
        cy.get('[data-cy=form-answer]').should('have.length', 2)
        cy.get('[data-cy=form-answers]').should('not.contain.text', 'First name').and('not.contain.text', 'I agree')

        cy.contains('[data-cy=form-answer]', 'Pain today').find('[data-cy=form-answer-bring]').click()
        cy.get('[data-cy=soap-subjective]').should('have.value', 'Pain today: 7/10')
        cy.get('[data-cy=form-answers-bring-all]').click()
        cy.get('[data-cy=soap-subjective]').invoke('val').should('contain', 'Where does it hurt?: Lower back, left side')
      })
    })
  })
})
