// Attachments is one tab with two groups that behave differently: a form is
// something the patient has to act on, a file is something the clinic put
// there. Merging the old Docs and Files tabs put them on one screen; this
// is the part that makes each group say what it is.
describe('The Attachments tab', () => {
  it('says who sent a form, when, and that the patient has not returned it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Formulario',
        lastName: 'Pendiente',
      }).then((patient: any) => {
        cy.task('db:createPatientDoc', {
          accountId: account.accountId,
          patientId: patient.id,
          title: 'Consentimiento informado',
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=attachments`)

        cy.contains('Forms sent to the patient').should('be.visible')
        cy.contains('Consentimiento informado').should('be.visible')

        // "Sent" describes what the clinic did. The question being asked is
        // what the PATIENT has not done, so the pill says that, in warning.
        cy.contains('Awaiting patient').should('be.visible')

        // The patient's own link is on screen, not hidden behind a Copy
        // button -- it is what staff read out on the phone, and you cannot
        // check you are sending the right one if you cannot see it.
        cy.contains('/doc/').should('be.visible')
        cy.contains('button', 'Copy').should('be.visible')
      })
    })
  })

  it('calls it View answers once the patient has completed it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Formulario',
        lastName: 'Completado',
      }).then((patient: any) => {
        cy.task('db:createPatientDoc', {
          accountId: account.accountId,
          patientId: patient.id,
          title: 'Historia clinica',
          completed: true,
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=attachments`)

        cy.contains('Completed').should('be.visible')
        // Opening a returned form is reading what they answered, and the
        // label should say which of the two it is.
        cy.contains('button', 'View answers').should('be.visible')
      })
    })
  })

  it('gives files a dropzone and both ways of getting one out', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Archivo',
        lastName: 'Subido',
      }).then((patient: any) => {
        cy.task('db:createPatientFile', {
          accountId: account.accountId,
          patientId: patient.id,
          fileName: 'radiografia-lumbar.png',
          fileType: 'image/png',
          sizeBytes: 480000,
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=attachments`)

        cy.contains('Files uploaded by the clinic').should('be.visible')
        cy.contains('radiografia-lumbar.png').should('be.visible')

        // Preview opens a viewer, which is what you want for a scan.
        // Download is what you want when it has to reach an insurer, and a
        // viewer tab is a poor way to get there.
        cy.contains('button', 'Preview').should('be.visible')
        cy.contains('button', 'Download').should('be.visible')

        cy.contains('Drop files here').scrollIntoView().should('be.visible')
      })
    })
  })
})
