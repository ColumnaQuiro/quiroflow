// Clinic is no longer unlimited: 2 locations and 6 practitioners, and each
// further location is bought on the Subscription page
// (20261119131251_clinic_plan_caps_and_extra_locations.sql).
describe('Clinic plan: included locations and extra ones', () => {
  /** A paying Clinic account with `locations` open -- the extra ones added while the trial still had no cap. */
  function payingClinicAccount(locations: number) {
    return cy.seedStaffAccount().then((account) => {
      for (let i = 2; i <= locations; i++) {
        cy.task('db:addClinic', { accountId: account.accountId, name: `Location ${i}` })
      }
      cy.task('db:setSubscriptionPlan', { accountId: account.accountId, planId: 'clinic' })
      cy.setSubscriptionStatus(account.accountId, 'active')
      return cy.wrap(account)
    })
  }

  function openClinics() {
    cy.visit('/settings/clinics')
    cy.get('[data-cy=clinics-page]').should('have.attr', 'data-ready', 'true')
  }

  it('covers two locations, refuses a third, and allows it once one is bought', () => {
    payingClinicAccount(2).then((account) => {
      cy.login(account.email, account.password)
      openClinics()

      cy.get('[data-cy=clinics-plan]').should('contain.text', '2 of 2 locations')
      cy.get('[data-cy=clinic-add]').click()
      cy.get('[data-cy=clinic-add-plan-full]')
        .should('contain.text', 'includes 2 location(s) and all are in use')
        .and('contain.text', 'add a location or change plan in Subscription')
      cy.get('[data-cy=confirm-dialog-cancel]').click()

      // What the webhook writes when Stripe reports the extra-location item.
      cy.task('db:setExtraClinics', { accountId: account.accountId, extraClinics: 1 })
      openClinics()
      cy.get('[data-cy=clinics-plan]').should('contain.text', '2 of 3 locations')
      cy.get('[data-cy=clinic-add]').click()
      cy.get('[data-cy=clinic-add-name]').type('Third Location')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.location('pathname').should('match', /^\/settings\/clinics\/[0-9a-f-]{36}$/)
    })
  })

  // Three locations opened during the trial, then Clinic paid for with none
  // bought: the picker says how many are missing, the server refuses the
  // change, and one more location prices at 29 EUR on top of the 149.
  it('prices an extra location in the plan picker and refuses a change that leaves one uncovered', () => {
    payingClinicAccount(3).then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/subscription')
      cy.contains('button', 'Change plan').click()

      cy.get('[data-testid=extra-clinics-card]').should('contain.text', 'Clinic includes 2.')
      cy.get('[data-testid=extra-clinics-short]').should('contain.text', 'You have 3 clinics open: add 1 more here')

      cy.contains('button', 'Confirm change').click()
      cy.contains('This plan covers 2 location(s), but 3 are open.').should('be.visible')

      cy.get('button[aria-label="Add a clinic"]').click()
      cy.get('[data-testid=extra-clinics-short]').should('not.exist')
      cy.get('[data-testid=extra-clinics-card]').should('contain.text', '+1 extra clinic(s)')
      // 149,00 plan + 29,00 location.
      cy.contains('178,00').should('be.visible')
    })
  })

  it('offers no extra locations on a plan that does not sell them', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setSubscriptionStatus(account.accountId, 'active')
      cy.login(account.email, account.password)
      cy.visit('/subscription')
      cy.contains('button', 'Change plan').click()
      cy.contains('h3', 'Practitioner seats').should('be.visible')
      cy.get('[data-testid=extra-clinics-card]').should('not.exist')
    })
  })
})
