import { todayAt } from '../../support/calendar'

// "Revisión" at the end of a care plan (AppointmentsPlanRenewal): a plan with
// two visits or fewer left flags the visit on My Day, shows how it went, and
// offers what comes next -- keep coming, prefilled with the clinic's
// maintenance (Settings > Care plans), with its membership and its habits
// pack; or discharge, back into Recalls after the clinic's months.
const daysAgo = (d: number) => {
  const at = new Date(todayAt(10, 0))
  at.setDate(at.getDate() - d)
  return at.toISOString()
}

type PlanRow = { name: string; frequency_value: number; frequency_unit: string; visits_per_period: number; total_visits: number | null; payment_kind: string; package_purchase_id: string | null; patient_membership_id: string | null }
const PLAN_COLUMNS = 'name, frequency_value, frequency_unit, visits_per_period, total_visits, payment_kind, package_purchase_id, patient_membership_id'

describe('Plan renewal at the review', () => {
  // Two visits a week, three in all, two attended, the third today.
  function endingPlan() {
    return cy.seedStaffAccount().then((account) =>
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rita', lastName: 'Revisa' }).then((patient) => {
        cy.task('db:insertRows', { table: 'care_plans', rows: [{ account_id: account.accountId, patient_id: patient.id, name: 'Plan lumbar', frequency_value: 1, frequency_unit: 'week', visits_per_period: 2, total_visits: 3, started_at: daysAgo(30).slice(0, 10) }] })
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

  it("proposes the default maintenance -- one a month, no end -- and creates it with its bono", () => {
    endingPlan().then(({ account, patient }) => {
      cy.task('db:insertRows', { table: 'packages', rows: [{ account_id: account.accountId, name: 'Bono mantenimiento 8', session_count: 8, price_cents: 28000 }] })
      openVisit(account)
      cy.get('[data-cy=plan-renewal-continue]').should('have.attr', 'aria-checked', 'true')
      cy.get('[data-cy=plan-renewal-every]').should('have.value', '1')
      cy.get('[data-cy=plan-renewal-unit]').should('have.value', 'month')
      cy.get('[data-cy=plan-renewal-no-end]').should('be.checked')
      // Nothing configured, so neither a membership nor a habits pack is offered.
      cy.get('[data-cy=plan-renewal-membership]').should('not.exist')
      cy.get('[data-cy=plan-renewal-habits]').should('not.exist')
      cy.get('[data-cy=plan-renewal-bono]').select('Bono mantenimiento 8')
      cy.get('[data-cy=plan-renewal-create-bono]').click()
      cy.get('[data-cy=plan-renewal-done]').should('contain', 'Maintenance created').and('contain', 'Bono mantenimiento 8')
      cy.task<PlanRow[]>('db:selectRows', { table: 'care_plans', columns: PLAN_COLUMNS, match: { patient_id: patient.id, name: 'Maintenance' } }).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]).to.include({ frequency_value: 1, frequency_unit: 'month', visits_per_period: 1, total_visits: null, payment_kind: 'bono' })
        expect(rows[0]!.package_purchase_id).not.to.be.null
        cy.task('db:selectRows', { table: 'package_purchases', columns: 'owed_cents, sessions_total', match: { id: rows[0]!.package_purchase_id } }).its('0').should('deep.equal', { owed_cents: 28000, sessions_total: 8 })
      })
      // No money was taken: the desk collects it.
      cy.task('db:selectRows', { table: 'payments', columns: 'id', match: { patient_id: patient.id } }).should('have.length', 0)
    })
  })

  it("uses the clinic's maintenance, goes back to the old cadence in place, enrols the membership and sends only the new readings", () => {
    endingPlan().then(({ account, patient }) => {
      cy.task<{ id: string }[]>('db:insertRows', { table: 'memberships', rows: [{ account_id: account.accountId, name: 'Cuota de mantenimiento', price_cents: 3500 }] }).then(([membership]) => {
        cy.task<{ id: string; title: string }[]>('db:insertRows', {
          table: 'learn_articles',
          rows: [
            { account_id: account.accountId, title: 'Tu puesto de trabajo en 5 pasos', body: 'Texto.' },
            { account_id: account.accountId, title: 'Cómo dormir para cuidar tu espalda', body: 'Texto.' },
            { account_id: account.accountId, title: 'Levantar peso sin cargar la espalda', body: 'Texto.' },
          ],
        }).then((articles) => {
          const [desk, sleep, lifting] = articles
          // The third was sent before: it is listed but not sent again.
          cy.task('db:insertRows', { table: 'learn_sends', rows: [{ account_id: account.accountId, patient_id: patient.id, article_id: lifting!.id, sent_by: account.teamMemberId }] })
          cy.task('db:updateRows', {
            table: 'accounts',
            match: { id: account.accountId },
            values: {
              maintenance_visits_per_period: 1,
              maintenance_frequency_value: 3,
              maintenance_frequency_unit: 'week',
              maintenance_total_visits: 8,
              maintenance_membership_id: membership!.id,
              maintenance_habits_article_ids: [desk!.id, sleep!.id, lifting!.id],
            },
          })
          openVisit(account)
          cy.get('[data-cy=plan-renewal-every]').should('have.value', '3')
          cy.get('[data-cy=plan-renewal-unit]').should('have.value', 'week')
          cy.get('[data-cy=plan-renewal-total]').should('have.value', '8')
          cy.get('[data-cy=plan-renewal-membership]').should('be.checked')
          cy.get('[data-cy=plan-renewal-habits]').should('contain', 'Send the habits pack').and('contain', '2 readings')
          cy.contains('[data-cy=plan-renewal-habit]', 'Levantar peso').should('contain', 'already has it')
          cy.get('[data-cy=plan-renewal-habits-send]').should('be.checked')

          // Back to the two a week they had, keeping the eight visits.
          cy.get('[data-cy=plan-renewal-previous]').should('contain', '2× a week')
          cy.get('[data-cy=plan-renewal-use-previous]').click()
          cy.get('[data-cy=plan-renewal-per-period]').should('have.value', '2')
          cy.get('[data-cy=plan-renewal-every]').should('have.value', '1')
          cy.get('[data-cy=plan-renewal-total]').should('have.value', '8')
          cy.get('[data-cy=plan-renewal-name]').should('have.value', 'Plan lumbar')
          // A membership pays for it, so no bono is offered beside it.
          cy.get('[data-cy=plan-renewal-bono]').should('not.exist')
          cy.get('[data-cy=plan-renewal-create]').click()
          cy.get('[data-cy=plan-renewal-done]').should('contain', 'Plan lumbar created, paid by Cuota de mantenimiento').and('contain', 'Habits pack sent')

          cy.task<{ id: string; membership_id: string; status: string }[]>('db:selectRows', { table: 'patient_memberships', columns: 'id, membership_id, status', match: { patient_id: patient.id } }).then((members) => {
            expect(members).to.have.length(1)
            expect(members[0]).to.include({ membership_id: membership!.id, status: 'active' })
            cy.task<PlanRow[]>('db:selectRows', { table: 'care_plans', columns: PLAN_COLUMNS, match: { patient_id: patient.id, name: 'Plan lumbar', total_visits: 8 } }).then((rows) => {
              expect(rows).to.have.length(1)
              expect(rows[0]).to.include({ frequency_value: 1, frequency_unit: 'week', visits_per_period: 2, payment_kind: 'membership', patient_membership_id: members[0]!.id })
            })
          })
          cy.task<{ article_id: string }[]>('db:selectRows', { table: 'learn_sends', columns: 'article_id', match: { patient_id: patient.id } }).then((sends) => {
            expect(sends.map((s) => s.article_id).sort()).to.deep.equal([desk!.id, sleep!.id, lifting!.id].sort())
          })
        })
      })
    })
  })

  it("discharges them back into Recalls after the clinic's months", () => {
    endingPlan().then(({ account, patient }) => {
      cy.task('db:updateRows', { table: 'accounts', match: { id: account.accountId }, values: { maintenance_discharge_recall_months: 6 } })
      openVisit(account)
      cy.get('[data-cy=plan-renewal-discharge]').should('contain', 'Back in Recalls in 6 months').click()
      cy.get('[data-cy=plan-renewal-confirm-discharge]').click()
      cy.get('[data-cy=plan-renewal-done]').should('contain', 'back in Recalls')
      cy.task<{ recall_snoozed_until: string }[]>('db:selectRows', { table: 'patients', columns: 'recall_snoozed_until', match: { id: patient.id } }).its('0.recall_snoozed_until').then((d) => {
        const days = (Date.parse(`${d}T12:00:00`) - Date.now()) / 86_400_000
        expect(days).to.be.within(178, 185)
      })
      cy.task('db:selectRows', { table: 'care_plans', columns: 'id', match: { patient_id: patient.id } }).should('have.length', 1)
    })
  })

  it('never asks for a review on a plan with no end, and the record says where they are in it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Mario', lastName: 'Mantiene' }).then((patient) => {
        cy.task('db:insertRows', { table: 'care_plans', rows: [{ account_id: account.accountId, patient_id: patient.id, name: 'Mantenimiento', frequency_value: 1, frequency_unit: 'month', visits_per_period: 1, total_visits: null, started_at: daysAgo(100).slice(0, 10) }] })
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysAgo(60), status: 'completed' })
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysAgo(30), status: 'completed' })
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: todayAt(10, 0) })
        cy.login(account.email, account.password)
        cy.visit('/practitioner')
        cy.contains('li:not([data-cy=needs-confirming-row])', 'Mario Mantiene', { timeout: 20000 }).should('not.contain', 'Review').click()
        cy.get('[data-cy=rail-plan-position]').should('contain', 'maintenance visit 3, since')
        cy.get('[data-cy=plan-renewal]').should('not.exist')

        // Nothing booked after today: the record warns.
        cy.task('db:updateRows', { table: 'appointments', match: { patient_id: patient.id, status: 'booked' }, values: { status: 'completed' } })
        cy.visit(`/patients/${patient.id}`)
        cy.get('[data-cy=overview-plan-open-ended]', { timeout: 20000 }).should('contain', 'maintenance visit 3, since')
        cy.get('[data-cy=overview-plan-no-next]').should('contain', 'No next visit booked')
        cy.get('[data-cy=overview-plan-book]').should('contain', 'Book the next 6 visits')
      })
    })
  })
})
