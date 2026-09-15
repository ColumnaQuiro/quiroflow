// Growth is a paid add-on, and these tests are about that being true on the
// server rather than in the browser.
//
// It used to be gated only by a localStorage flag, while every
// /api/growth/* route checked the communication_config permission and
// nothing else -- so any account on any plan could call the whole Growth
// API and the tier was a suggestion the UI made. A gate anyone can walk
// around is worse than no gate, because it looks like one.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

describe('The Growth add-on', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  function get(url: string) {
    return cy.request({ url, failOnStatusCode: false })
  }

  /**
   * A clinic past its trial that never bought the add-on.
   *
   * Turning the add-on off is not enough on its own: a seeded account is
   * trialing, and a trial includes Growth deliberately. Both halves are what
   * "has not bought it" actually means.
   */
  function neverBought() {
    cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: false })
    cy.setSubscriptionStatus(account.accountId, 'active')
  }

  it('refuses the Growth API to an account that has not bought it', () => {
    neverBought()

    // 402, not 403: this is not "you may not", it is "this is not on your
    // subscription", and the two want different answers from the client.
    get('/api/growth/dashboard').its('status').should('eq', 402)
    get('/api/growth/leads').its('status').should('eq', 402)
    get('/api/growth/reputation').its('status').should('eq', 402)
    get('/api/growth/receptionist/config').its('status').should('eq', 402)
  })

  it('allows it once the add-on is on', () => {
    get('/api/growth/dashboard').its('status').should('eq', 200)
  })

  it('does not let the preview flag buy it', () => {
    // The flag still renders the screens, deliberately -- the suite needs
    // both states. What it must not do is get data out of the API.
    neverBought()
    cy.visit('/growth?growth=1')
    get('/api/growth/dashboard').its('status').should('eq', 402)
  })

  it('refuses lead capture, so an ad platform is told rather than ignored', () => {
    neverBought()
    cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['leads:write'] }).then((t) => {
      cy.request({
        method: 'POST',
        url: '/api/public/v1/leads',
        headers: { Authorization: `Bearer ${t.token}` },
        body: { full_name: 'Not Entitled', phone: '+34600123123' },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(403)
        expect(JSON.stringify(res.body)).to.contain('Growth is not on this subscription')
      })
    })
  })

  it('includes Growth in a trial, before anyone has bought anything', () => {
    // The trial is the one period a clinic is deciding, and this is the part
    // most worth deciding about. Hiding it behind a purchase then would be
    // the wrong way round.
    cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: false })
    cy.setSubscriptionStatus(account.accountId, 'trialing')
    get('/api/growth/dashboard').its('status').should('eq', 200)
  })

  it('stops when the trial ends and nothing was bought', () => {
    // The cliff, deliberately: lead capture stops until they buy. The
    // refusal says so in words rather than failing quietly.
    neverBought()
    get('/api/growth/dashboard').its('status').should('eq', 402)
  })

  it('keeps working for an account whose card failed this morning', () => {
    // past_due is somebody with a payment problem, not somebody who left.
    // Cutting lead capture off over it would lose enquiries they paid for.
    cy.setSubscriptionStatus(account.accountId, 'past_due')
    get('/api/growth/dashboard').its('status').should('eq', 200)
  })

  it('stops for an account that has actually gone', () => {
    cy.setSubscriptionStatus(account.accountId, 'canceled')
    get('/api/growth/dashboard').its('status').should('eq', 402)
  })

  it('stops a drip already in flight when the add-on goes', () => {
    cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'lead.created',
      isMarketing: true,
      actions: [
        { type: 'whatsapp_template', config: { template_name: 'welcome_1' } },
        { type: 'delay', config: { delay_minutes: 1440 } },
        { type: 'whatsapp_template', config: { template_name: 'welcome_2' } },
      ],
    })
    cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['leads:write'] }).then((t) => {
      cy.request({
        method: 'POST',
        url: '/api/public/v1/leads',
        headers: { Authorization: `Bearer ${t.token}` },
        body: { full_name: 'Mid Drip', phone: '+34600123124', marketing_consent: true, external_id: 'addon-drip' },
      }).then((res) => {
        const leadId = res.body.data.id

        // Cancelled between messages. Continuing to message strangers on
        // behalf of a clinic that stopped paying for the thing sending them
        // is indefensible.
        neverBought()
        cy.task('db:makeSequenceDue', { leadId })
        cy.request({
          method: 'POST',
          url: '/api/automations/lead-sequence-cron',
          headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' },
        })

        cy.task('db:sequenceRuns', { leadId }).then((rows) => {
          const runs = rows as { status: string; stopped_reason: string | null }[]
          expect(runs[0]!.status).to.eq('cancelled')
          expect(runs[0]!.stopped_reason).to.eq('not_entitled')
        })
      })
    })
  })
})
