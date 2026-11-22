// Settings > Care plans: the clinic's care plan templates
// (care_plan_templates) and what the review at the end of a plan proposes --
// which template "Keep coming" starts, the membership offered with it, the
// months until a discharged patient is back in Recalls and the habits pack
// (cypress/e2e/calendar/plan-renewal.cy.ts covers the review itself). Then
// the other end: a patient's plan started from a template.
type Settings = {
  maintenance_membership_id: string | null
  maintenance_discharge_recall_months: number
  maintenance_habits_article_ids: string[]
  maintenance_habits_on_start: boolean
  maintenance_habits_on_discharge: boolean
}
const COLUMNS = 'maintenance_membership_id, maintenance_discharge_recall_months, maintenance_habits_article_ids, maintenance_habits_on_start, maintenance_habits_on_discharge'

interface TemplateRow {
  id: string
  name: string
  visits_per_period: number
  frequency_value: number
  frequency_unit: string
  total_visits: number | null
  next_phases: unknown[]
  visit_markers: { at: number; every: number | null }[]
  payment_kind: string
  is_maintenance: boolean
}
const TEMPLATE_COLUMNS = 'id, name, visits_per_period, frequency_value, frequency_unit, total_visits, next_phases, visit_markers, payment_kind, is_maintenance'

const openSettings = () => {
  cy.visit('/settings')
  cy.get('a[href="/settings/care-plans"]').first().click()
  cy.location('pathname').should('eq', '/settings/care-plans')
  cy.get('[data-cy=care-plan-settings][data-ready=true]', { timeout: 20000 })
}

