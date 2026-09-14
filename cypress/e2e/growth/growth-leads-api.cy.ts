// The leads API itself, driven directly rather than through the board.
//
// The board tests cover what a clinic sees. These cover what it must NOT:
// another clinic's leads, and a staff member without the permission. Both are
// asserted against the HTTP layer, because that is where a real caller lives
// -- a stale tab, the mobile app, or anything holding a token.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
  roles: { id: string; name: string }[]
}

/**
 * Calls the API as the signed-in staff member. Authentication rides on the
 * session cookie, which cy.request sends from the browser's own jar -- the
 * same path the web app uses. An earlier version dug the token out of
 * localStorage and sent it as a bearer header, which returned 403 for
 * everything: @nuxtjs/supabase keeps the staff session in a cookie, so there
 * was no token there to find.
 */
function apiRequest(options: Partial<Cypress.RequestOptions> & { url: string }) {
  return cy.request({ failOnStatusCode: false, ...options })
}

describe('Growth leads API', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
      cy.visit('/growth/leads?growth=1')
    })
  })

  it('returns only this account\'s leads', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Ours Alone', stage: 'new' })

    // A second clinic, entirely unrelated, with a lead of its own.
    cy.task('db:createStaffAccount', {
      email: `other-${Date.now()}@example.com`,
      password: 'OtherClinic123!',
      accountName: 'Other Clinic Group',
      clinicName: 'Other Clinic',
    }).then((other) => {
      const otherAccount = other as SeededAccount
      cy.task('db:createLead', { accountId: otherAccount.accountId, fullName: 'Theirs Only', stage: 'new' })

      apiRequest({ url: '/api/growth/leads' }).then((res) => {
        expect(res.status).to.eq(200)
        const body = JSON.stringify(res.body)
        expect(body, 'our own lead').to.contain('Ours Alone')
        // The whole point of the account_id filter and the RLS behind it.
        expect(body, "the other clinic's lead").not.to.contain('Theirs Only')
      })
    })
  })

  it('refuses to read a lead belonging to another account', () => {
    cy.task('db:createStaffAccount', {
      email: `other2-${Date.now()}@example.com`,
      password: 'OtherClinic123!',
      accountName: 'Other Clinic Group 2',
      clinicName: 'Other Clinic 2',
    }).then((other) => {
      const otherAccount = other as SeededAccount
      cy.task('db:createLead', { accountId: otherAccount.accountId, fullName: 'Not Yours', stage: 'new' }).then((lead) => {
        const id = (lead as { id: string }).id
        // 404 rather than 403: guessing an id should not confirm that it is a
        // real lead somewhere else.
        apiRequest({ url: `/api/growth/leads/${id}` }).its('status').should('eq', 404)
      })
    })
  })

  it('refuses to move a lead belonging to another account', () => {
    cy.task('db:createStaffAccount', {
      email: `other3-${Date.now()}@example.com`,
      password: 'OtherClinic123!',
      accountName: 'Other Clinic Group 3',
      clinicName: 'Other Clinic 3',
    }).then((other) => {
      const otherAccount = other as SeededAccount
      cy.task('db:createLead', { accountId: otherAccount.accountId, fullName: 'Untouchable', stage: 'new' }).then((lead) => {
        const id = (lead as { id: string }).id

        apiRequest({ method: 'PATCH', url: `/api/growth/leads/${id}`, body: { stage: 'booked' } })
          .its('status')
          .should('eq', 404)

        // And the row is genuinely untouched, not merely reported as missing.
        cy.task('db:leadById', { id }).should((row) => {
          expect((row as { stage: string }).stage).to.eq('new')
        })
      })
    })
  })

  it('rejects a stage that is not a stage', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Stage Check', stage: 'new' }).then((lead) => {
      const id = (lead as { id: string }).id

      apiRequest({ method: 'PATCH', url: `/api/growth/leads/${id}`, body: { stage: 'nonsense' } })
        .its('status')
        .should('eq', 400)

      // Rejected before it reaches the database, so the check constraint is
      // the backstop rather than the error message the user would have seen.
      cy.task('db:leadById', { id }).should((row) => {
        expect((row as { stage: string }).stage).to.eq('new')
      })
    })
  })

  it('creates a lead with a reference and an opening timeline entry', () => {
    apiRequest({
      method: 'POST',
      url: '/api/growth/leads',
      body: { fullName: 'Created By Api', channel: 'whatsapp', source: 'Google Ads · Neck' },
    }).then((res) => {
      expect(res.status).to.eq(201)
      expect(res.body.reference).to.match(/^LEAD-\d{4}-\d{4}$/)

      // A drawer opened on a brand-new lead should say where it came from,
      // not show a blank feed.
      cy.task('db:leadEvents', { leadId: res.body.id }).should((events) => {
        const list = events as { kind: string; detail: string }[]
        expect(list).to.have.length(1)
        expect(list[0]!.detail).to.contain('Google Ads · Neck')
      })
    })
  })

  it('rejects a lead with no name and one with an unknown channel', () => {
    apiRequest({ method: 'POST', url: '/api/growth/leads', body: { fullName: '  ', channel: 'whatsapp' } })
      .its('status')
      .should('eq', 400)

    apiRequest({ method: 'POST', url: '/api/growth/leads', body: { fullName: 'Bad Channel', channel: 'carrier-pigeon' } })
      .its('status')
      .should('eq', 400)
  })

  it('refuses a staff member whose role lacks the Growth permission', () => {
    cy.task('db:setRolePermissions', {
      accountId: account.accountId,
      roleName: 'Practitioner',
      patch: { communication_config: false },
    })

    const email = `prac-${Date.now()}@example.com`
    cy.task('db:createTeamMemberWithRole', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      roleName: 'Practitioner',
      email,
      password: 'Practitioner123!',
    })

    cy.logout()
    cy.login(email, 'Practitioner123!')
    cy.visit('/dashboard')

    apiRequest({ url: '/api/growth/leads' }).its('status').should('eq', 403)
  })
})
