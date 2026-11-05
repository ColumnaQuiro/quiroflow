// Settings > Care plans (20261105163000_clinic_maintenance): the clinic's
// maintenance, the months until a discharged patient is back in Recalls and
// the habits pack -- what the review at the end of a plan proposes
// (cypress/e2e/calendar/plan-renewal.cy.ts covers that side).
type Settings = {
  maintenance_visits_per_period: number
  maintenance_frequency_value: number
  maintenance_frequency_unit: string
  maintenance_total_visits: number | null
  maintenance_membership_id: string | null
  maintenance_discharge_recall_months: number
  maintenance_habits_article_ids: string[]
  maintenance_habits_on_start: boolean
  maintenance_habits_on_discharge: boolean
}
const COLUMNS =
  'maintenance_visits_per_period, maintenance_frequency_value, maintenance_frequency_unit, maintenance_total_visits, maintenance_membership_id, maintenance_discharge_recall_months, maintenance_habits_article_ids, maintenance_habits_on_start, maintenance_habits_on_discharge'

describe('Settings > Care plans', () => {
  it('starts at one visit a month with no end, and saves the clinic’s own maintenance, discharge and habits pack', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', { table: 'memberships', rows: [{ account_id: account.accountId, name: 'Cuota de mantenimiento', price_cents: 3500 }] }).then(([membership]) => {
        cy.task<{ id: string }[]>('db:insertRows', {
          table: 'learn_articles',
          rows: [
            { account_id: account.accountId, title: 'Respirar dos minutos', body: 'Texto.' },
            { account_id: account.accountId, title: 'Tu puesto de trabajo en 5 pasos', body: 'Texto.' },
            { account_id: account.accountId, title: 'Un artículo archivado', body: 'Texto.', archived_at: new Date().toISOString() },
          ],
        }).then(([breathe, desk]) => {
          cy.login(account.email, account.password)
          cy.visit('/settings')
          cy.contains('nav a', 'Care plans').click()
          cy.location('pathname').should('eq', '/settings/care-plans')
          cy.get('[data-cy=care-plan-settings][data-ready=true]', { timeout: 20000 })

          // The defaults.
          cy.get('[data-cy=maintenance-visits]').should('have.value', '1')
          cy.get('[data-cy=maintenance-every]').should('have.value', '1')
          cy.get('[data-cy=maintenance-unit]').should('have.value', 'month')
          cy.get('[data-cy=maintenance-no-end]').should('be.checked')
          cy.get('[data-cy=maintenance-recall-months]').should('have.value', '3')
          cy.get('[data-cy=habits-on-start]').should('be.checked')
          cy.get('[data-cy=habits-on-discharge]').should('not.be.checked')
          cy.get('[data-cy=care-plan-settings-save]').should('be.disabled')

          // One every three weeks, eight visits, with the membership.
          cy.get('[data-cy=maintenance-every]').clear().type('3').blur()
          cy.get('[data-cy=maintenance-unit]').select('week')
          cy.get('[data-cy=maintenance-cadence]').should('contain', 'every 3 weeks')
          cy.get('[data-cy=maintenance-fixed]').check()
          cy.get('[data-cy=maintenance-total]').clear().type('8').blur()
          cy.get('[data-cy=maintenance-membership]').select(membership!.id)
          cy.get('[data-cy=maintenance-recall-months]').clear().type('4')

          // The pack, in order; the archived one is not offered.
          cy.get('[data-cy=habits-pack-add] option').should('not.contain', 'Un artículo archivado')
          cy.get('[data-cy=habits-pack-add]').select('Tu puesto de trabajo en 5 pasos')
          cy.get('[data-cy=habits-pack-add-save]').click()
          cy.get('[data-cy=habits-pack-add]').select('Respirar dos minutos')
          cy.get('[data-cy=habits-pack-add-save]').click()
          cy.get('[data-cy=habits-pack-title]').then((els) => expect([...els].map((e) => e.textContent)).to.deep.equal(['Tu puesto de trabajo en 5 pasos', 'Respirar dos minutos']))
          cy.contains('[data-cy=habits-pack-row]', 'Respirar dos minutos').find('button[aria-label^="Move"][aria-label$="up"]').click()
          cy.get('[data-cy=habits-pack-title]').first().should('have.text', 'Respirar dos minutos')
          cy.get('[data-cy=habits-on-discharge]').check()

          cy.get('[data-cy=care-plan-settings-save]').click()
          cy.get('[data-cy=care-plan-settings-save]').should('be.disabled')
          cy.task<Settings[]>('db:selectRows', { table: 'accounts', columns: COLUMNS, match: { id: account.accountId } }).its('0').should('deep.equal', {
            maintenance_visits_per_period: 1,
            maintenance_frequency_value: 3,
            maintenance_frequency_unit: 'week',
            maintenance_total_visits: 8,
            maintenance_membership_id: membership!.id,
            maintenance_discharge_recall_months: 4,
            maintenance_habits_article_ids: [breathe!.id, desk!.id],
            maintenance_habits_on_start: true,
            maintenance_habits_on_discharge: true,
          })

          // Back to no end, which stores null.
          cy.reload()
          cy.get('[data-cy=care-plan-settings][data-ready=true]', { timeout: 20000 })
          cy.get('[data-cy=maintenance-total]').should('have.value', '8')
          cy.get('[data-cy=maintenance-no-end]').check()
          cy.get('[data-cy=care-plan-settings-save]').click()
          cy.get('[data-cy=care-plan-settings-save]').should('be.disabled')
          cy.task<Settings[]>('db:selectRows', { table: 'accounts', columns: 'maintenance_total_visits', match: { id: account.accountId } }).its('0.maintenance_total_visits').should('eq', null)
        })
      })
    })
  })

  it('is clinic settings in the database: a member with them may change it, one without may not', () => {
    const PASSWORD = 'Test1234!'
    cy.seedStaffAccount().then((account) => {
      const member = (clinicConfig: boolean) => {
        const email = `care-plans-${clinicConfig}-${Date.now()}@example.test`
        cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { settings_access: true, clinic_config: clinicConfig } })
        return cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Guard Test' }).then(() => email)
      }
      const update = (email: string, values: Record<string, unknown>) =>
        cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', { email, password: PASSWORD, table: 'accounts', op: 'update', values, match: { id: account.accountId } })
      member(false).then((email) => {
        update(email, { maintenance_frequency_value: 2 }).its('error').should('match', /needs clinic_config/)
      })
      member(true).then((email) => {
        update(email, { maintenance_frequency_value: 2, maintenance_total_visits: null, maintenance_habits_on_discharge: true }).its('changed').should('eq', 1)
      })
    })
  })
})
