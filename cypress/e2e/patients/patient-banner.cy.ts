// The banner that replaced the record's 56px header and its 280px rail.
//
// The rail is where several things lived, and a redesign that moves a
// surface is exactly when one of them quietly fails to make the trip. Two
// did: the patient's photo -- along with the ONLY route into uploading one,
// including the scan-with-your-phone QR -- and the country flag on the
// number. Neither shows up in a diff of the words on screen, which is how
// they got as far as a pull request.
describe('The patient banner', () => {
  it('carries the photo, and the way to change it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Rosalia',
        lastName: 'Retrato',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        // No photo yet, so the initials stand in -- but the control is the
        // same one, and it is the entry point that matters.
        cy.contains('button', 'RR').should('be.visible').click()
        cy.contains('button', 'Upload from computer').should('be.visible')
        cy.contains('button', 'Use your phone (QR)').should('be.visible')
      })
    })
  })

  it('shows the number with its country flag, and the tab it is on does not matter', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Teodoro',
        lastName: 'Telefono',
        phone: '600777888',
      }).then((patient: any) => {
        cy.login(account.email, account.password)

        // The whole reason contact details moved up here: the front desk
        // needs the number on whichever tab they happen to be standing on,
        // and it used to be on Overview only.
        for (const tab of ['overview', 'money', 'attachments']) {
          cy.visit(`/patients/${patient.id}?tab=${tab}`)
          cy.contains('+34 600777888').should('be.visible')
          cy.contains('🇪🇸').should('be.visible')
        }
      })
    })
  })
})
