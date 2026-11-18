// Searching by phone finds the patient however the number was written.
//
// The search used to match what was typed against the number exactly as it
// was stored. Most numbers are stored spaced ("612 34 56 78"), so pasting the
// same number as "612345678", or "+34 612 345 678" from WhatsApp, found
// nobody -- at one clinic, 213 of its 272 numbers. Both sides are digits now
// (20261118122723).
describe('Patient search by phone', () => {
  it('finds a number whichever way it was stored or pasted', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Espacios', lastName: 'Guardado', phone: '612 34 56 78' })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Seguido', lastName: 'Guardado', phone: '655443322' })

      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.contains('tr', 'Espacios Guardado', { timeout: 15000 }).should('be.visible')

      const finds = (typed: string, who: string, notWho: string) => {
        cy.get('input[type="search"]').clear().type(typed)
        cy.contains('tr', who).should('be.visible')
        cy.contains('tr', notWho).should('not.exist')
      }

      // Stored with spaces, searched without -- the case that found nobody.
      finds('612345678', 'Espacios Guardado', 'Seguido Guardado')
      finds('+34 612 345 678', 'Espacios Guardado', 'Seguido Guardado')
      finds('0034612345678', 'Espacios Guardado', 'Seguido Guardado')
      finds('612-34-56-78', 'Espacios Guardado', 'Seguido Guardado')
      // And as stored, which always worked.
      finds('612 34 56 78', 'Espacios Guardado', 'Seguido Guardado')

      // Stored without spaces, searched with them.
      finds('655 44 33 22', 'Seguido Guardado', 'Espacios Guardado')
      finds('(+34) 655-443-322', 'Seguido Guardado', 'Espacios Guardado')

      // A name still searches as a name.
      finds('espacios', 'Espacios Guardado', 'Seguido Guardado')
    })
  })
})
