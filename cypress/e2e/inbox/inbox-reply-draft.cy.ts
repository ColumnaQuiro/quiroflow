// "Draft a reply" in a patient's conversation (components/inbox/ReplyDraft.vue):
// offered when the patient wrote last, the suggestion waits above the message
// bar, and Send sends it the way a typed reply goes. The model is stubbed --
// what it is told is unit-tested (tests/unit/patient-reply-draft.test.ts).
describe('Inbox: reply drafts for patients', () => {
  it('drafts, sends in one tap, and takes a draft into the box to edit', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Borrador' }).then((patient) => {
        cy.task('db:createPatientAppMessage', { accountId: account.accountId, patientId: patient.id, direction: 'inbound', body: '¿Cuándo es mi próxima cita?' })
        const suggestion = 'Tu próxima cita es el martes 13 de octubre a las 10:00.'
        cy.intercept('POST', `/api/inbox/patients/${patient.id}/draft-reply`, { available: true, draft: suggestion }).as('draft')

        cy.login(account.email, account.password)
        cy.visit('/inbox')
        cy.contains('Nora Borrador').click()
        cy.contains('¿Cuándo es mi próxima cita?').should('be.visible')

        cy.get('[data-cy=reply-draft-ask]').click()
        cy.wait('@draft')
        cy.get('[data-cy=reply-draft-text]').should('have.text', suggestion)
        // Edit: into the box, to change before sending.
        cy.get('[data-cy=reply-draft-edit]').click()
        cy.get('textarea[placeholder="Type a message…"]').should('have.value', suggestion).clear()

        // Again, and this time sent as it is.
        cy.get('[data-cy=reply-draft-ask]').click()
        cy.wait('@draft')
        cy.get('[data-cy=reply-draft-send]').click()
        cy.get('[data-cy="thread-message"]').filter(`:contains("${suggestion}")`).should('have.length', 1)
        // We wrote last now: nothing to answer, so nothing offered.
        cy.get('[data-cy=reply-draft]').should('not.exist')
      })
    })
  })

  it('is not offered when the clinic wrote last', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Leo', lastName: 'Contestado' }).then((patient) => {
        cy.task('db:createPatientAppMessage', { accountId: account.accountId, patientId: patient.id, direction: 'inbound', body: 'Gracias' })
        cy.task('db:createPatientAppMessage', { accountId: account.accountId, patientId: patient.id, direction: 'outbound', body: 'A ti' })
        cy.login(account.email, account.password)
        cy.visit('/inbox')
        cy.contains('Leo Contestado').click()
        cy.contains('A ti').should('be.visible')
        cy.get('[data-cy=reply-draft]').should('not.exist')
      })
    })
  })
})
