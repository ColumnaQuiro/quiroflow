// Switching conversation in the Inbox left the previous person's messages on
// screen, under the new person's name, until the new ones arrived -- which
// read as the Inbox being slow to change conversation. The new thread's
// messages are held back here so that window is always open, instead of
// depending on how fast the database answers.
describe('Inbox: switching conversations', () => {
  it("never shows one person's messages under another's name, and reopens a conversation at once", () => {
    cy.seedStaffAccount().then((account) => {
      const create = (firstName: string, lastName: string, body: string) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName }).then((patient) => {
          cy.task('db:createPatientAppMessage', { accountId: account.accountId, patientId: patient.id, direction: 'inbound', body })
          return cy.wrap(patient.id)
        })

      create('Ana', 'Alonso', 'Mensaje solo de Ana').then((anaId) => {
        create('Bruno', 'Benítez', 'Mensaje solo de Bruno').then((brunoId) => {
          // Each person's in-app messages, held for a few seconds when asked for.
          const holdThread = (patientId: string, alias: string) =>
            cy
              .intercept({ method: 'GET', url: new RegExp(`/rest/v1/patient_app_messages\\?.*patient_id=eq\\.${patientId}`) }, (req) => {
                req.continue((res) => {
                  res.setDelay(3000)
                })
              })
              .as(alias)

          cy.login(account.email, account.password)
          cy.visit('/inbox')
          cy.get('[data-cy="inbox-row"]').contains('Ana Alonso').click()
          cy.contains('[data-cy="thread-message"]', 'Mensaje solo de Ana').should('be.visible')

          // Bruno's thread is slow to arrive. Until it does, the thread shows a
          // placeholder -- not Ana's messages -- and nothing can be sent. (Each
          // person's last message is also their row's preview in the list,
          // so these look inside the thread.)
          holdThread(brunoId, 'bruno')
          cy.get('[data-cy="inbox-row"]').contains('Bruno Benítez').click()
          cy.get('[data-cy="thread-loading"]').should('be.visible')
          cy.contains('[data-cy="thread-message"]', 'Mensaje solo de Ana').should('not.exist')
          cy.get('[data-cy="thread-send"]').should('be.disabled')
          cy.wait('@bruno')
          cy.contains('[data-cy="thread-message"]', 'Mensaje solo de Bruno').should('be.visible')
          cy.get('[data-cy="thread-loading"]').should('not.exist')

          // Back to Ana: her messages are on screen straight away, well before
          // the refresh behind them comes back.
          holdThread(anaId, 'ana')
          cy.get('[data-cy="inbox-row"]').contains('Ana Alonso').click()
          cy.contains('[data-cy="thread-message"]', 'Mensaje solo de Ana', { timeout: 1000 }).should('be.visible')
          cy.contains('[data-cy="thread-message"]', 'Mensaje solo de Bruno').should('not.exist')
          cy.get('[data-cy="thread-loading"]').should('not.exist')
          cy.wait('@ana')
          cy.contains('[data-cy="thread-message"]', 'Mensaje solo de Ana').should('be.visible')
        })
      })
    })
  })
})
