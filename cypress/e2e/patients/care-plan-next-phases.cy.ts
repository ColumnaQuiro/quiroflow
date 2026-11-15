// A care plan that changes cadence partway: "2 visits a week for 2 visits,
// then 1 a week for 3" (care_plans.next_phases). The next phase is set up
// with the plan, and starts by itself -- as an ordinary plan -- when the
// visit that finishes the current one is marked done.

function daysFromNow(days: number, h = 10) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(h, 0, 0, 0)
  return d
}
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const utcDayAfter = (iso: string) => {
  const d = new Date(iso)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString().slice(0, 10)
}

interface PlanRow {
  frequency_value: number
  frequency_unit: string
  visits_per_period: number
  total_visits: number | null
  started_at: string
  next_phases: unknown[]
  created_at: string
}

describe('Care plan next phases', () => {
  it('queues a next phase from the plan dialog and shows it on the plan', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruno', lastName: 'Fases' }).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy="care-plan-edit"]').click()
        cy.get('[data-cy="plan-visits-per-period"]').clear().type('2')
        cy.get('[data-cy="plan-every"]').clear().type('1')
        cy.get('[data-cy="plan-total-visits"]').clear().type('8')
        cy.get('[data-cy="plan-next-add"]').click()
        // One step less often than the phase before: 2 a week -> 1 a week.
        cy.get('[data-cy="plan-next-per-period"]').should('have.value', '1')
        cy.get('[data-cy="plan-next-every"]').should('have.value', '1')
        cy.get('[data-cy="plan-next-total"]').clear().type('4').blur()
        cy.get('[data-cy="plan-phases-summary"]').should('have.text', '2× a week · 8 visits → weekly · 4 visits')
        cy.contains('button', 'Save').click()

        cy.get('[data-cy="care-plan-next-phase"]').should('have.length', 1).and('contain', 'Then:').and('contain', 'weekly · 4 visits')
        cy.task<PlanRow[]>('db:selectRows', { table: 'care_plans', columns: 'total_visits, next_phases', match: { patient_id: patient.id } })
          .its('0')
          .should('deep.equal', { total_visits: 8, next_phases: [{ visits_per_period: 1, frequency_value: 1, frequency_unit: 'week', total_visits: 4 }] })
      })
    })
  })

  it('starts the next phase by itself when the last visit of the current one is done', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Alba', lastName: 'Fases' }).then((patient) => {
        cy.task<{ id: string }>('db:createCarePlan', {
          accountId: account.accountId,
          patientId: patient.id,
          totalVisits: 2,
          visitsPerPeriod: 2,
          startedAt: localDate(daysFromNow(-10)),
        }).then((plan) => {
          cy.task('db:updateRows', {
            table: 'care_plans',
            values: { next_phases: [{ visits_per_period: 1, frequency_value: 1, frequency_unit: 'week', total_visits: 3 }] },
            match: { id: plan.id },
          })
        })
        const appt = (days: number, status: string) =>
          cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(days).toISOString(), status })
        appt(-8, 'completed')
        // One of two done: still the first phase.
        cy.task<PlanRow[]>('db:selectRows', { table: 'care_plans', columns: 'total_visits', match: { patient_id: patient.id } }).should('have.length', 1)

        const last = daysFromNow(-3).toISOString()
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: last, status: 'booked' }).then((a) => {
          cy.task('db:updateRows', { table: 'appointments', values: { status: 'completed' }, match: { id: a.id } })
        })

        cy.task<PlanRow[]>('db:selectRows', { table: 'care_plans', columns: 'frequency_value, frequency_unit, visits_per_period, total_visits, started_at, next_phases, created_at', match: { patient_id: patient.id } }).then((rows) => {
          expect(rows).to.have.length(2)
          const next = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]!
          expect(next).to.include({ frequency_value: 1, frequency_unit: 'week', visits_per_period: 1, total_visits: 3, started_at: utcDayAfter(last) })
          expect(next.next_phases).to.deep.equal([])
        })

        // A later visit completes inside the new phase; nothing more is queued.
        appt(-1, 'completed')
        cy.task<PlanRow[]>('db:selectRows', { table: 'care_plans', columns: 'total_visits', match: { patient_id: patient.id } }).should('have.length', 2)

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy="care-plan-summary"]').should('contain', '1 of 3 visits').and('contain', 'weekly')
        cy.get('[data-cy="care-plan-next-phase"]').should('not.exist')
      })
    })
  })
})
