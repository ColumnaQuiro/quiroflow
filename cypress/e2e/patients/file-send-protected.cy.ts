// Sending a patient one of their files as a PDF only their DNI/NIE opens --
// or a password the clinic tells them, when there is no DNI on file. The
// password never travels in the message beside it.

describe('Sending a patient file protected by WhatsApp', () => {
  it('locks it with the DNI on file and says so, without saying what it is', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Emmanuel', nationalId: '12345678z' }).then((p) => {
        cy.task('db:storePatientFile', { accountId: account.accountId, patientId: p.id, fileName: 'Informe.pdf' })
        cy.intercept('POST', '/api/patients/files/*/send-protected', { statusCode: 200, body: { success: true } }).as('send')

        cy.login(account.email, account.password)
        cy.visit(`/patients/${p.id}?tab=attachments`)
        cy.get('[data-cy="file-send-protected"]').click()

        // Brought to the one spelling the PDF password accepts.
        cy.get('[data-cy="send-protected-password"]').should('have.value', '12345678Z')
        cy.get('[data-cy="send-protected-dialog"]').should('contain', 'Their DNI/NIE on file.')
        cy.get('[data-cy="send-protected-caption"]').invoke('val').should('contain', 'DNI/NIE').and('not.contain', '12345678')

        cy.get('[data-cy="confirm-dialog"]').contains('button', 'Send').click()
        cy.wait('@send').its('request.body').should('deep.include', { password: '12345678Z', saveAsNationalId: false })
        cy.contains('Sent to the patient on WhatsApp, password-protected.').should('be.visible')
      })
    })
  })

  it('asks for a password when there is no DNI, and can keep a DNI typed in', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p) => {
        cy.task('db:storePatientFile', { accountId: account.accountId, patientId: p.id, fileName: 'Informe.pdf' })
        cy.intercept('POST', '/api/patients/files/*/send-protected', { statusCode: 200, body: { success: true } }).as('send')

        cy.login(account.email, account.password)
        cy.visit(`/patients/${p.id}?tab=attachments`)
        cy.get('[data-cy="file-send-protected"]').click()

        cy.get('[data-cy="send-protected-password"]').should('have.value', '')
        cy.get('[data-cy="send-protected-dialog"]').should('contain', 'No DNI/NIE saved for this patient')
        cy.get('[data-cy="confirm-dialog"]').contains('button', 'Send').should('be.disabled')
        // A chosen password: the message points at the clinic, not the DNI.
        cy.get('[data-cy="send-protected-caption"]').invoke('val').should('contain', 'te hemos indicado')

        cy.get('[data-cy="send-protected-password"]').type('12.345.678-z')
        cy.contains('label', "Save it as this patient's DNI/NIE").find('input').check()
        cy.get('[data-cy="send-protected-caption"]').invoke('val').should('contain', 'DNI/NIE')

        cy.get('[data-cy="confirm-dialog"]').contains('button', 'Send').click()
        cy.wait('@send').its('request.body').should('deep.include', { password: '12.345.678-z', saveAsNationalId: true })
      })
    })
  })

  it('will not send a message that gives the password away', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', nationalId: '12345678Z' }).then((p) => {
        cy.task('db:storePatientFile', { accountId: account.accountId, patientId: p.id, fileName: 'Informe.pdf' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${p.id}?tab=attachments`)
        cy.get('[data-cy="file-send-protected"]').click()
        cy.get('[data-cy="send-protected-caption"]').clear().type('Tu contraseña es 12345678-Z')
        cy.get('[data-cy="send-protected-dialog"]').should('contain', 'The message must not contain the password.')
        cy.get('[data-cy="confirm-dialog"]').contains('button', 'Send').should('be.disabled')
      })
    })
  })

  it("shows the server's reason when it cannot be sent", () => {
    // Not stubbed: the stored test file is not a readable PDF, so the real
    // endpoint refuses it before WhatsApp is ever involved.
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', nationalId: '12345678Z' }).then((p) => {
        cy.task('db:storePatientFile', { accountId: account.accountId, patientId: p.id, fileName: 'Informe.pdf' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${p.id}?tab=attachments`)
        cy.get('[data-cy="file-send-protected"]').click()
        cy.get('[data-cy="confirm-dialog"]').contains('button', 'Send').click()
        cy.get('[data-cy="send-protected-error"]').should('contain', 'This PDF could not be read.')
      })
    })
  })
})
