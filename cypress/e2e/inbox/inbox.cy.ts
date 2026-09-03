describe('WhatsApp Inbox', () => {
  it('starts a new conversation with a patient who has no WhatsApp history', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nadia', lastName: 'Novak' }).then(() => {
        cy.login(account.email, account.password)
        cy.visit('/inbox')

        cy.contains('No conversations yet.').should('be.visible')

        cy.clickUntil('button:contains("+ New")', 'input[placeholder="Search patients…"]')
        cy.get('input[placeholder="Search patients…"]').type('Nadia')
        cy.contains('li', 'Nadia Novak').click()

        cy.contains('WhatsApp').should('be.visible')
        cy.contains("Nadia Novak hasn't messaged you before — start with an approved template.").should('be.visible')
        cy.contains('button', 'Send template').should('be.visible')

        // No free-text composer for a conversation with no inbound history yet --
        // WhatsApp only allows template sends until the patient has messaged in.
        cy.get('textarea[placeholder="Type a message…"]').should('not.exist')
      })
    })
  })

  it('closes the "+ New" compose dropdown when clicking outside it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/inbox')

      cy.clickUntil('button:contains("+ New")', 'input[placeholder="Search patients…"]')

      cy.get('body').click(10, 10)
      cy.get('input[placeholder="Search patients…"]').should('not.exist')
    })
  })

  it('lists an existing conversation with a WhatsApp channel badge and the normal composer', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Oren', lastName: 'Ortiz' }).then((patient: any) => {
        cy.task('db:createWhatsappMessage', {
          accountId: account.accountId,
          patientId: patient.id,
          phoneNumber: '+34600000001',
          direction: 'inbound',
          bodyPreview: 'Hola, quiero confirmar mi cita',
        }).then((message: any) => {
          expect(message.channel).to.eq('whatsapp')

          cy.login(account.email, account.password)
          cy.visit('/inbox')

          cy.contains('Oren Ortiz').should('be.visible')
          cy.contains('Hola, quiero confirmar mi cita').should('be.visible')
          cy.get('[title="WhatsApp"]').should('be.visible')

          cy.contains('Oren Ortiz').click()
          cy.contains('+34600000001').should('be.visible')

          // Recent inbound message keeps the free-text composer open (within
          // WhatsApp's 24h customer-service window), unlike a brand-new conversation.
          cy.get('textarea[placeholder="Type a message…"]').should('be.visible')
          cy.contains('button', 'Send template').should('not.exist')
        })
      })
    })
  })
})
