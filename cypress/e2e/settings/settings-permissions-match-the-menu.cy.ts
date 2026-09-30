// Found in the settings QA round (30 Sep 2026): places where what a role could
// do in the database, or reach by address, did not match what the Settings
// menu gives it. Every write here is made as the staff member, with the
// browser's own key -- so what is tested is the policy, not whether a button
// happened to be hidden.

const PASSWORD = 'Test1234!'

function member(account: { accountId: string; clinicId: string }, patch: Record<string, unknown>) {
  const email = `perm-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch })
  return cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Perm Test' }).then(() => email)
}

describe('Settings permissions match the menu', () => {
  it('lets anyone who fills in forms read the document templates, while only communication settings edits them', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createDocTemplate', { accountId: account.accountId, title: 'Consentimiento', category: 'consent' })
      member(account, { communication_config: false, patients_scope: 'all' }).then((email) => {
        cy.task<{ rows: number; error: string | null }>('db:readAsStaff', { email, password: PASSWORD, table: 'doc_templates', columns: 'id' }).its('rows').should('eq', 1)
        cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
          email,
          password: PASSWORD,
          table: 'doc_templates',
          op: 'insert',
          values: { account_id: account.accountId, title: 'Not mine to make', fields: [] },
        }).its('error').should('match', /row-level security/)
      })
    })
  })

  it('shows Saved Replies to whoever can manage them, without Inbox access', () => {
    cy.seedStaffAccount().then((account) => {
      member(account, { settings_access: true, communication_config: true, inbox_access: false }).then((email) => {
        cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
          email,
          password: PASSWORD,
          table: 'saved_replies',
          op: 'insert',
          values: { account_id: account.accountId, title: 'Horario', body: 'De 9 a 20.' },
        }).then((res) => {
          expect(res.error).to.eq(null)
          expect(res.changed).to.eq(1)
        })
        cy.task<{ rows: number }>('db:readAsStaff', { email, password: PASSWORD, table: 'saved_replies', columns: 'id' }).its('rows').should('eq', 1)
      })
    })
  })

  it('keeps payment methods to billing settings, and the two system ones to nobody', () => {
    cy.seedStaffAccount().then((account) => {
      member(account, { settings_access: true, billing_config: false }).then((email) => {
        cy.task<{ rows: number }>('db:readAsStaff', { email, password: PASSWORD, table: 'payment_methods', columns: 'id' }).its('rows').should('be.greaterThan', 0)
        cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
          email,
          password: PASSWORD,
          table: 'payment_methods',
          op: 'insert',
          values: { account_id: account.accountId, key: 'bizum_2', name: 'Bizum 2', sort_order: 50 },
        }).its('error').should('match', /row-level security/)
      })
      member(account, { settings_access: true, billing_config: true }).then((email) => {
        cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
          email,
          password: PASSWORD,
          table: 'payment_methods',
          op: 'insert',
          values: { account_id: account.accountId, key: 'bizum_2', name: 'Bizum 2', sort_order: 50 },
        }).its('changed').should('eq', 1)
        // Credit on account carries behaviour; nobody renames or switches it off.
        cy.task<{ changed: number }>('db:settingsWriteAsStaff', {
          email,
          password: PASSWORD,
          table: 'payment_methods',
          op: 'update',
          values: { is_active: false },
          match: { account_id: account.accountId, key: 'credit' },
        }).its('changed').should('eq', 0)
      })
    })
  })

  it('refuses a plain-http webhook in the database, not only on the page', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
        email: account.email,
        password: account.password,
        table: 'webhooks',
        op: 'insert',
        values: { account_id: account.accountId, url: 'http://insecure.example.test/hook', events: ['appointment.created'] },
      }).its('error').should('match', /webhooks_url_is_https/)
    })
  })

  it('keeps who sends VeriFactu records to an owner', () => {
    cy.seedStaffAccount().then((account) => {
      member(account, { settings_access: true, billing_config: true, clinic_config: true }).then((email) => {
        cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
          email,
          password: PASSWORD,
          table: 'accounts',
          op: 'update',
          values: { verifactu_sender: 'apoderamiento' },
          match: { id: account.accountId },
        }).its('error').should('match', /Only an owner/)
      })
    })
  })

  it('gates Online Booking, Scheduling Policies and New Patient Fields like the menu, and shows only the cards a role can open', () => {
    cy.seedStaffAccount().then((account) => {
      member(account, { settings_access: true, clinic_config: false, billing_config: false, communication_config: true, dashboard_scope: 'all' }).then((email) => {
        cy.login(email, PASSWORD)
        for (const path of ['/settings/online-booking', '/settings/reschedule-reasons', '/settings/new-patient-fields']) {
          cy.visit(path)
          cy.location('pathname', { timeout: 20000 }).should('eq', '/dashboard')
        }
        cy.visit('/settings')
        cy.contains('a', 'Messages').should('have.attr', 'href', '/settings/messages')
        for (const hidden of ['Online Booking', 'Services & Products', 'Team', 'VeriFactu', 'API & Tokens']) {
          cy.contains('a', hidden).should('not.exist')
        }
      })
    })
  })
})
