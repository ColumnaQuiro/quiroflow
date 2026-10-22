// PracticeHub 2.0 (its new "v3" API): the connection takes its own phk_ key,
// the proxy only ever GETs one resource, and the 2.0 care plans step shows
// what each plan would become here -- read-only. PracticeHub itself is
// stubbed: the shapes are GET /v3/api/care_plans[/{id}] and /patients from
// build.practicehub.io's openapi.

const PROXY = '/api/import/practicehub-v3'

describe('PracticeHub 2.0', () => {
  it('only saves a phk_ key, and its proxy only reads one resource', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/import')
      cy.request({ method: 'PUT', url: '/api/import/practicehub-connection', body: { baseUrl: 'https://clinic.neptune.practicehub.io', v3ApiKey: 'abc123' }, failOnStatusCode: false }).its('body.statusMessage').should('contain', 'starts with phk_')
      for (const body of [{ path: '/../me' }, { path: 'https://evil.example/x' }, { path: '/patients', query: { 'x-api-key': 'y' } }]) {
        cy.request({ method: 'POST', url: PROXY, body, failOnStatusCode: false }).its('status').should('eq', 400)
      }
      // A well-formed request with nothing saved says what is missing.
      cy.request({ method: 'POST', url: PROXY, body: { path: '/me' }, failOnStatusCode: false }).its('body.statusMessage').should('contain', 'No PracticeHub 2.0 connection is saved')
    })
  })

  it('previews 2.0 care plans as bonos, memberships or skipped, matched by patient number', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bono', lastName: 'Dosceros', externalReference: 'PH-0042' })
      const plan = (id: number, patientId: number, name: string, billing: unknown) => ({ id, patient_id: patientId, name, status: 'active', billing, members: [{ patient_id: patientId, status: 'active' }], schedules: [] })
      const plans: Record<number, unknown> = {
        1: plan(1, 501, 'Bono 12', { billing_type: 'prepayment', status: 'active', start_date: '2026-09-01', interval_unit: null, interval_length: null, is_ongoing: false, total_price: '528.00', periods: [{ period_number: 1, start_date: '2026-09-01', end_date: null, status: 'paid', amount_due: '528.00', amount_paid: '528.00', visits_expected: 12, visits_used: 5, rollover_visits: 0 }] }),
        2: plan(2, 502, 'Mantenimiento', { billing_type: 'membership', status: 'active', start_date: '2026-10-01', interval_unit: 'month', interval_length: 1, is_ongoing: true, total_price: '240.00', periods: [] }),
        3: plan(3, 501, 'Visitas sueltas', { billing_type: 'payg', status: 'active', start_date: null, interval_unit: null, interval_length: null, is_ongoing: false, total_price: null }),
      }
      cy.intercept('POST', PROXY, (req) => {
        const path: string = req.body.path
        if (path === '/care_plans') return req.reply({ data: [{ id: 1 }, { id: 2 }, { id: 3 }], links: { next: null }, meta: { has_more: false } })
        const m = /^\/care_plans\/(\d+)$/.exec(path)
        if (m) return req.reply({ data: plans[Number(m[1])] })
        if (path === '/patients') return req.reply({ data: [{ id: 501, patient_number: 'PH-0042' }, { id: 502, patient_number: 'PH-0099' }], links: { next: null } })
        req.reply({ statusCode: 404, body: { message: 'not stubbed' } })
      }).as('ph')

      cy.login(account.email, account.password)
      cy.visit('/settings/import?source=practicehub&type=care_plans_v3')
      cy.get('[data-cy=ph20-read]', { timeout: 15000 }).should('not.be.disabled').click()
      cy.get('[data-cy=ph20-summary]').should('contain.text', '1 bonos · 1 memberships · 1 skipped').and('contain.text', '1 patients not in QuiroFlow yet')
      cy.get('[data-cy=ph20-row][data-kind=bono]').should('contain.text', 'Bono Dosceros').and('contain.text', '7 of 12 left').and('contain.text', '528,00')
      cy.get('[data-cy=ph20-row][data-kind=membership]').should('contain.text', 'Not in QuiroFlow · #PH-0099').and('contain.text', '240,00').and('contain.text', 'per month')
      cy.get('[data-cy=ph20-row][data-kind=skip]').should('contain.text', 'Pay as you go')
      // Read-only: every request it made was a read through the proxy.
      cy.get('@ph.all').should('have.length', 5)
    })
  })

  it('says so when there are no 2.0 care plans yet', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('POST', PROXY, { data: [], links: { next: null } })
      cy.login(account.email, account.password)
      cy.visit('/settings/import?source=practicehub&type=care_plans_v3')
      cy.get('[data-cy=ph20-read]', { timeout: 15000 }).should('not.be.disabled').click()
      cy.get('[data-cy=ph20-none]').should('contain.text', 'No 2.0 care plans yet')
    })
  })
})
