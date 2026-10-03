// A reply sent from the Inbox showed twice for a moment -- the clock bubble
// and the real message with its tick -- and then jumped as the bubble went
// away. The thread reloads with the real row before the bubble is dropped;
// here the conversation list is held back so that window is always open,
// instead of depending on how fast the database answers.
describe('Inbox: a sent reply', () => {
  it('shows once, and the clock turns into a tick in place', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paula', lastName: 'Prieto' }).then((patient) => {
        cy.task('db:createPatientAppMessage', { accountId: account.accountId, patientId: patient.id, direction: 'inbound', body: '¿Puedo cambiar la cita del jueves?' })

        cy.login(account.email, account.password)
        cy.visit('/inbox')
        cy.contains('Paula Prieto').click()
        cy.contains('¿Puedo cambiar la cita del jueves?').should('be.visible')

        // Only from here on: the list's own load must not be slowed.
        cy.intercept({ method: 'GET', url: /\/rest\/v1\/inbox_conversations\?/ }, (req) => {
          // The counts ask for conversation_key only; the list asks for every column.
          if (!/select=(\*|%2A)/.test(req.url)) return
          req.continue((res) => {
            res.setDelay(6000)
          })
        }).as('list')
        cy.intercept({ method: 'GET', url: /\/rest\/v1\/patient_app_messages\?/ }).as('threadReload')

        const reply = 'Claro, ¿te va bien el viernes a las 10?'
        cy.get('textarea[placeholder="Type a message…"]').type(reply)
        cy.get('[data-cy="thread-send"]').click()
        const bubble = () => cy.get('[data-cy="thread-message"]').filter(`:contains("${reply}")`)
        let shownOnSend: HTMLElement
        bubble().should('have.length', 1).then(($el) => (shownOnSend = $el[0]!))

        // The thread has reloaded with the real row while the list is still
        // loading, which is exactly when the bubble used to sit beside it.
        cy.wait('@threadReload')
        bubble().should('have.length', 1)
        bubble().find('[data-status="sent"]').should('exist')
        cy.get('[data-status="pending"]').should('not.exist')

        // And once everything has loaded it is still the element that appeared
        // on Send: patched in place, never swapped for a new one -- the swap
        // is what made the thread jump.
        cy.wait('@list')
        bubble().should('have.length', 1).then(($el) => expect($el[0]).to.equal(shownOnSend))
      })
    })
  })
})
