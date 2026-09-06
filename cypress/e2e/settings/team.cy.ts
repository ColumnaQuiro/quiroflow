const INVITE_EMAIL = 'newcolleague@example.test'

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

      // Wait for a row the client-side load() put there before typing. Nuxt
      // serves the form's HTML before Vue hydrates, and keystrokes that land
      // in that window go into the raw input without v-model capturing them:
      // typing the address immediately after visiting lost its first two
      // characters, and the invite was created as "wcolleague@example.test".
      // A rendered team row proves onMounted's fetch ran, so v-model is live.
      cy.contains('tr', 'Test Owner').should('exist')

      // Asserting the field's value keeps a repeat of that failing here,
      // where the cause is obvious, rather than as a puzzling missing invite
      // several commands later.
      cy.get('input[type="email"]').type(INVITE_EMAIL).should('have.value', INVITE_EMAIL)
      cy.contains('button', 'Create Invite Link').click()
      cy.wait('@sendInvite')

      // scrollIntoView first (same as csv-import.cy.ts does): the settings
      // pane is an overflow-y-auto column and the invite form sits below the
      // pending list, so after submitting, the list it just grew is scrolled
      // out of view -- which Cypress reports as clipped, not merely offscreen.
      cy.contains('h2', 'Pending invites').scrollIntoView().should('be.visible')

      // Asserted on the list's text rather than with cy.contains('li', email):
      // the row renders "<email> · <role>", and the template falls back to
      // "Any email" when an invite has no address, so a mismatch here prints
      // what the row actually says instead of only "never found a matching li".
      cy.contains('h2', 'Pending invites')
        .parent()
        .find('li')
        .invoke('text')
        .should('contain', INVITE_EMAIL)

      cy.contains('h2', 'Pending invites')
        .parent()
        .find('li')
        .first()
        .within(() => {
          cy.contains('button', 'Copy link').should('exist')
          cy.contains('button', 'Revoke').click()
        })

      // Revoking the only invite empties the list, so the whole section goes.
      cy.contains('h2', 'Pending invites').should('not.exist')
    })
  })
})
