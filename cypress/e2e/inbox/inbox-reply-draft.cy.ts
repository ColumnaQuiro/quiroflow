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

  // Written by the tick without anyone asking (inbox_reply_drafts): there as
  // soon as the thread opens, and once thrown away, marked so the tick does
  // not write it again and it does not come back.
  it('shows a draft the receptionist left, and a discarded one stays gone', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Iris', lastName: 'Esperando' }).then((patient) => {
        cy.task('db:createPatientAppMessage', { accountId: account.accountId, patientId: patient.id, direction: 'inbound', body: '¿Podéis cambiarme la cita?' })
        const waiting = 'Claro, ¿te viene bien el jueves 15 de octubre a las 17:00 con tu quiropráctica?'
        cy.task('db:createStoredReplyDraft', { accountId: account.accountId, patientId: patient.id, body: waiting })

        cy.login(account.email, account.password)
        cy.visit('/inbox')
        cy.contains('Iris Esperando').click()
        cy.get('[data-cy=reply-draft-text]').should('have.text', waiting)

        cy.get('[data-cy=reply-draft-discard]').click()
        cy.get('[data-cy=reply-draft-text]').should('not.exist')
        // Marked in the background: polled, rather than read once and raced.
        const dismissed = (tries = 20): Cypress.Chainable<{ dismissed_at: string | null } | null> =>
          cy.task<{ dismissed_at: string | null } | null>('db:storedReplyDraft', { patientId: patient.id }).then((row) =>
            row?.dismissed_at || tries <= 0 ? cy.wrap(row) : cy.wait(250).then(() => dismissed(tries - 1)),
          )
        dismissed().its('dismissed_at').should('not.be.null')

        cy.reload()
        cy.contains('Iris Esperando').click()
        cy.contains('¿Podéis cambiarme la cita?').should('be.visible')
        cy.get('[data-cy=reply-draft-ask]').should('be.visible')
        cy.get('[data-cy=reply-draft-text]').should('not.exist')
      })
    })
  })

  // Answered on its own (receptionist-draft-cron): labelled, so nobody takes
  // it for a colleague's reply.
  it("labels the receptionist's own replies", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Atendida' }).then((patient) => {
        cy.task('db:createPatientAppMessage', { accountId: account.accountId, patientId: patient.id, direction: 'inbound', body: '¿Abrís el sábado?' })
        cy.task('db:createPatientAppMessage', { accountId: account.accountId, patientId: patient.id, direction: 'outbound', body: 'Los sábados estamos cerrados.', sentByAi: true })
        cy.task('db:createPatientAppMessage', { accountId: account.accountId, patientId: patient.id, direction: 'outbound', body: 'Te esperamos el lunes.' })

        cy.login(account.email, account.password)
        cy.visit('/inbox')
        cy.contains('Olga Atendida').click()
        cy.get('[data-cy="thread-message"]').filter(':contains("Los sábados estamos cerrados.")').find('[data-cy="thread-message-ai"]').should('be.visible')
        cy.get('[data-cy="thread-message"]').filter(':contains("Te esperamos el lunes.")').find('[data-cy="thread-message-ai"]').should('not.exist')
      })
    })
  })
})
