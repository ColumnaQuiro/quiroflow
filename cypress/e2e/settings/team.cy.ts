// Settings > Team had no coverage beyond the navigation smoke test proving
// the page renders -- none of what the page is actually for (per-person
// working hours, the practitioner/bookable flags, invites) was exercised.
describe('Settings > Team', () => {
  it('saves a practitioner working-hours override, confirms it, and keeps it after a reload', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/team')

      cy.contains('tr', 'Test Owner').within(() => {
        cy.contains('button', 'Working hours').should('be.visible')
        // No override stored yet, so the button carries no "(custom)" marker.
        cy.contains('button', 'Working hours (custom)').should('not.exist')
      })

      // The editor opens as a sibling <tr>, not inside the member's row, so
      // these assertions deliberately aren't scoped to it.
      cy.contains('tr', 'Test Owner').contains('button', 'Working hours').click()
      cy.contains("Leave every day empty to keep Test Owner bookable across the clinic's own hours.").should('be.visible')
      cy.contains('No override').should('be.visible')

      // WEEKDAYS renders Mon first, so the first "+ Add hours" is Monday's.
      cy.contains('button', '+ Add hours').first().click()
      cy.get('input[type="time"]').should('have.length', 2)
      cy.get('input[type="time"]').first().should('have.value', '09:00')

      cy.intercept('PATCH', '**/rest/v1/team_members*').as('saveHours')
      cy.contains('button', 'Save').click()
      cy.wait('@saveHours')

      cy.contains('Working hours saved').should('be.visible')

      // Reload rather than trusting the in-place label update: saveSchedule
      // assigns member.business_hours locally right after the request, so
      // only a fresh read proves the row actually persisted.
      cy.reload()
      cy.contains('tr', 'Test Owner').contains('button', 'Working hours (custom)').should('be.visible')
    })
  })

  it('persists the practitioner toggle', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/team')

      // The owner row is seeded as a practitioner (accept_invite/onboarding
      // both insert the owner with is_practitioner = true).
      cy.contains('tr', 'Test Owner')
        .contains('label', 'Practitioner')
        .find('button[role="switch"]')
        .should('have.attr', 'aria-checked', 'true')

      cy.intercept('PATCH', '**/rest/v1/team_members*').as('toggleMember')
      cy.contains('tr', 'Test Owner').contains('label', 'Practitioner').find('button[role="switch"]').click()
      cy.wait('@toggleMember')

      cy.contains('tr', 'Test Owner')
        .contains('label', 'Practitioner')
        .find('button[role="switch"]')
        .should('have.attr', 'aria-checked', 'false')

      cy.reload()
      cy.contains('tr', 'Test Owner')
        .contains('label', 'Practitioner')
        .find('button[role="switch"]')
        .should('have.attr', 'aria-checked', 'false')
    })
  })

  it('creates an invite and lists it as pending', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)

      // Stubbed: the real endpoint talks to an email provider that isn't
      // configured in CI, and the page only awaits it to decide which
      // banner to show -- the invite row itself is already written by then.
      cy.intercept('POST', '/api/invites/send', { statusCode: 200, body: { sent: true } }).as('sendInvite')
      cy.visit('/settings/team')

      cy.get('input[type="email"]').type('newcolleague@example.test')
      cy.contains('button', 'Create Invite Link').click()
      cy.wait('@sendInvite')

      cy.contains('Pending invites').should('be.visible')
      cy.contains('li', 'newcolleague@example.test').should('be.visible')
      cy.contains('li', 'newcolleague@example.test').contains('button', 'Copy link').should('be.visible')

      cy.contains('li', 'newcolleague@example.test').contains('button', 'Revoke').click()
      cy.contains('li', 'newcolleague@example.test').should('not.exist')
    })
  })
})
