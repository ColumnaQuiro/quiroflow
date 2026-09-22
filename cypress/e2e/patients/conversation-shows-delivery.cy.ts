// The patient conversation, as a conversation.
//
// It was a list of rows with a status pill, newest first -- a log. Reading a
// log means reconstructing who said what, backwards, and reading the
// exchange is the one thing staff come here to do.
describe('The patient conversation', () => {
  function seedThread(account: any, patient: any) {
    const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60000).toISOString()
    const msg = (o: Record<string, unknown>) =>
      cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: patient.id, ...o })
    msg({ direction: 'outbound', status: 'read', bodyPreview: 'Your appointment is confirmed.', createdAt: at(60) })
    msg({ direction: 'inbound', bodyPreview: 'Thanks, see you then', createdAt: at(50) })
    msg({ direction: 'outbound', status: 'delivered', bodyPreview: 'See you Tuesday.', createdAt: at(40) })
    return msg({
      direction: 'outbound',
      status: 'failed',
      bodyPreview: 'Reminder for tomorrow.',
      errorMessage: 'Message failed to send: recipient has not opted in',
      errorCode: '131047',
      templateName: 'appointment_reminder',
      createdAt: at(30),
    })
  }

  it('reads forwards, with the delivery state drawn rather than spelled', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Charo',
        lastName: 'Conversa',
        phone: '600454545',
      }).then((patient: any) => {
        seedThread(account, patient).then(() => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=communications`)

          // The header says which channel, which number, and whose it is --
          // a thread with no header is one you take on trust.
          cy.contains('WhatsApp').should('be.visible')
          cy.contains("the patient's own number").should('be.visible')
          cy.contains('600').should('be.visible')

          // Oldest at the top: the confirmation comes before the reply.
          cy.get('p').contains('Your appointment is confirmed.').should('be.visible')
          cy.contains('Thanks, see you then').should('be.visible')

          // Read and delivered are ticks, not words -- but the label is
          // still there for a screen reader, so the state is never carried
          // by the glyph alone.
          cy.contains('.sr-only', 'Read').should('exist')
          cy.contains('.sr-only', 'Delivered').should('exist')
        })
      })
    })
  })

  it('spells failure out, with the reason and a way to send again', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Fallo',
        lastName: 'Entrega',
        phone: '600464646',
      }).then((patient: any) => {
        seedThread(account, patient).then(() => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=communications`)

          // A glyph for "it did not arrive" is a glyph someone has to be
          // taught. The reason is the whole point of the row.
          cy.contains('recipient has not opted in').should('be.visible')
          cy.contains('131047').should('be.visible')
          cy.contains('button', 'Send again').should('be.visible')
        })
      })
    })
  })

  it('says where a reply actually lands', () => {
    // Staff assume a reply comes back to them personally. It does not, and
    // finding that out by missing one is the expensive way.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Respuesta',
        lastName: 'Bandeja',
        phone: '600474747',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=communications`)
        cy.contains('Replies arrive in the clinic inbox').should('be.visible')
        cy.contains('a', 'Open inbox').should('have.attr', 'href', '/inbox')
      })
    })
  })

  it('offers no way to send to a do-not-contact patient', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Nocontacto',
        lastName: 'Hilo',
        phone: '600484848',
      }).then((patient: any) => {
        cy.task('db:setPatientContactFlags', { patientId: patient.id, doNotContact: true })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=communications`)

        // Removed, not disabled -- and the thread itself stays readable,
        // because what was already said is still a record.
        cy.contains('do not contact').should('be.visible')
        cy.contains('button', 'New message').should('not.exist')
      })
    })
  })
})

// WhatsApp refuses for reasons that have nothing to do with whether the
// patient is reachable: the 24-hour window closed, the template is not
// approved, the number never opted in. In all of those the clinic still has
// an email address and something that needs saying, and until now the only
// way to use it was to leave the app.
describe('Falling back to email when WhatsApp will not deliver', () => {
  it('offers email on a failed message, and sends the same words', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Elena',
        lastName: 'Correo',
        email: 'elena@example.test',
        phone: '600494949',
      }).then((patient: any) => {
        cy.task('db:createWhatsappMessage', {
          accountId: account.accountId,
          patientId: patient.id,
          direction: 'outbound',
          status: 'failed',
          bodyPreview: 'Your appointment is tomorrow at 13:15.',
          errorMessage: 'Message failed to send: recipient has not opted in',
          templateName: 'appointment_reminder',
        })

        // Resend is not configured against a local stack, so the send itself
        // is stubbed. What is under test is that the button reaches the
        // endpoint carrying the words WhatsApp could not deliver -- nobody
        // should have to retype the message to send it a second way.
        cy.intercept('POST', `/api/patients/${patient.id}/send-email`, {
          statusCode: 200,
          body: { sent: true, to: 'elena@example.test' },
        }).as('sendEmail')

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=communications`)

        cy.contains('button', 'Send by email instead').click()
        cy.wait('@sendEmail').its('request.body.body').should('contain', 'Your appointment is tomorrow')
        cy.contains('Sent by email to elena@example.test').should('be.visible')
      })
    })
  })

  it('shows an email in the same thread, not a separate log', () => {
    // A message that failed on WhatsApp and went by email is one
    // conversation. An email recorded nowhere visible is indistinguishable
    // from one that was never sent.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Hilo',
        lastName: 'Unico',
        email: 'hilo@example.test',
        phone: '600505050',
      }).then((patient: any) => {
        cy.task('db:seedEmailMessage', {
          accountId: account.accountId,
          patientId: patient.id,
          providerMessageId: `seed-${Date.now()}`,
          recipientEmail: 'hilo@example.test',
          subject: 'Your appointment is tomorrow at 13:15.',
          delivered: true,
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=communications`)

        cy.contains('Your appointment is tomorrow at 13:15.').should('be.visible')
        // Marked as email, and speaking the same delivery vocabulary as the
        // WhatsApp rows rather than inventing a second one.
        cy.contains('Email').should('be.visible')
        cy.contains('.sr-only', 'Delivered').should('exist')
      })
    })
  })
})
