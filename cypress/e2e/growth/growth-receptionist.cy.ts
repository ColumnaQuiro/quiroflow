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

    // And says what being on would mean, which is drafting for approval --
    // not sending. The switch used to gate nothing and the copy used to say
    // the feature did not exist; both changed once it started drafting
    // replies to real enquiries, and the page has to keep up or it is telling
    // an owner something untrue about their own clinic.
    cy.contains('drafts replies for you to approve').should('be.visible')
    cy.contains('never sends on its own').should('be.visible')
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

    // Three different nothings, and the row each one lands on is the point.
    // WhatsApp and Instagram are built and merely unconfigured on a fresh
    // account; SMS and web chat do not exist at all. An owner comparing this
    // screen to what they were sold has to be able to tell those apart.
    //
    // Asserted per row rather than by searching the page, because "Not
    // available yet" is on screen either way: while Instagram said it, this
    // test passed on SMS's copy and reported a built channel as missing for
    // a day after it shipped.
    cy.get('[data-test="channel-whatsapp"]').should('contain', 'Not set up')
    cy.get('[data-test="channel-instagram"]').should('contain', 'Not set up')
    cy.get('[data-test="channel-instagram"]').should('not.contain', 'Not available yet')
    cy.get('[data-test="channel-sms"]').should('contain', 'Not available yet')
    cy.get('[data-test="channel-web-chat"]').should('contain', 'Not available yet')
  })

  it('calls Instagram connected once it is, and counts it as a live channel', () => {
    cy.task('db:setInstagramAccount', { accountId: account.accountId, instagramUserId: 'ig-17841400000000000' })

    cy.visit('/growth/receptionist?growth=1')

    // Receiving needs only the account id -- the webhook is shared with
    // WhatsApp and verified by the same app secret -- so this is a real
    // working state, not a half-filled form.
    cy.get('[data-test="channel-instagram"]').should('contain', 'Connected')

    // And the count in the header is derived from the channels, so a channel
    // that starts reporting itself has to reach it without a second edit.
    cy.get('[data-test="toggle-enabled"]').click()
    cy.get('[data-test="receptionist-status"]').should('contain', '1 channel')
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

  describe('what the receptionist knows and asks', () => {
    // These three lists are what the system prompt is built from, and all
    // three were rendered read-only -- so the knowledge base stayed
    // permanently empty while the card itself explained that an empty one
    // makes the receptionist deflect instead of answering.

    it('takes a knowledge card and keeps it', () => {
      cy.visit('/growth/receptionist?growth=1')
      cy.get('[data-test="knowledge-empty"]').should('be.visible')

      cy.get('[data-test="card-title"]').scrollIntoView().type('Prices')
      cy.get('[data-test="card-lines"]').type('First visit 50€\nFollow-up 40€')
      cy.get('[data-test="add-card"]').click()

      cy.get('[data-test="knowledge-card"]').should('have.length', 1)
      cy.get('[data-test="knowledge-card"]').should('contain', 'Prices').and('contain', 'First visit 50€')
      cy.get('[data-test="knowledge-empty"]').should('not.exist')

      // Survives a reload, which is the only proof it reached the database
      // rather than a ref.
      cy.reload()
      cy.get('[data-test="knowledge-card"]').should('contain', 'First visit 50€')
    })

    it('drops a blank line rather than storing it', () => {
      cy.visit('/growth/receptionist?growth=1')
      cy.get('[data-test="card-title"]').scrollIntoView().type('Hours')
      cy.get('[data-test="card-lines"]').type('Mon-Fri 9-19\n\n   \nSat closed')
      cy.get('[data-test="add-card"]').click()

      cy.get('[data-test="knowledge-card"]').within(() => {
        cy.contains('Mon-Fri 9-19').should('exist')
        cy.contains('Sat closed').should('exist')
      })
    })

    it('removes a card it was given', () => {
      cy.visit('/growth/receptionist?growth=1')
      cy.get('[data-test="card-title"]').scrollIntoView().type('Parking')
      cy.get('[data-test="add-card"]').click()
      cy.get('[data-test="knowledge-card"]').should('have.length', 1)

      cy.get('[data-test^="remove-card-"]').click()
      cy.get('[data-test="knowledge-empty"]').should('be.visible')
    })

    it('takes qualification questions in the order they will be asked', () => {
      cy.visit('/growth/receptionist?growth=1')
      cy.get('[data-test="questions-empty"]').should('exist')

      cy.get('[data-test="question-text"]').scrollIntoView().type('What brings you in?{enter}')
      cy.get('[data-test="question-text"]').type('How long have you had it?{enter}')

      cy.get('[data-test="qualification-question"]').should('have.length', 2)
      cy.get('[data-test="qualification-question"]').first().should('contain', 'What brings you in?')
      cy.get('[data-test="qualification-question"]').last().should('contain', 'How long')
    })

    it('takes an escalation rule, and needs both halves of it', () => {
      cy.visit('/growth/receptionist?growth=1')
      cy.get('[data-test="rule-when"]').scrollIntoView().type('They mention chest pain')
      // A rule with no action is not a rule.
      cy.get('[data-test="add-rule"]').should('be.disabled')

      cy.get('[data-test="rule-then"]').type('Hand to a chiropractor now')
      cy.get('[data-test="add-rule"]').click()
      cy.get('[data-test="escalation-rule"]').should('contain', 'chest pain').and('contain', 'chiropractor')
    })
  })
})
