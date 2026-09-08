describe('Clinic location cap', () => {
  it('blocks a second clinic on the Solo plan and surfaces the plan-limit message', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/clinics')

      // A fresh account is on Solo (included_clinics = 1) and already has the
      // one clinic create_account_with_owner made at signup, so a second one
      // must be rejected by the enforce_clinic_location_cap trigger.
      cy.get('input[placeholder="Valencia"]').type('Second Location')
      cy.contains('button', 'Add Clinic').click()

      cy.contains('Your plan covers 1 clinic location(s) and all of them are in use.').should('be.visible')

      // Rejected, not silently dropped -- still just the one clinic row.
      cy.get('input[placeholder="Valencia"]').should('have.value', 'Second Location')
    })
  })
})
