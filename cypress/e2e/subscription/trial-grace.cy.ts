// The end of a free trial with no card: a grace week with everything working,
// then read-only -- never a lock screen
// (supabase/migrations/20261120184541_trial_grace_then_read_only.sql).
const DAY = 86_400_000
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString()
const runCron = () =>
  cy.request<{ locked: number; notices: { accountId: string; notice: string; delivered: boolean }[] }>({
    method: 'POST',
    url: '/api/billing/trial-expiry-cron',
    headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' },
  })
const statusOf = (accountId: string) =>
  cy.task<{ status: string; trial_notices_sent: string[] }[]>('db:selectRows', { table: 'subscriptions', columns: 'status, trial_notices_sent', match: { account_id: accountId } }).its(0)

describe('The end of a free trial: grace week, then read-only', () => {
  it('keeps an ended trial working for a week, says so every day, and only then turns it read-only', () => {
    cy.seedStaffAccount().then((graceAccount) => {
      cy.seedStaffAccount().then((overdueAccount) => {
        cy.task('db:updateRows', { table: 'subscriptions', values: { trial_ends_at: daysFromNow(-2) }, match: { account_id: graceAccount.accountId } })
        cy.task('db:updateRows', { table: 'subscriptions', values: { trial_ends_at: daysFromNow(-8) }, match: { account_id: overdueAccount.accountId } })

        runCron().then((res) => {
          expect(res.status).to.eq(200)
          const forGrace = res.body.notices.filter((n) => n.accountId === graceAccount.accountId).map((n) => n.notice)
          expect(forGrace).to.include('ended')
          expect(forGrace).to.include('founder_3')
          expect(res.body.notices.filter((n) => n.accountId === overdueAccount.accountId).map((n) => n.notice)).to.deep.eq(['read_only'])
        })
        statusOf(graceAccount.accountId).should((row) => {
          expect(row.status).to.eq('trialing')
          expect(row.trial_notices_sent).to.include.members(['ended', 'founder_3'])
        })
        statusOf(overdueAccount.accountId).its('status').should('eq', 'locked')

        // A second run the same day sends nothing again.
        runCron().its('body.notices').then((notices: { accountId: string }[]) => {
          expect(notices.filter((n) => n.accountId === graceAccount.accountId || n.accountId === overdueAccount.accountId)).to.have.length(0)
        })

        // In the grace week the app works, says when it turns read-only, and
        // asks the owner once a day.
        cy.login(graceAccount.email, graceAccount.password)
        cy.visit('/dashboard')
        cy.get('[data-cy=grace-banner]').should('contain.text', 'Your free trial ended on').and('contain.text', 'or the account becomes read-only')
        cy.get('[data-cy=add-card-dialog-body]').should('contain.text', 'Everything keeps working until').and('contain.text', 'Billing counts from')
        cy.get('[data-cy=confirm-dialog-cancel]').click()
        cy.get('[data-cy=add-card-dialog-body]').should('not.exist')
        cy.reload()
        cy.get('[data-cy=grace-banner]').should('be.visible')
        cy.get('[data-cy=add-card-dialog-body]').should('not.exist')

        cy.visit('/subscription')
        cy.get('[data-cy=trial-ended-banner]').should('contain.text', 'Your free trial has ended').and('contain.text', 'The first payment counts from')
      })
    })
  })

  it('refuses changes to a read-only account in the database, and asks for a card in the app', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createReferralSource', { accountId: account.accountId, name: 'Radio local' })
      cy.setSubscriptionStatus(account.accountId, 'locked')

      // Straight through PostgREST, as the browser's own session would.
      cy.task<{ error: string | null; code: string | null; details: string | null }>('db:updateAsStaff', {
        email: account.email,
        password: account.password,
        table: 'clinics',
        values: { name: 'Renamed while read-only' },
        match: { id: account.clinicId },
      }).should((r) => {
        expect(r.code).to.eq('PT423')
        expect(r.details).to.eq('account_read_only')
      })
      // A person's own preferences are not the clinic's work, and still save.
      cy.task<{ error: string | null }>('db:updateAsStaff', {
        email: account.email,
        password: account.password,
        table: 'team_members',
        values: { theme_preference: 'dark' },
        match: { id: account.teamMemberId },
      }).its('error').should('be.null')

      cy.login(account.email, account.password)
      cy.visit('/settings/referral-sources')
      cy.get('[data-cy=confirm-dialog-cancel]').click()
      cy.get('[data-cy="settings-list"][data-ready="true"]')
      cy.contains('[data-cy="source-row"]', 'Radio local').find('[data-cy="source-delete"]').click()
      cy.get('[data-cy=add-card-dialog-body]').should('contain.text', 'That change was not saved.')
      cy.get('[data-cy=confirm-dialog-confirm]').should('have.text', 'Add a card').click()
      cy.location('pathname').should('eq', '/subscription')
      cy.task<unknown[]>('db:selectRows', { table: 'referral_sources', columns: 'id', match: { account_id: account.accountId, name: 'Radio local' } }).should('have.length', 1)
    })
  })

  it('pauses online booking while the account is read-only, and takes it again once it is not', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía' }).then((patient) => {
        const booking = {
          account_id: account.accountId,
          clinic_id: account.clinicId,
          practitioner_id: account.teamMemberId,
          patient_id: patient.id,
          starts_at: daysFromNow(3),
          ends_at: new Date(Date.now() + 3 * DAY + 30 * 60_000).toISOString(),
          status: 'booked',
          source: 'online',
        }
        cy.setSubscriptionStatus(account.accountId, 'locked')
        cy.task<{ error: string | null }>('db:tryInsertRows', { table: 'appointments', rows: [booking] }).its('error').should('contain', 'Clinic not available for online booking')
        cy.setSubscriptionStatus(account.accountId, 'active')
        cy.task<{ error: string | null }>('db:tryInsertRows', { table: 'appointments', rows: [booking] }).its('error').should('be.null')
      })
    })
  })
})
