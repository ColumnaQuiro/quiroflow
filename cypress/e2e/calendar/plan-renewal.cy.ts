import { todayAt } from '../../support/calendar'

// "Revisión" at the end of a care plan (AppointmentsPlanRenewal): a plan with
// two visits or fewer left flags the visit on My Day, shows how it went, and
// offers what comes next -- a new plan (with its bono, owed for the desk to
// collect) or discharge, back into Recalls in three months.
const daysAgo = (d: number) => {
  const at = new Date(todayAt(10, 0))
  at.setDate(at.getDate() - d)
  return at.toISOString()
}

describe('Plan renewal at the review', () => {
  function endingPlan() {
    return cy.seedStaffAccount().then((account) =>
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rita', lastName: 'Revisa' }).then((patient) => {
        cy.task('db:insertRows', { table: 'care_plans', rows: [{ account_id: account.accountId, patient_id: patient.id, name: 'Plan lumbar', frequency_value: 1, frequency_unit: 'week', visits_per_period: 1, total_visits: 3, started_at: daysAgo(30).slice(0, 10) }] })
        const past = (d: number, score: number) =>
          cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysAgo(d), status: 'completed' }).then((a) => {
            cy.task('db:insertRows', { table: 'visit_pain_scores', rows: [{ account_id: account.accountId, appointment_id: a.id, practitioner_score: score }] })
          })
        past(14, 7)
        past(7, 3)
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: todayAt(10, 0) })
        return cy.wrap({ account, patient })
      }),
    )
  }
  function openVisit(account: { email: string; password: string }) {
    cy.login(account.email, account.password)
    cy.visit('/practitioner')
    cy.get('[data-cy=worklist-renewal]', { timeout: 20000 }).should('contain', 'Review')
    cy.contains('li:not([data-cy=needs-confirming-row])', 'Rita Revisa').click()
    cy.get('[data-cy=plan-renewal]').should('contain', 'Plan lumbar ends in 1 visit')
    cy.get('[data-cy=plan-renewal-pain]').should('have.text', '7 → 3')
    cy.get('[data-cy=plan-renewal-visits]').should('have.text', '2/3')
  }

  it('creates the next plan with its bono, owed for the desk to collect', () => {
    endingPlan().then(({ account, patient }) => {
      cy.task('db:insertRows', { table: 'packages', rows: [{ account_id: account.accountId, name: 'Bono mantenimiento 8', session_count: 8, price_cents: 28000 }] })
      openVisit(account)
      cy.get('[data-cy=plan-renewal-maintenance]').should('have.attr', 'aria-checked', 'true')
      cy.get('[data-cy=plan-renewal-bono]').select('Bono mantenimiento 8')
      cy.get('[data-cy=plan-renewal-create-bono]').click()
      cy.get('[data-cy=plan-renewal-done]').should('contain', 'Maintenance created').and('contain', 'Bono mantenimiento 8')
      cy.task<{ name: string; frequency_value: number; total_visits: number; payment_kind: string; package_purchase_id: string | null }[]>('db:selectRows', { table: 'care_plans', columns: 'name, frequency_value, total_visits, payment_kind, package_purchase_id', match: { patient_id: patient.id, name: 'Maintenance' } }).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]).to.include({ frequency_value: 3, total_visits: 8, payment_kind: 'bono' })
        expect(rows[0]!.package_purchase_id).not.to.be.null
        cy.task('db:selectRows', { table: 'package_purchases', columns: 'owed_cents, sessions_total', match: { id: rows[0]!.package_purchase_id } }).its('0').should('deep.equal', { owed_cents: 28000, sessions_total: 8 })
      })
      // No money was taken: the desk collects it.
      cy.task('db:selectRows', { table: 'payments', columns: 'id', match: { patient_id: patient.id } }).should('have.length', 0)
    })
  })

  it('discharges them back into Recalls in three months', () => {
    endingPlan().then(({ account, patient }) => {
      openVisit(account)
      cy.get('[data-cy=plan-renewal-discharge]').click()
      cy.get('[data-cy=plan-renewal-confirm-discharge]').click()
      cy.get('[data-cy=plan-renewal-done]').should('contain', 'back in Recalls')
      cy.task<{ recall_snoozed_until: string }[]>('db:selectRows', { table: 'patients', columns: 'recall_snoozed_until', match: { id: patient.id } }).its('0.recall_snoozed_until').then((d) => {
        const days = (Date.parse(`${d}T12:00:00`) - Date.now()) / 86_400_000
        expect(days).to.be.within(88, 91)
      })
      cy.task('db:selectRows', { table: 'care_plans', columns: 'id', match: { patient_id: patient.id } }).should('have.length', 1)
    })
  })
})
