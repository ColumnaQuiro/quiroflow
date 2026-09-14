// The AI receptionist's configuration.
//
// The test-chat panel calls a real model, so these tests deliberately do NOT
// exercise it: CI has no ANTHROPIC_API_KEY, which is the state the panel
// already has to handle gracefully, and a suite that spent money per run on a
// non-deterministic reply would be both expensive and flaky. What is asserted
// is everything around it -- the config that builds the prompt, the
// validation, the permission gate, and the default that matters most.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

function apiRequest(options: Partial<Cypress.RequestOptions> & { url: string }) {
  return cy.request({ failOnStatusCode: false, ...options })
}

describe('Growth AI receptionist', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  it('starts switched off, and says so', () => {
    cy.visit('/growth/receptionist?growth=1')

    // The default that matters most. A receptionist that began answering
    // patients because someone opened the settings screen would be the worst
    // failure this feature could have.
    cy.get('[data-test="receptionist-status"]').should('contain', 'Off')
    cy.contains('Automatic answering of real enquiries is not built yet').should('be.visible')
  })

  it('saves the persona and tone, and they survive a reload', () => {
    cy.visit('/growth/receptionist?growth=1')

    cy.get('[data-test="persona-name"]').clear().type('Nerea').blur()
    cy.contains('Saved.').should('be.visible')

    cy.get('[data-test="tone-formal"]').click()
    cy.contains('Saved.').should('be.visible')

    cy.reload()
    cy.get('[data-test="persona-name"]').should('have.value', 'Nerea')
    cy.get('[data-test="tone-formal"]').should('have.class', 'bg-brand-tint')

    // And the test panel is addressed to the persona the clinic chose.
    cy.get('[data-test="test-chat"]').should('contain', 'Nerea')
  })

  it('turns answering on and off', () => {
    cy.visit('/growth/receptionist?growth=1')

    cy.get('[data-test="toggle-enabled"]').click()
    cy.get('[data-test="receptionist-status"]').should('contain', 'On')

    cy.reload()
    cy.get('[data-test="receptionist-status"]').should('contain', 'On')
    cy.get('[data-test="toggle-enabled"]').click()
    cy.get('[data-test="receptionist-status"]').should('contain', 'Off')
  })

  it('says what an unconfigured receptionist will and will not do', () => {
    cy.visit('/growth/receptionist?growth=1')

    // Empty knowledge is stated as a consequence, not as a blank card.
    cy.get('[data-test="knowledge-empty"]').should('contain', 'says it will check with a colleague')
    cy.contains('Nothing yet').scrollIntoView().should('be.visible')

    // And the rule that keeps it from telling a patient something is booked.
    cy.contains('offers times and never confirms a booking itself').scrollIntoView().should('be.visible')
  })

  it('shows which channels exist rather than hiding the ones that do not', () => {
    cy.visit('/growth/receptionist?growth=1')

    // WhatsApp is unconfigured on a fresh account, and the others are not
    // built -- an owner comparing this to what they were sold should see both.
    cy.contains('WhatsApp').should('be.visible')
    cy.contains('Not set up').should('be.visible')
    cy.contains('Instagram DM').should('be.visible')
    cy.contains('Not available yet').should('be.visible')
  })

  it('offers test mode as unavailable when the server has no model key', () => {
    cy.visit('/growth/receptionist?growth=1')

    // CI has no key. The panel says so instead of rendering a chat that
    // cannot answer.
    cy.get('[data-test="test-chat-unavailable"]').should('contain', 'needs an Anthropic API key')
    cy.get('[data-test="test-chat-input"]').should('not.exist')
  })

  it('rejects settings that would not make sense', () => {
    cy.visit('/growth/receptionist?growth=1')

    // A 400-day booking window, no name, an invented tone.
    apiRequest({ method: 'PUT', url: '/api/growth/receptionist/config', body: { bookingWindowDays: 400 } })
      .its('status')
      .should('eq', 400)
    apiRequest({ method: 'PUT', url: '/api/growth/receptionist/config', body: { personaName: '   ' } })
      .its('status')
      .should('eq', 400)
    apiRequest({ method: 'PUT', url: '/api/growth/receptionist/config', body: { tone: 'sarcastic' } })
      .its('status')
      .should('eq', 400)

    // And the config is untouched by any of them.
    apiRequest({ url: '/api/growth/receptionist/config' }).then((res) => {
      expect(res.body.config.bookingWindowDays).to.eq(14)
      expect(res.body.config.personaName).to.eq('Alba')
      expect(res.body.config.tone).to.eq('warm_brief')
    })
  })

  it('refuses the test chat without a conversation to answer', () => {
    cy.visit('/growth/receptionist?growth=1')

    apiRequest({ method: 'POST', url: '/api/growth/receptionist/test-chat', body: { messages: [] } })
      .its('status')
      .should('eq', 400)

    // A history ending on the assistant has nothing to reply to either.
    apiRequest({
      method: 'POST',
      url: '/api/growth/receptionist/test-chat',
      body: { messages: [{ role: 'assistant', content: 'Hola' }] },
    })
      .its('status')
      .should('eq', 400)
  })

  it('points an account without the tier at the upgrade screen', () => {
    cy.visit('/growth/receptionist?growth=0')

    cy.contains('The AI receptionist is part of the Growth tier.').should('be.visible')
    cy.get('[data-test="test-chat"]').should('not.exist')
  })
})
