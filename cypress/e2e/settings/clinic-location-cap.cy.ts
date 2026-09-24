describe('Clinic location cap', () => {
  function openClinics() {
    cy.visit('/settings/clinics')
    cy.get('[data-cy=clinics-page]').should('have.attr', 'data-ready', 'true')
  }

  it('blocks a second clinic on the Solo plan and says so before anything is typed', () => {
    cy.seedStaffAccount().then((account) => {
      // Paying for Solo: an open free trial has no location cap at all
      // (20260924100032), so the cap is only there once a plan is paid for.
      cy.setSubscriptionStatus(account.accountId, 'active')
      cy.login(account.email, account.password)
      openClinics()

      // A fresh account is on Solo (included_clinics = 1) and already has the
      // one clinic create_account_with_owner made at signup.
      cy.get('[data-cy=clinics-plan]').should('contain.text', '1 of 1 locations')
      cy.get('[data-cy=clinic-add]').click()
      cy.get('[data-cy=clinic-add-plan-full]').should('contain.text', 'includes 1 location(s) and all are in use')
      cy.get('[data-cy=confirm-dialog-cancel]').click()
      cy.get('[data-cy=clinic-card]').should('have.length', 1)
    })
  })

  // Onboarding tells a clinic its other locations "can come later", and the
  // trial is where it finds out whether the product works across them.
  it('lets a clinic on its free trial add a second location, and opens it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      openClinics()
      cy.get('[data-cy=clinics-plan]').should('not.exist')

      cy.get('[data-cy=clinic-add]').click()
      cy.get('[data-cy=clinic-add-name]').type('Second Location')
      cy.get('[data-cy=confirm-dialog-confirm]').click()

      cy.location('pathname').should('match', /^\/settings\/clinics\/[0-9a-f-]{36}$/)
      cy.get('[data-cy=clinic-page]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=clinic-title]').should('have.text', 'Second Location')
    })
  })

  // Archive one, add one, bring the first back: without the cap on
  // reactivation that walks straight past it.
  it('holds the cap when an archived location is brought back', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Old Location' }).then((old) => {
        cy.login(account.email, account.password)
        cy.visit(`/settings/clinics/${old.id}`)
        cy.get('[data-cy=clinic-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=clinic-archive]').click()
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.location('pathname').should('eq', '/settings/clinics')

        // Now paying for Solo, with its one location in use.
        cy.setSubscriptionStatus(account.accountId, 'active')
        openClinics()
        cy.get(`[data-cy=clinic-archived-row][data-clinic-id="${old.id}"]`).find('[data-cy=clinic-reactivate]').click()
        cy.contains('Your plan covers 1 clinic location(s)').should('be.visible')
        cy.task<{ archived_at: string | null }>('db:clinicRow', { clinicId: old.id }).then((row) => expect(row.archived_at).to.not.equal(null))
      })
    })
  })
})
