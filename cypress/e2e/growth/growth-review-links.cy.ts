// Review requests that can be counted.
//
// The Reputation funnel reads review_requests. Nothing ever wrote to that
// table -- the {{google_review_link}} merge token resolved straight to the
// clinic's Google page -- so a clinic already sending review requests saw
// "0 sent, 0 opened" indefinitely. These tests are mostly about *not*
// counting: a row minted for a reminder, a test send or a dry run is worse
// than the blank it replaces, because a wrong number invites a decision.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

describe('Tracked review links', () => {
  let account: SeededAccount
  let patientId: string

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
      cy.task('db:setGoogleReviewUrl', { accountId: account.accountId, url: 'https://g.page/r/columna/review' })
      cy.task<{ id: string }>('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Review',
        lastName: 'Candidate',
        phone: '600700800',
      }).then((p) => {
        patientId = p.id
      })
    })
  })

  function ruleWith(variables: { source: string }[], extra: Record<string, unknown> = {}) {
    return cy.task('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.completed',
      actions: [{ type: 'whatsapp_template', config: { template_name: 'review_request', template_language: 'es', variables, ...extra } }],
    })
  }

  function fire() {
    return cy.request({
      method: 'POST',
      url: '/api/automations/fire',
      body: { triggerEvent: 'appointment.completed', patientId },
      failOnStatusCode: false,
    })
  }

  it('mints a request when the rule actually sends the review link', () => {
    ruleWith([{ source: 'first_name' }, { source: 'google_review_link' }])
    fire()

    cy.task('db:reviewRequestsFor', { accountId: account.accountId }).then((rows) => {
      const requests = rows as { token: string; patient_id: string }[]
      expect(requests).to.have.length(1)
      expect(requests[0]!.patient_id).to.eq(patientId)

      // And the token resolves to the clinic's own page, so the patient's
      // experience is unchanged -- they just pass through us on the way.
      cy.request({ url: `/api/r/${requests[0]!.token}`, followRedirect: false }).then((res) => {
        expect(res.status).to.eq(302)
        expect(res.headers.location).to.eq('https://g.page/r/columna/review')
      })
    })
  })

  it('mints nothing for a rule that never mentions the link', () => {
    // The regression that would matter most: every appointment reminder a
    // clinic sends would otherwise count as a review request.
    ruleWith([{ source: 'first_name' }])
    fire()

    cy.task('db:reviewRequestsFor', { accountId: account.accountId }).then((rows) => {
      expect(rows as unknown[]).to.have.length(0)
    })
  })

  it('records the open exactly once, however many times the link is followed', () => {
    ruleWith([{ source: 'google_review_link' }])
    fire()

    cy.task('db:reviewRequestsFor', { accountId: account.accountId }).then((rows) => {
      const token = (rows as { token: string }[])[0]!.token
      cy.request({ url: `/api/r/${token}`, followRedirect: false })
      cy.request({ url: `/api/r/${token}`, followRedirect: false })

      cy.task('db:reviewRequestsFor', { accountId: account.accountId }).then((after) => {
        const row = (after as { opened_at: string | null }[])[0]!
        expect(row.opened_at).to.not.be.null
      })
    })
  })

  it('mints nothing on a dry run', () => {
    cy.task('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.completed',
      dryRun: true,
      actions: [{ type: 'whatsapp_template', config: { template_name: 'review_request', template_language: 'es', variables: [{ source: 'google_review_link' }] } }],
    })
    fire()

    cy.task('db:reviewRequestsFor', { accountId: account.accountId }).then((rows) => {
      expect(rows as unknown[]).to.have.length(0)
    })
  })
})
