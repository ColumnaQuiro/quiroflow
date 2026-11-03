// The "Visit value & retention" widget, when its payments cannot be read.
//
// It started its two loads in onMounted without handing either promise back,
// so a read that failed -- fetchAllRows throws supabase's error object --
// escaped Vue altogether and reached the browser as a bare unhandled
// rejection: "Object captured as promise rejection with keys: code, details,
// hint, message" (QUIROFLOW-APP-5, from the app's /numbers on Google Play's
// test devices). Sentry had no stack and no component to go on.
//
// Cypress fails a test on an unhandled rejection by itself, so this only has
// to make the read fail and let the failure land. A PostgREST error rather
// than a dropped connection: the error object has the same four keys, and
// nothing retries it -- supabase-js and @nuxtjs/supabase between them retry
// a dropped connection a dozen times over about eight seconds.
describe('The dashboard statistics widget', () => {
  it('hands a failed read to Vue instead of leaving it unhandled', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateRows', {
        table: 'team_members',
        values: { dashboard_layout: [{ id: '00000000-0000-4000-8000-000000000001', type: 'statistics_mini', size: 'sm' }] },
        match: { id: account.teamMemberId },
      })

      cy.intercept('GET', '**/rest/v1/payments*', {
        statusCode: 500,
        body: { code: 'XX000', message: 'payments refused for this spec', details: null, hint: null },
      }).as('payments')

      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.contains('Visit value & retention').should('be.visible')
      cy.wait('@payments')
      // Long enough for the rejection to settle after the response; without
      // the fix, the test fails here as an uncaught exception.
      cy.wait(500)
      cy.contains('Visit value & retention').should('be.visible')
    })
  })
})
