// Settings > Calendar Resources, Referral Sources, Packages / Bonos and
// Memberships: the four list pages redesigned together.

describe('Settings list pages', () => {
  it('adds a room under its clinic and renames it in place', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/rooms')
      cy.get('[data-cy="settings-list"][data-ready="true"]')

      cy.get('[data-cy="room-clinic"]').first().contains('button', 'Add room').click()
      cy.get('[data-cy="room-new-name"]').type('Sala Norte')
      cy.get('[data-cy="room-new-save"]').click()
      cy.contains('[data-cy="room-name"]', 'Sala Norte').should('be.visible')
      cy.contains('[data-cy="room-row"]', 'Sala Norte').should('contain', 'Nothing booked this week')

      cy.get('button[aria-label="Rename Sala Norte"]').click()
      cy.get('[data-cy="room-rename"]').clear().type('Sala Sur{enter}')
      cy.contains('[data-cy="room-name"]', 'Sala Sur').should('be.visible')

      // Deleting says what happens to the calendar before it happens.
      cy.get('button[aria-label="Delete Sala Sur"]').click()
      cy.get('[data-cy="confirm-dialog"]').should('contain', 'without a room').contains('button', 'Delete room').click()
      cy.contains('[data-cy="room-name"]', 'Sala Sur').should('not.exist')
    })
  })

  it('only lets a referral source nobody has be deleted', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createReferralSource', { accountId: account.accountId, name: 'Cartel del barrio' })
      cy.task('db:createReferralSource', { accountId: account.accountId, name: 'Radio local' })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nuria', referralSource: 'Cartel del barrio' })

      cy.login(account.email, account.password)
      cy.visit('/settings/referral-sources')
      cy.get('[data-cy="settings-list"][data-ready="true"]')

      cy.contains('[data-cy="source-row"]', 'Cartel del barrio').as('used')
      cy.get('@used').find('[data-cy="source-count"]').should('have.text', '1 patient')
      cy.get('@used').find('[data-cy="source-delete"]').should('not.exist')

      cy.contains('[data-cy="source-row"]', 'Radio local').find('[data-cy="source-count"]').should('have.text', 'No patients')
      cy.contains('[data-cy="source-row"]', 'Radio local').find('[data-cy="source-delete"]').click()
      cy.contains('[data-cy="source-row"]', 'Radio local').should('not.exist')

      // A used source is retired instead: off the field, still counted.
      cy.get('@used').find('[data-cy="source-retire"]').click()
      cy.contains('[data-cy="source-retired-row"]', 'Cartel del barrio').should('contain', '1 patient').find('[data-cy="source-reoffer"]').click()
      cy.get('[data-cy="sources-retired"]').should('not.exist')
      cy.contains('[data-cy="source-row"]', 'Cartel del barrio').scrollIntoView().should('be.visible')
    })
  })

  it('creates a bono showing its price per session, then edits it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/packages')
      cy.get('[data-cy="settings-list"][data-ready="true"]')

      cy.get('[data-cy="package-add"]').click()
      cy.get('[data-cy="package-name-input"]').type('Bono prueba')
      cy.get('[data-cy="package-sessions-input"]').clear().type('8')
      cy.get('[data-cy="package-price-input"]').type('200,00')
      cy.get('[data-cy="package-form"]').should('contain', '25,00')
      cy.get('[data-cy="package-save"]').click()

      cy.contains('[data-cy="package-card"]', 'Bono prueba').as('card')
      cy.get('@card').should('contain', '8 sessions').and('contain', '25,00').find('[data-cy="package-sold"]').should('have.text', 'Not sold yet')

      cy.get('@card').find('[data-cy="package-edit"]').click()
      cy.get('[data-cy="package-sessions-input"]').clear().type('10')
      cy.get('[data-cy="package-save"]').click()
      cy.contains('[data-cy="package-card"]', 'Bono prueba').should('contain', '10 sessions').and('contain', '20,00')
    })
  })

  it('keeps how often a membership plan charges', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/memberships')
      cy.get('[data-cy="settings-list"][data-ready="true"]')

      cy.get('[data-cy="membership-add"]').click()
      cy.get('[data-cy="membership-name-input"]').type('Trimestral')
      cy.get('[data-cy="membership-price-input"]').type('120,00')
      cy.get('[data-cy="membership-period-input"]').select('3 months')
      cy.get('[data-cy="membership-save"]').click()

      cy.contains('[data-cy="membership-row"]', 'Trimestral').find('[data-cy="membership-price"]').should('contain', '/ 3 months')
      cy.task<{ name: string; billing_interval: string; billing_interval_count: number }[]>('db:membershipTemplatesFor', { accountId: account.accountId }).then((rows) => {
        const plan = rows.find((r) => r.name === 'Trimestral')
        expect(plan).to.include({ billing_interval: 'month', billing_interval_count: 3 })
      })
    })
  })
})
