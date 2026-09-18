// The starter campaign set.
//
// PracticeHub's API has no campaigns endpoint -- 30 candidate paths, two
// controls, every one 404 -- and its CSV exports do not carry them either, so
// there is nothing to import from. A clinic arriving from PracticeHub has the
// same blank campaigns page as one arriving from nothing.
//
// What earns a test here is the round trip and the safety property: the
// campaigns are created from the template, and they are created DISABLED.
// These send to real patients, and a set that started firing because someone
// wanted to see what the button did would be a bad way to find out.
describe('Campaign templates', () => {
  it('creates the chosen ones, switched off, with the clinic filled in', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/campaigns')

      cy.contains('No campaigns yet').should('be.visible')
      cy.contains('button', 'Start from a template').click()

      // Everything is pre-ticked; narrow to two so the test also proves the
      // picker is a picker rather than an "add them all" button.
      cy.get('[data-test="template-first-visit-booked"]').should('be.checked')
      cy.get('[data-test="template-birthday-active"]').uncheck()
      cy.get('[data-test="template-birthday-lapsed"]').uncheck()
      cy.get('[data-test="template-post-first-visit"]').uncheck()
      cy.get('[data-test="template-what-to-expect"]').uncheck()
      cy.get('[data-test="template-chiropractic-report"]').uncheck()
      cy.get('[data-test="template-care-plan-completed"]').uncheck()

      cy.get('[data-test="create-templates"]').click()
      cy.contains('button', 'Creating…').should('not.exist')

      cy.contains('First visit booked').should('be.visible')
      cy.contains('First visit cancelled').should('be.visible')
      // The ones left unticked were not created.
      cy.contains('Birthday (active patient)').should('not.exist')

      cy.task('db:latestAutomationRules').then((rows: any) => {
        expect(rows, 'only the two chosen').to.have.length(2)
        for (const rule of rows) {
          expect(rule.enabled, `${rule.name} arrives switched off`).to.eq(false)
        }
        const welcome = rows.find((r: any) => r.name === 'First visit booked')
        expect(welcome.actions, 'one email action').to.have.length(1)
        expect(welcome.actions[0].action_type).to.eq('email')
        // The clinic name is substituted at creation, so staff open finished
        // copy rather than a placeholder.
        expect(welcome.actions[0].config.subject).to.contain('Main Location')
        expect(welcome.actions[0].config.subject).to.not.contain('{{clinic_name}}')
        // ...while the per-recipient merge fields must survive untouched.
        expect(welcome.actions[0].config.body).to.contain('{{next_appointment}}')
      })
    })
  })

  it('marks what is already there rather than offering a duplicate', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/campaigns')

      cy.contains('button', 'Start from a template').click()
      cy.get('[data-test="template-birthday-active"]').uncheck()
      cy.get('[data-test="template-birthday-lapsed"]').uncheck()
      cy.get('[data-test="template-post-first-visit"]').uncheck()
      cy.get('[data-test="template-what-to-expect"]').uncheck()
      cy.get('[data-test="template-chiropractic-report"]').uncheck()
      cy.get('[data-test="template-care-plan-completed"]').uncheck()
      cy.get('[data-test="template-first-visit-cancelled"]').uncheck()
      cy.get('[data-test="create-templates"]').click()
      cy.contains('button', 'Creating…').should('not.exist')
      cy.contains('First visit booked').should('be.visible')

      cy.contains('button', 'Templates').click()
      cy.contains('already added').should('exist')
      // And it is not re-selected, so a second click cannot duplicate it.
      cy.get('[data-test="template-first-visit-booked"]').should('not.be.checked')
    })
  })
})
