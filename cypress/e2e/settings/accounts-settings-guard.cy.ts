// The accounts row holds most of the clinic's settings, and until 30 Sep 2026
// any member could change any of them through the REST API, whatever the
// Settings menu showed them. Each write here is made as the staff member with
// the browser's own key, so what is tested is the database, not the page.

const PASSWORD = 'Test1234!'

function staff(account: { accountId: string; clinicId: string }, patch: Record<string, unknown>) {
  const email = `guard-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch })
  return cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Guard Test' }).then(() => email)
}

function update(email: string, accountId: string, values: Record<string, unknown>) {
  return cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', { email, password: PASSWORD, table: 'accounts', op: 'update', values, match: { id: accountId } })
}

describe('Account settings need the permission of their page', () => {
  it('lets clinic settings change clinic columns, and nothing else', () => {
    cy.seedStaffAccount().then((account) => {
      staff(account, { settings_access: true, clinic_config: true, billing_config: false, communication_config: false, data_admin: false }).then((email) => {
        update(email, account.accountId, { cancellation_fee_cents: 2500, online_booking_max_days_ahead: 60 }).its('changed').should('eq', 1)
        update(email, account.accountId, { invoice_email_subject: 'Tu recibo' }).its('error').should('match', /needs billing_config/)
        update(email, account.accountId, { email_reminder_subject: 'Mañana' }).its('error').should('match', /needs communication_config/)
        update(email, account.accountId, { practicehub_base_url: 'https://evil.example' }).its('error').should('match', /needs data_admin/)
        update(email, account.accountId, { name: 'Otra clínica' }).its('error').should('match', /Only an owner/)
        // Saving a whole form re-sends values it did not change: those are not checked.
        update(email, account.accountId, { cancellation_fee_cents: 2600, invoice_email_subject: null }).its('changed').should('eq', 1)
      })
    })
  })

  it('needs Settings access on top of the page permission', () => {
    cy.seedStaffAccount().then((account) => {
      staff(account, { settings_access: false, communication_config: true }).then((email) => {
        update(email, account.accountId, { google_review_url: 'https://g.page/x' }).its('error').should('match', /needs communication_config/)
      })
    })
  })

  it('still lets an owner change anything', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
        email: account.email,
        password: account.password,
        table: 'accounts',
        op: 'update',
        values: { name: 'Clínica Renombrada', cancellation_fee_cents: 1000, invoice_email_subject: 'Recibo' },
        match: { id: account.accountId },
      }).then((res) => {
        expect(res.error).to.eq(null)
        expect(res.changed).to.eq(1)
      })
    })
  })

  it('keeps the PracticeHub key out of every staff member’s reach', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/import')
      cy.window().then(() =>
        cy.request({ method: 'PUT', url: '/api/import/practicehub-connection', body: { baseUrl: 'https://clinica.practicehub.io', contactEmail: 'a@b.es', apiKey: 'ph-secret-123' } }),
      )
      cy.request('/api/import/practicehub-connection').its('body').should('deep.equal', { baseUrl: 'https://clinica.practicehub.io', contactEmail: 'a@b.es', hasKey: true })
      staff(account, { settings_access: true, data_admin: true }).then((email) => {
        cy.task<{ rows: number }>('db:readAsStaff', { email, password: PASSWORD, table: 'account_secrets', columns: 'value' }).its('rows').should('eq', 0)
        // Nor left behind in the column every member can read.
        cy.task('db:practiceHubKeyColumn', { accountId: account.accountId }).should('eq', null)
      })
    })
  })

  it('sends the stored key only to the stored PracticeHub address', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ baseUrl: string }>('db:startPracticeHubStub', { emails: ['ana@example.com'] }).then(({ baseUrl }) => {
        cy.task('db:setPracticeHubConnection', { accountId: account.accountId, baseUrl, apiKey: 'stored-key' })
        cy.login(account.email, account.password)
        cy.visit('/settings/import')
        // The body names another host; the proxy uses the saved one.
        cy.request({ method: 'POST', url: '/api/import/practicehub-proxy', body: { baseUrl: 'https://attacker.example', appDetails: 'QuiroFlow=a@b.es', path: '/patients' } })
          .its('body.data.0.email')
          .should('eq', 'ana@example.com')
        cy.task('db:practiceHubStubLastKey').should('eq', 'stored-key')
        cy.task('db:stopPracticeHubStub')
      })
    })
  })
})