describe('Settings > Care plans', () => {
  it('lists templates, the maintenance one first seeded, and creates, edits and deletes others', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      openSettings()

      // Every clinic starts with its maintenance as a template: one a month, no end.
      cy.get('[data-cy=template-row]').should('have.length', 1)
      cy.get('[data-cy=template-name]').should('have.text', 'Mantenimiento')
      cy.get('[data-cy=template-maintenance-badge]').should('exist')
      cy.get('[data-cy=template-summary]').should('contain', 'no end')
      cy.get('[data-cy=template-delete]').should('be.disabled')

      // A set course with a phase after it and a re-exam.
      cy.get('[data-cy=template-new]').click()
      cy.get('[role=dialog]').should('contain', 'New template')
      cy.get('[data-cy=plan-name]').should('have.value', '').type('Fase inicial')
      cy.get('[data-cy=plan-visits-per-period]').clear().type('2')
      cy.get('[data-cy=plan-every]').clear().type('1')
      cy.get('[data-cy=plan-total-visits]').clear().type('12')
      cy.get('[data-cy=plan-next-add]').click()
      cy.get('[data-cy=plan-next-total]').clear().type('6').blur()
      cy.get('[data-cy=plan-phases-summary]').should('have.text', '2× a week · 12 visits → weekly · 6 visits')
      cy.get('[data-cy=plan-marker-add]').click()
      cy.get('[data-cy=plan-pay-bono]').click()
      cy.get('[data-cy=template-pay-note]').should('contain', 'bono is chosen when the plan starts')
      // No patient: no start date, no bono to pick.
      cy.get('[role=dialog]').should('not.contain', 'Start date')
      cy.get('[data-cy=plan-pay-bono-select]').should('not.exist')
      cy.contains('[role=dialog] button', 'Save').click()

      cy.get('[data-cy=template-row]').should('have.length', 2)
      cy.contains('[data-cy=template-row]', 'Fase inicial').should('contain', '2× a week · 12 visits → weekly · 6 visits').and('contain', '1 re-exam').and('contain', 'bono')
      cy.task<TemplateRow[]>('db:selectRows', { table: 'care_plan_templates', columns: TEMPLATE_COLUMNS, match: { account_id: account.accountId, name: 'Fase inicial' } })
        .its('0')
        .should((row) => {
          expect(row).to.include({ visits_per_period: 2, frequency_value: 1, frequency_unit: 'week', total_visits: 12, payment_kind: 'bono', is_maintenance: false })
          expect(row.next_phases).to.deep.equal([{ visits_per_period: 1, frequency_value: 1, frequency_unit: 'week', total_visits: 6 }])
          expect(row.visit_markers).to.have.length(1)
        })

      // Edited in place: the same row, renamed.
      cy.contains('[data-cy=template-row]', 'Fase inicial').find('[data-cy=template-edit]').click()
      cy.get('[role=dialog]').should('contain', 'Edit template')
      cy.get('[data-cy=plan-name]').should('have.value', 'Fase inicial').clear().type('Fase intensiva')
      cy.get('[data-cy=plan-total-visits]').should('have.value', '12')
      cy.contains('[role=dialog] button', 'Save').click()
      cy.contains('[data-cy=template-row]', 'Fase intensiva')
      cy.task<TemplateRow[]>('db:selectRows', { table: 'care_plan_templates', columns: 'id', match: { account_id: account.accountId } }).should('have.length', 2)

      // Deleted, after asking.
      cy.contains('[data-cy=template-row]', 'Fase intensiva').find('[data-cy=template-delete]').click()
      cy.contains('button', 'Delete template').click()
      cy.get('[data-cy=template-row]').should('have.length', 1)
      cy.task<TemplateRow[]>('db:selectRows', { table: 'care_plan_templates', columns: 'id', match: { account_id: account.accountId } }).should('have.length', 1)
    })
  })

  it('saves which template is the maintenance, the membership, discharge and the habits pack', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', { table: 'memberships', rows: [{ account_id: account.accountId, name: 'Cuota de mantenimiento', price_cents: 3500 }] }).then(([membership]) => {
        cy.task<{ id: string }[]>('db:insertRows', {
          table: 'care_plan_templates',
          rows: [{ account_id: account.accountId, name: 'Bienestar', visits_per_period: 1, frequency_value: 3, frequency_unit: 'week', total_visits: 8 }],
        }).then(([wellness]) => {
          cy.task<{ id: string }[]>('db:insertRows', {
            table: 'learn_articles',
            rows: [
              { account_id: account.accountId, title: 'Respirar dos minutos', body: 'Texto.' },
              { account_id: account.accountId, title: 'Tu puesto de trabajo en 5 pasos', body: 'Texto.' },
              { account_id: account.accountId, title: 'Un artículo archivado', body: 'Texto.', archived_at: new Date().toISOString() },
            ],
          }).then(([breathe, desk]) => {
            cy.login(account.email, account.password)
            openSettings()

            // The defaults.
            cy.get('[data-cy=maintenance-template] option:selected').should('contain', 'Mantenimiento')
            cy.get('[data-cy=maintenance-recall-months]').should('have.value', '3')
            cy.get('[data-cy=habits-on-start]').should('be.checked')
            cy.get('[data-cy=habits-on-discharge]').should('not.be.checked')
            cy.get('[data-cy=care-plan-settings-save]').should('be.disabled')

            cy.get('[data-cy=maintenance-template]').select(wellness!.id)
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
            // Disabled while saving as well as once saved, so wait for the
            // toast: the maintenance template is written before the account.
            cy.contains('Saved').should('be.visible')
            cy.get('[data-cy=care-plan-settings-save]').should('be.disabled')
            cy.task<Settings[]>('db:selectRows', { table: 'accounts', columns: COLUMNS, match: { id: account.accountId } }).its('0').should('deep.equal', {
              maintenance_membership_id: membership!.id,
              maintenance_discharge_recall_months: 4,
              maintenance_habits_article_ids: [breathe!.id, desk!.id],
              maintenance_habits_on_start: true,
              maintenance_habits_on_discharge: true,
            })
            // One maintenance: it moved.
            cy.task<TemplateRow[]>('db:selectRows', { table: 'care_plan_templates', columns: 'id, is_maintenance', match: { account_id: account.accountId, is_maintenance: true } })
              .should('have.length', 1)
              .its('0.id')
              .should('eq', wellness!.id)
            cy.contains('[data-cy=template-row]', 'Bienestar').find('[data-cy=template-maintenance-badge]').should('exist')
            cy.contains('[data-cy=template-row]', 'Bienestar').find('[data-cy=template-delete]').should('be.disabled')
            cy.contains('[data-cy=template-row]', 'Mantenimiento').find('[data-cy=template-delete]').should('not.be.disabled')
          })
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
      const write = (email: string, table: string, op: 'insert' | 'update', values: Record<string, unknown>, match?: Record<string, unknown>) =>
        cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', { email, password: PASSWORD, table, op, values, match })
      member(false).then((email) => {
        write(email, 'accounts', 'update', { maintenance_discharge_recall_months: 2 }, { id: account.accountId }).its('error').should('match', /needs clinic_config/)
        write(email, 'care_plan_templates', 'insert', { account_id: account.accountId, name: 'No' }).its('error').should('match', /row-level security/)
        // Everyone reads them, to start a plan from one.
        cy.task<{ rows: unknown[] }>('db:selectAsStaff', { email, password: PASSWORD, table: 'care_plan_templates', columns: 'id', inColumn: 'account_id', inValues: [account.accountId] })
          .its('rows')
          .should('have.length', 1)
      })
      member(true).then((email) => {
        write(email, 'accounts', 'update', { maintenance_discharge_recall_months: 2, maintenance_habits_on_discharge: true }, { id: account.accountId }).its('changed').should('eq', 1)
        write(email, 'care_plan_templates', 'insert', { account_id: account.accountId, name: 'Correctivo', total_visits: 24 }).its('changed').should('eq', 1)
      })
    })
  })

  it("starts a patient's plan from a template, which can still be changed for them", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:insertRows', {
        table: 'care_plan_templates',
        rows: [
          {
            account_id: account.accountId,
            name: 'Fase inicial',
            visits_per_period: 2,
            frequency_value: 1,
            frequency_unit: 'week',
            total_visits: 12,
            next_phases: [{ visits_per_period: 1, frequency_value: 1, frequency_unit: 'week', total_visits: 6 }],
            visit_markers: [{ at: 12, every: null, appointment_type_id: null, label: 'Revisión' }],
          },
        ],
      })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Plantilla' }).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy="care-plan-edit"]').click()
        cy.get('[data-cy=plan-template-select] option').should('contain', 'Fase inicial').and('contain', 'Mantenimiento')
        cy.get('[data-cy=plan-template-select]').select('Fase inicial · 2× a week · 12 visits → weekly · 6 visits')
        cy.get('[data-cy=plan-name]').should('have.value', 'Fase inicial')
        cy.get('[data-cy=plan-visits-per-period]').should('have.value', '2')
        cy.get('[data-cy=plan-total-visits]').should('have.value', '12')
        cy.get('[data-cy=plan-phases-summary]').should('have.text', '2× a week · 12 visits → weekly · 6 visits')
        cy.get('[data-cy=plan-marker]').should('have.length', 1)
        // Changed for this patient only.
        cy.get('[data-cy=plan-total-visits]').clear().type('10')
        cy.contains('[role=dialog] button', 'Save').click()

        cy.task<{ name: string; visits_per_period: number; total_visits: number; next_phases: unknown[]; visit_markers: unknown[] }[]>('db:selectRows', {
          table: 'care_plans',
          columns: 'name, visits_per_period, total_visits, next_phases, visit_markers',
          match: { patient_id: patient.id },
        })
          .its('0')
          .should((plan) => {
            expect(plan).to.include({ name: 'Fase inicial', visits_per_period: 2, total_visits: 10 })
            expect(plan.next_phases).to.have.length(1)
            expect(plan.visit_markers).to.have.length(1)
          })
        // The template is as it was.
        cy.task<TemplateRow[]>('db:selectRows', { table: 'care_plan_templates', columns: 'total_visits', match: { account_id: account.accountId, name: 'Fase inicial' } })
          .its('0.total_visits')
          .should('eq', 12)
      })
    })
  })
})
