// The AI receptionist's configuration.
//
// The test-chat panel calls a real model, so these tests deliberately do NOT
// exercise it: CI has no ANTHROPIC_API_KEY, which is the state the panel
// already has to handle gracefully, and a suite that spent money per run on a
// non-deterministic reply would be both expensive and flaky. What is asserted
// is everything around it -- the config that builds the prompt, the
// validation, the permission gate, and the default that matters most.
//
// The page is in sections (Overview, What it knows, How it behaves, Try it),
// reached by ?tab= so a test lands on the one it is about.

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
    cy.get('[data-test="receptionist-mode-sentence"]').should('contain', 'Off')
    cy.get('[data-test="mode-off"] input').should('be.checked')

    // And says what each choice would mean: a draft to approve, or an answer
    // of its own. The page has to keep up with what the receptionist actually
    // does, or it is telling an owner something untrue about their own clinic.
    cy.get('[data-test="mode-draft"]').should('contain', 'a person reads it in the Inbox and sends it')
    cy.get('[data-test="mode-auto"]').should('contain', 'sends its replies itself')
  })

  it('turns answering on as drafts, then on its own, and off again', () => {
    cy.visit('/growth/receptionist?growth=1')

    cy.get('[data-test="mode-draft"]').click()
    cy.get('[data-test="receptionist-status"]').should('contain', 'On')
    cy.get('[data-test="receptionist-mode-sentence"]').should('contain', 'Drafting replies for you to approve')
    // Drafting only: the hours switches are not on offer.
    cy.get('[data-test="auto-reply"]').should('not.exist')

    // Answering on its own starts outside clinic hours, never during: in
    // hours the front desk is there, and that is the switch a clinic turns
    // on second, deliberately.
    cy.get('[data-test="mode-auto"]').click()
    cy.get('[data-test="receptionist-mode-sentence"]').should('contain', 'outside clinic hours, drafting during')
    cy.get('[data-test="toggle-after-hours"]').should('be.checked')
    cy.get('[data-test="toggle-during-hours"]').should('not.be.checked')
    cy.get('[data-test="toggle-during-hours"]').click()
    cy.get('[data-test="receptionist-mode-sentence"]').should('contain', 'day and night')

    cy.reload()
    cy.get('[data-test="receptionist-status"]').should('contain', 'On')
    cy.get('[data-test="mode-auto"] input').should('be.checked')

    // Unticking both hours is drafting, and the choice says so.
    cy.get('[data-test="toggle-after-hours"]').click()
    cy.get('[data-test="toggle-during-hours"]').click()
    cy.get('[data-test="mode-draft"] input').should('be.checked')

    cy.get('[data-test="mode-off"]').click()
    cy.get('[data-test="receptionist-status"]').should('contain', 'Off')
    apiRequest({ url: '/api/growth/receptionist/config' }).then((res) => {
      expect(res.body.config.enabled).to.eq(false)
      expect(res.body.config.afterHours).to.eq(false)
      expect(res.body.config.answerDuringHours).to.eq(false)
    })
  })

  it('warns that "on" with no channel connected reaches nothing', () => {
    cy.visit('/growth/receptionist?growth=1')
    cy.get('[data-test="no-channel-warning"]').should('not.exist')
    cy.get('[data-test="mode-draft"]').click()
    cy.get('[data-test="no-channel-warning"]').should('contain', 'No channel is connected')
    // And each unconnected channel says where it is set up.
    cy.get('[data-test="channel-whatsapp-setup"]').should('have.attr', 'href', '/settings/whatsapp')
  })

  it('walks a new clinic through what is left to do, and stops once it is done', () => {
    cy.task('db:setInstagramAccount', { accountId: account.accountId, instagramUserId: 'ig-17841400000000001' })
    cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Primera visita' })
    cy.visit('/growth/receptionist?growth=1')

    cy.get('[data-test="receptionist-checklist"]').should('contain', '2 of 5')
    cy.get('[data-test="checklist-channel"]').should('have.attr', 'data-done', 'true')
    cy.get('[data-test="checklist-knowledge"]').should('have.attr', 'data-done', 'false')

    // A step that is a section of this page opens it.
    cy.get('[data-test="checklist-knowledge"] button').click()
    cy.get('[data-test="receptionist-tab-knowledge"]').should('have.attr', 'aria-selected', 'true')
    cy.get('[data-test="card-title"]').type('Prices')
    cy.get('[data-test="add-card"]').click()
    cy.contains('Saved.').should('be.visible')

    cy.get('[data-test="receptionist-tab-overview"]').click()
    cy.get('[data-test="checklist-knowledge"]').should('have.attr', 'data-done', 'true')
    cy.get('[data-test="receptionist-checklist"]').should('contain', '3 of 5')
  })

  it('saves the persona, tone and languages, and they survive a reload', () => {
    cy.visit('/growth/receptionist?growth=1&tab=knowledge')

    cy.get('[data-test="persona-name"]').clear().type('Nerea').blur()
    cy.contains('Saved.').should('be.visible')

    cy.get('[data-test="tone-formal"]').click()
    cy.contains('Saved.').should('be.visible')

    // Catalan on, English off: the prompt is told what the clinic supports.
    cy.get('[data-test="language-ca"]').click()
    cy.get('[data-test="language-en"]').click()

    cy.reload()
    cy.get('[data-test="persona-name"]').should('have.value', 'Nerea')
    cy.get('[data-test="tone-formal"]').should('have.class', 'bg-brand-tint')
    cy.get('[data-test="language-ca"]').should('have.attr', 'aria-pressed', 'true')
    cy.get('[data-test="language-en"]').should('have.attr', 'aria-pressed', 'false')
    apiRequest({ url: '/api/growth/receptionist/config' }).its('body.config.languages').should('deep.equal', ['es', 'ca'])

    // And the test panel is addressed to the persona the clinic chose.
    cy.get('[data-test="test-chat"]').should('contain', 'Nerea')
  })

  it('keeps at least one language', () => {
    cy.visit('/growth/receptionist?growth=1&tab=knowledge')
    cy.get('[data-test="language-en"]').click()
    cy.get('[data-test="language-en"]').should('have.attr', 'aria-pressed', 'false')
    // The last one does not come off.
    cy.get('[data-test="language-es"]').click()
    cy.get('[data-test="language-es"]').should('have.attr', 'aria-pressed', 'true')
    apiRequest({ method: 'PUT', url: '/api/growth/receptionist/config', body: { languages: [] } }).its('status').should('eq', 400)
    apiRequest({ method: 'PUT', url: '/api/growth/receptionist/config', body: { languages: ['klingon'] } }).its('status').should('eq', 400)
  })

  it('says what an unconfigured receptionist will and will not do', () => {
    cy.visit('/growth/receptionist?growth=1&tab=knowledge')
    // Empty knowledge is stated as a consequence, not as a blank card.
    cy.get('[data-test="knowledge-empty"]').should('contain', 'says it will check with a colleague')

    // And when it books: only answering on its own, signed, never cancelling
    // without asking.
    cy.visit('/growth/receptionist?growth=1&tab=behaviour')
    // Below the fold of the tab's own scroll area since Booking rules gained
    // the reactivation row: visible once scrolled to, as for a person.
    cy.contains('When it drafts, it offers times and a person books.').scrollIntoView().should('be.visible')
    cy.contains('It never cancels without asking first.').should('exist')
  })

  it('shows which channels exist rather than hiding the ones that do not', () => {
    cy.visit('/growth/receptionist?growth=1')

    // Three different nothings, and the row each one lands on is the point.
    // WhatsApp and Instagram are built and merely unconfigured on a fresh
    // account; SMS and web chat do not exist at all. An owner comparing this
    // screen to what they were sold has to be able to tell those apart.
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
    cy.get('[data-test="channel-instagram-setup"]').should('not.exist')

    // And the count in the header is derived from the channels, so a channel
    // that starts reporting itself has to reach it without a second edit.
    cy.get('[data-test="mode-draft"]').click()
    cy.get('[data-test="receptionist-status"]').should('contain', '1 channel')
    cy.get('[data-test="no-channel-warning"]').should('not.exist')
  })

  it('offers test mode as unavailable when the server has no model key', () => {
    cy.visit('/growth/receptionist?growth=1')

    // CI has no key. The panel says so instead of rendering a chat that
    // cannot answer -- and offers no scenarios to a chat that cannot run.
    cy.get('[data-test="test-chat-unavailable"]').should('contain', 'needs an Anthropic API key')
    cy.get('[data-test="test-chat-input"]').should('not.exist')
    cy.get('[data-test="test-chat-scenarios"]').should('not.exist')
  })

  it('shows the test panel as a section of its own on a phone', () => {
    cy.viewport(390, 844)
    cy.visit('/growth/receptionist?growth=1')
    // The sidebar copy is hidden at this width, and the section does not
    // exist until its tab is opened.
    cy.get('[data-test="receptionist-tabs"]').should('be.visible')
    cy.get('[data-test="test-chat"]:visible').should('not.exist')
    cy.get('[data-test="receptionist-tab-try"]').click()
    cy.get('[data-test="test-chat"]:visible').should('have.length', 1).and('contain', 'Test mode')
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

  it('lets the booking rules be set, within what the server accepts', () => {
    // They were shown as text while the endpoint accepted them: the
    // sentence the model is given is built from exactly these numbers.
    cy.visit('/growth/receptionist?growth=1&tab=behaviour')
    cy.get('[data-test="booking-window"]').should('have.value', '14')
    cy.get('[data-test="booking-window"]').clear().type('21').blur()
    cy.contains('Saved.').should('be.visible')
    cy.get('[data-test="slots-per-reply"]').clear().type('3').blur()
    cy.contains('Saved.').should('be.visible')

    // Out of range is put back, not sent.
    cy.get('[data-test="minimum-notice"]').clear().type('99999').blur()
    cy.get('[data-test="minimum-notice"]').should('have.value', '120')

    cy.reload()
    cy.get('[data-test="booking-window"]').should('have.value', '21')
    cy.get('[data-test="slots-per-reply"]').should('have.value', '3')
    apiRequest({ url: '/api/growth/receptionist/config' }).then((res) => {
      expect(res.body.config.bookingWindowDays).to.eq(21)
      expect(res.body.config.slotsPerReply).to.eq(3)
      expect(res.body.config.minimumNoticeMinutes).to.eq(120)
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

    cy.contains('Add the AI receptionist on its own, or get it with Growth.').should('be.visible')
    cy.get('[data-test="test-chat"]').should('not.exist')
  })

  it('says how the clinic comes to have it', () => {
    // The Subscription page's reading, beside the status: an owner should
    // not have to leave the page to know whether this is costing them.
    cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: true })
    cy.setSubscriptionStatus(account.accountId, 'active')
    cy.task('db:setComped', { accountId: account.accountId, comped: false })
    cy.visit('/growth/receptionist?growth=1')
    cy.get('[data-test="receptionist-included-by"]').should('contain', 'Included in Growth').and('have.attr', 'href', '/subscription')
  })

  // 1,000 replies a month are included and each further 1,000 is charged,
  // so the clinic is shown the count, warned from 80%, and can set a ceiling.
  it('shows this month\'s replies, warns near the allowance, and stops at the clinic\'s limit', () => {
    cy.task('db:seedReceptionistReplies', { accountId: account.accountId, count: 850 })
    cy.visit('/growth/receptionist?growth=1')
    cy.get('[data-test="receptionist-usage"]').scrollIntoView()
    cy.get('[data-test="usage-count"]').should('contain', '850')
    cy.get('[data-test="usage-near"]').should('be.visible')

    cy.get('[data-test="usage-limit"]').type('500')
    cy.get('[data-test="usage-limit-save"]').click()
    cy.contains('Saved.').should('be.visible')
    cy.get('[data-test="usage-stopped"]').should('be.visible')
    cy.reload()
    cy.get('[data-test="usage-limit"]').should('have.value', '500')
  })

  // Past 1,000 a month each further 1,000 is charged on the 1st -- but never
  // to an account with nothing to charge it to. A seeded account has no
  // Stripe customer, so it is counted and skipped, and no charge is claimed.
  it('skips the monthly charge for an account with no Stripe customer', () => {
    cy.task('db:seedReceptionistReplies', { accountId: account.accountId, count: 1200, createdAt: '2026-03-15T10:00:00Z' })
    cy.request({
      method: 'POST',
      url: '/api/billing/receptionist-overage-cron',
      headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' },
      body: { month: '2026-03' },
    }).then((res) => {
      expect(res.status).to.eq(200)
      expect(res.body.month).to.eq('2026-03-01')
      expect(res.body.skipped).to.include(account.accountId)
      expect(res.body.charged).not.to.include(account.accountId)
    })
  })

  // "Confirmar" on the reminder needs no answer: a list the clinic edits.
  it('lists the messages it leaves alone, and takes one more', () => {
    cy.visit('/growth/receptionist?growth=1&tab=knowledge')
    cy.get('[data-test="no-reply-phrases"]').scrollIntoView().should('contain', 'Confirmar').and('contain', 'Gracias')
    cy.get('[data-test="no-reply-text"]').type('Recibido')
    cy.get('[data-test="add-no-reply"]').click()
    cy.contains('Saved.').should('be.visible')
    cy.reload()
    cy.get('[data-test="no-reply-phrases"]').scrollIntoView().should('contain', 'Recibido')
  })

  describe('what it has done', () => {
    // Read back from the records the receptionist leaves -- a note in the
    // conversation per booking or handover, a task per handover, a draft
    // waiting on a lead -- so the Overview says what the Inbox shows.

    it('counts the month and lists the latest, each opening its conversation', () => {
      cy.task<{ id: string }>('db:createLead', { accountId: account.accountId, fullName: 'Reservada Por Alba', stage: 'contacted', phone: '+34600444910' }).then((lead) => {
        cy.task('db:createReceptionistNote', { accountId: account.accountId, conversationKey: `lead:${lead.id}`, body: 'He reservado Primera visita el lunes 20 de octubre, 10:00.' })
        cy.task('db:createReceptionistNote', { accountId: account.accountId, conversationKey: `lead:${lead.id}`, body: 'He pasado esta conversación a una persona. Motivo: Quiere hablar con el quiropráctico.' })
        cy.task('db:createHandoverTask', { accountId: account.accountId, leadId: lead.id, title: 'Responder a Reservada Por Alba: quiere hablar con el quiropráctico' })
        cy.task('db:setLeadDraft', { id: lead.id, body: 'Te propongo el jueves a las 10:00.' })
        cy.task('db:seedReceptionistReplies', { accountId: account.accountId, count: 3 })

        cy.visit('/growth/receptionist?growth=1')
        cy.get('[data-test="activity-drafted"]').should('contain', '3')
        cy.get('[data-test="activity-sent"]').should('contain', '0')
        cy.get('[data-test="activity-booked"]').should('contain', '1')
        cy.get('[data-test="activity-handed-over"]').should('contain', '1')

        // What is waiting on a person, as links into the Inbox.
        cy.get('[data-test="drafts-waiting"]').should('contain', '1').and('have.attr', 'href', '/inbox?ai=draft_ready')
        cy.get('[data-test="handovers-open"]').should('contain', '1').and('have.attr', 'href', '/inbox?ai=needs_human')

        // Newest first, named, with the handover's reason rather than its
        // fixed opening.
        cy.get('[data-test="activity-recent"] li').should('have.length', 2)
        cy.get('[data-test="activity-recent"] li').first().should('contain', 'Handed to a person').and('contain', 'Reservada Por Alba').and('contain', 'Quiere hablar con el quiropráctico').and('not.contain', 'He pasado')
        cy.get('[data-test="activity-recent"] li').last().should('contain', 'Booked a visit')
        cy.get('[data-test="activity-event-booked"]').should('have.attr', 'href', `/inbox?open=${encodeURIComponent(`lead:${lead.id}`)}`)
      })
    })

    it('says so when it has done nothing yet', () => {
      cy.visit('/growth/receptionist?growth=1')
      cy.get('[data-test="activity-empty"]').should('contain', 'Nothing yet')
      cy.get('[data-test="drafts-waiting"]').should('contain', '0')
    })

    it('is refused without the receptionist, like the rest of its API', () => {
      cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: false })
      cy.setSubscriptionStatus(account.accountId, 'active')
      cy.task('db:setComped', { accountId: account.accountId, comped: false })
      apiRequest({ url: '/api/growth/receptionist/config' }).its('status').should('eq', 402)
    })
  })

  describe('what the receptionist knows and asks', () => {
    // These three lists are what the system prompt is built from. They were
    // once rendered read-only, then add-and-remove only; a price that changes
    // should be edited where it is, not retyped.

    it('takes a knowledge card, keeps it, and lets it be edited in place', () => {
      cy.visit('/growth/receptionist?growth=1&tab=knowledge')
      cy.get('[data-test="knowledge-empty"]').should('be.visible')

      cy.get('[data-test="card-title"]').type('Prices')
      cy.get('[data-test="card-lines"]').type('First visit 50€\nFollow-up 40€')
      cy.get('[data-test="add-card"]').click()

      cy.get('[data-test="knowledge-card"]').should('have.length', 1)
      cy.get('[data-test="knowledge-card"]').should('contain', 'Prices').and('contain', 'First visit 50€')
      cy.get('[data-test="knowledge-empty"]').should('not.exist')

      // Survives a reload, which is the only proof it reached the database
      // rather than a ref.
      cy.reload()
      cy.get('[data-test="knowledge-card"]').should('contain', 'First visit 50€')

      // A price changes.
      cy.get('[data-test^="edit-card-"]').click()
      cy.get('[data-test="edit-card-lines"]').clear().type('First visit 55€\nFollow-up 40€')
      cy.get('[data-test="edit-card-save"]').click()
      cy.contains('Saved.').should('be.visible')
      cy.get('[data-test="knowledge-card"]').should('contain', 'First visit 55€').and('not.contain', '50€')
      cy.reload()
      cy.get('[data-test="knowledge-card"]').should('contain', 'First visit 55€')
    })

    it('drops a blank line rather than storing it', () => {
      cy.visit('/growth/receptionist?growth=1&tab=knowledge')
      cy.get('[data-test="card-title"]').type('Hours')
      cy.get('[data-test="card-lines"]').type('Mon-Fri 9-19\n\n   \nSat closed')
      cy.get('[data-test="add-card"]').click()

      cy.get('[data-test="knowledge-card"]').within(() => {
        cy.contains('Mon-Fri 9-19').should('exist')
        cy.contains('Sat closed').should('exist')
      })
    })

    it('removes a card it was given', () => {
      cy.visit('/growth/receptionist?growth=1&tab=knowledge')
      cy.get('[data-test="card-title"]').type('Parking')
      cy.get('[data-test="add-card"]').click()
      cy.get('[data-test="knowledge-card"]').should('have.length', 1)

      cy.get('[data-test^="remove-card-"]').click()
      cy.get('[data-test="knowledge-empty"]').should('be.visible')
    })

    it('takes qualification questions in the order they will be asked, and reorders them', () => {
      cy.visit('/growth/receptionist?growth=1&tab=behaviour')
      cy.get('[data-test="questions-empty"]').should('exist')

      cy.get('[data-test="question-text"]').type('What brings you in?{enter}')
      cy.get('[data-test="question-text"]').type('How long have you had it?{enter}')

      cy.get('[data-test="qualification-question"]').should('have.length', 2)
      cy.get('[data-test="qualification-question"]').first().should('contain', 'What brings you in?')
      cy.get('[data-test="qualification-question"]').last().should('contain', 'How long')

      // The order is the order they are asked in, so it can be changed.
      cy.get('[data-test="qualification-question"]').last().find('[data-test="question-up"]').click()
      cy.contains('Saved.').should('be.visible')
      cy.get('[data-test="qualification-question"]').first().should('contain', 'How long')
      cy.get('[data-test="qualification-question"]').first().find('[data-test="question-up"]').should('be.disabled')

      // And a question can be reworded where it is.
      cy.get('[data-test="qualification-question"]').first().find('[data-test="question-edit"]').click()
      cy.get('[data-test="edit-question"]').clear().type('Since when?{enter}')
      cy.get('[data-test="qualification-question"]').first().should('contain', 'Since when?')
      cy.reload()
      cy.get('[data-test="qualification-question"]').first().should('contain', 'Since when?')
      cy.get('[data-test="qualification-question"]').last().should('contain', 'What brings you in?')
    })

    it('takes an escalation rule, needs both halves of it, and lets it be edited', () => {
      cy.visit('/growth/receptionist?growth=1&tab=behaviour')
      cy.get('[data-test="rule-when"]').type('They mention chest pain')
      // A rule with no action is not a rule.
      cy.get('[data-test="add-rule"]').should('be.disabled')

      cy.get('[data-test="rule-then"]').type('Hand to a chiropractor now')
      cy.get('[data-test="add-rule"]').click()
      cy.get('[data-test="escalation-rule"]').should('contain', 'chest pain').and('contain', 'chiropractor')

      cy.get('[data-test="rule-edit"]').click()
      cy.get('[data-test="edit-rule-then"]').clear().type('Call them back within the hour')
      cy.get('[data-test="edit-rule-save"]').click()
      cy.contains('Saved.').should('be.visible')
      cy.get('[data-test="escalation-rule"]').should('contain', 'within the hour').and('not.contain', 'chiropractor')
      cy.reload()
      cy.get('[data-test="escalation-rule"]').should('contain', 'within the hour')
    })
  })
})
