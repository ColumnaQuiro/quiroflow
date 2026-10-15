// Monthly goals on the Dashboard (DashboardMonthlyGoalsWidget, /api/goals):
// an owner adds the widget, sets this month's targets and sees the month so
// far against them -- counted the way the Monday summary counts. Owners
// only: nobody else is offered the widget, and the API refuses them.
describe('Monthly goals', () => {
  it('lets an owner set goals and shows the month so far against them', () => {
    cy.seedStaffAccount().then((account) => {
      // A new patient's first visit, attended this month (minutes ago, so it
      // is this month in any time zone), paid by card.
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nuevo', lastName: 'Mes' }).then((patient) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: new Date(Date.now() - 50 * 60 * 1000).toISOString(), status: 'completed' })
        cy.task('db:insertRows', { table: 'payments', rows: [{ account_id: account.accountId, patient_id: patient.id, amount_cents: 4500, method: 'card', purpose: 'on_account', paid_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() }] })
      })
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.contains('button', 'Edit layout', { timeout: 20000 })
      cy.clickUntil('button:contains("Edit layout")', 'p:contains("Add a widget")')
      cy.contains('button', '+ Monthly goals').click()
      cy.contains('button', 'Done').click()
      cy.get('[data-cy=monthly-goals][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=monthly-goals-set]').click()
      cy.get('[data-cy=monthly-goal-new_patients]').type('20')
      cy.get('[data-cy=monthly-goal-collected_cents]').type('9000')
      cy.get('[data-cy=monthly-goals-save]').click()

      cy.get('[data-cy=monthly-goal-row-new_patients]').should('contain', '1').and('contain', '/ 20')
      cy.get('[data-cy=monthly-goal-row-collected_cents]').invoke('text').should('match', /45[.,]00/)
      // Only what was set is shown.
      cy.get('[data-cy=monthly-goal-row-visits]').should('not.exist')
      cy.task<{ metric: string; target: number }[]>('db:selectRows', { table: 'monthly_goals', columns: 'metric, target', match: { account_id: account.accountId } }).then((rows) => {
        expect(rows.map((r) => [r.metric, r.target]).sort()).to.deep.eq([['collected_cents', 900000], ['new_patients', 20]])
      })

      // Changing them; emptying one removes it.
      cy.get('[data-cy=monthly-goals-edit]').click()
      cy.get('[data-cy=monthly-goal-new_patients]').clear()
      cy.get('[data-cy=monthly-goal-visits]').type('150')
      cy.get('[data-cy=monthly-goals-save]').click()
      cy.get('[data-cy=monthly-goal-row-visits]').should('contain', '/ 150')
      cy.get('[data-cy=monthly-goal-row-new_patients]').should('not.exist')
    })
  })

  it('is neither offered to nor served to anyone else', () => {
    cy.seedStaffAccount().then((account) => {
      const email = `goals-desk-${Date.now()}@example.test`
      const password = 'valencia2026'
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email, password, fullName: 'Fisio' })
      cy.task<string>('db:accessTokenFor', { email, password }).then((token) => {
        cy.request({ url: '/api/goals', headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false }).its('status').should('eq', 403)
      })
      cy.login(email, password)
      cy.visit('/dashboard')
      cy.contains('button', 'Edit layout', { timeout: 20000 })
      cy.clickUntil('button:contains("Edit layout")', 'p:contains("Add a widget")')
      cy.contains('Add a widget').should('be.visible')
      cy.contains('button', '+ Monthly goals').should('not.exist')
    })
  })
})
