import { dateInputValue, todayAt } from '../../support/calendar'

// A care plan can mark its re-exam visits -- "every 3rd visit", optionally
// "booked as Revisión" (care_plans.visit_markers). The marked visit says so on
// the calendar block and in its panel; booked as another type it is flagged
// there, listed on Care Plan Alerts, and put right in one click; and the
// booking form warns before it happens, or books a series' re-exams as the
// plan's type itself. Visits are counted, not dated: the Nth appointment since
// the plan started that was not cancelled, missed or deleted.

function daysFromNow(days: number, h = 10) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(h, 0, 0, 0)
  return d
}
function nextWeekday(weekday: number, h: number, minDays = 3): Date {
  const d = daysFromNow(minDays, h)
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1)
  return d
}

type Account = { accountId: string; clinicId: string; teamMemberId: string; email: string; password: string }

/** Two visits done, on a plan whose every 3rd visit is a re-exam -- so the next one booked is visit 3. */
function patientDueAReexam(account: Account, firstName: string, reexamTypeId: string | null, ajusteId: string) {
  return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Plan' }).then((patient) =>
    cy
      .task<{ id: string }>('db:createCarePlan', { accountId: account.accountId, patientId: patient.id, totalVisits: 6, startedAt: dateInputValue(daysFromNow(-30)) })
      .then((plan) => {
        cy.task('db:updateRows', { table: 'care_plans', values: { visit_markers: [{ at: 3, every: 3, appointment_type_id: reexamTypeId, label: null }] }, match: { id: plan.id } })
        for (const days of [-20, -10]) {
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(days).toISOString(), status: 'completed', appointmentTypeId: ajusteId })
        }
        // Cancelled and missed visits are not visits: these do not make the next one visit 5.
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(-8).toISOString(), status: 'cancelled', appointmentTypeId: ajusteId })
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(-6).toISOString(), status: 'no_show', appointmentTypeId: ajusteId })
      })
      .then(() => patient),
  )
}

function seedTypes(account: Account) {
  return cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30, stage: 'adjustment' }).then((ajuste) =>
    cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Revisión', durationMinutes: 30, stage: 'revision' }).then((revision) => ({ ajusteId: ajuste.id, revisionId: revision.id })),
  )
}

describe('Care plan re-exam visits', () => {
  it('are set on the plan as visit N, then every N, booked as a type', () => {
    cy.seedStaffAccount().then((account) => {
      seedTypes(account).then(({ revisionId }) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marta', lastName: 'Plan' }).then((patient) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=clinical`)
          cy.get('[data-cy="care-plan-edit"]', { timeout: 20000 }).click()
          cy.get('[data-cy="plan-marker-add"]').click()
          cy.get('[data-cy="plan-marker"]').should('have.length', 1)
          cy.get('[data-cy="plan-marker-preview"]').should('have.text', 'Visits 12, 24, 36…')
          cy.get('[data-cy="plan-marker-type"]').select('Booked as Revisión')
          // A second, one-off highlight with no type: visit 3.
          cy.get('[data-cy="plan-marker-add"]').click()
          cy.get('[data-cy="plan-marker"]').eq(1).within(() => {
            cy.get('[data-cy="plan-marker-at"]').clear().type('3')
            cy.get('[data-cy="plan-marker-repeat"]').uncheck()
            cy.get('[data-cy="plan-marker-type"]').select('Any type (highlight only)')
            cy.get('[data-cy="plan-marker-label"]').type('Fotos')
            cy.get('[data-cy="plan-marker-preview"]').should('have.text', 'Visit 3 only')
          })
          cy.contains('button', 'Save').click()

          cy.get('[data-cy="care-plan-marker"]').should('have.length', 2)
          cy.get('[data-cy="care-plan-marker"]').eq(0).should('contain', 'Re-exam · visits 12, 24, 36…')
          cy.get('[data-cy="care-plan-marker"]').eq(1).should('contain', 'Fotos · visit 3')
          cy.task<{ visit_markers: unknown }[]>('db:selectRows', { table: 'care_plans', columns: 'visit_markers', match: { patient_id: patient.id } })
            .its('0.visit_markers')
            .should('deep.equal', [
              { at: 12, every: 12, appointment_type_id: revisionId, label: null },
              { at: 3, every: null, appointment_type_id: null, label: 'Fotos' },
            ])

          // "Edit plan" starts a new phase, and the re-exams come with it.
          cy.get('[data-cy="care-plan-edit"]').click()
          cy.get('[data-cy="plan-marker"]').should('have.length', 2)
        })
      })
    })
  })

  it('are marked on the calendar, and one booked as the wrong type is flagged and put right from its panel', () => {
    cy.seedStaffAccount().then((account) => {
      seedTypes(account).then(({ ajusteId, revisionId }) => {
        patientDueAReexam(account, 'Rosa', revisionId, ajusteId).then((patient) => {
          cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: todayAt(18), appointmentTypeId: ajusteId }).then((visit) => {
            cy.login(account.email, account.password)
            cy.visit('/calendar', { onBeforeLoad: (win) => win.localStorage.setItem('quiroflow-calendar-view-mode', 'day') })
            cy.contains('[data-cy=appt-block]', 'Rosa Plan', { timeout: 20000 }).find('[data-cy=appt-block-marker]').should('have.attr', 'data-mismatch', 'true')
            cy.contains('[data-cy=appt-block]', 'Rosa Plan').click()
            cy.get('[data-cy=appt-marker]').should('contain', 'Visit 3 of the plan · Revisión').and('have.attr', 'data-mismatch', 'true')
            cy.get('[data-cy=appt-marker-mismatch]').should('contain', 'The plan books it as Revisión; this is booked as Ajuste.')
            cy.get('[data-cy=appt-marker-fix]').click()
            cy.get('[data-cy=appt-marker]').should('not.have.attr', 'data-mismatch')
            cy.get('[data-cy=appt-marker-fix]').should('not.exist')
            cy.task<{ appointment_type_id: string }[]>('db:selectRows', { table: 'appointments', columns: 'appointment_type_id', match: { id: visit.id } }).its('0.appointment_type_id').should('eq', revisionId)
            cy.contains('[data-cy=appt-block]', 'Rosa Plan').find('[data-cy=appt-block-marker]').should('not.have.attr', 'data-mismatch')
          })
        })
      })
    })
  })

  it('booked as the wrong type are listed on Care Plan Alerts, and highlights without a type are not', () => {
    cy.seedStaffAccount().then((account) => {
      seedTypes(account).then(({ ajusteId, revisionId }) => {
        patientDueAReexam(account, 'Lucas', revisionId, ajusteId).then((typed) => {
          patientDueAReexam(account, 'Irene', null, ajusteId).then((highlight) => {
            for (const p of [typed, highlight]) {
              cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(2, 11).toISOString(), appointmentTypeId: ajusteId })
            }
            cy.login(account.email, account.password)
            cy.visit('/care-plan-alerts')
            cy.get('[data-cy=marker-mismatch-row]').should('have.length', 1)
            cy.contains('[data-cy=marker-mismatch-row]', 'Lucas Plan').should('contain', '3 · Revisión').and('contain', 'Ajuste')
            cy.contains('[data-cy=marker-mismatch-row]', 'Lucas Plan').find('[data-cy=marker-mismatch-fix]').click()
            cy.get('[data-cy=marker-mismatches]').should('contain', 'Every upcoming re-exam is booked as its plan says.')
            cy.task<{ appointment_type_id: string }[]>('db:selectRows', { table: 'appointments', columns: 'appointment_type_id, status', match: { patient_id: typed.id, status: 'booked' } })
              .its('0.appointment_type_id')
              .should('eq', revisionId)
          })
        })
      })
    })
  })

  it('are warned about when booking one visit, and booked as the plan says in a series', () => {
    cy.seedStaffAccount().then((account) => {
      seedTypes(account).then(({ ajusteId, revisionId }) => {
        patientDueAReexam(account, 'Nora', revisionId, ajusteId).then((patient) => {
          cy.intercept('POST', '/api/appointments/send-series-confirmation', { success: true, first: true, list: [] })
          cy.login(account.email, account.password)
          cy.visit(`/calendar?patient=${patient.id}&repeat=plan`)
          cy.get('[data-cy=booking-for]').should('contain.text', 'Nora Plan')
          cy.get('[data-testid="practitioner-tabs"]').contains('button', 'Test Owner').should('be.visible')
          cy.clickUntil('button:contains("New Appointment")', '[data-cy=create-sheet]')
          const first = nextWeekday(1, 10)
          cy.get('[data-cy=create-sheet]').within(() => {
            cy.contains('[data-cy=create-type]', 'Ajuste').click()
            cy.get('input[type="date"]').clear().type(dateInputValue(first))
            cy.get('input[type="time"]').clear().type('10:00')
            cy.get('[data-cy=create-more] summary').click()
            // Following the plan once it has loaded -- choosing before then is
            // undone by that prefill.
            cy.contains('label', 'Repeat').find('select').should('have.value', 'care_plan')
            cy.get('[data-cy=create-series-markers]').should('contain', '3 (').and('contain', '6 (')

            // One visit: the next is visit 3, and Ajuste is not what the plan says.
            cy.contains('label', 'Repeat').find('select').select('none')
            cy.get('[data-cy=create-marker]').should('contain', 'Visit 3 of the plan · Revisión').and('have.attr', 'data-mismatch', 'true')
            cy.get('[data-cy=create-marker-fix]').click()
            cy.contains('[data-cy=create-type]', 'Revisión').should('have.attr', 'aria-checked', 'true')
            cy.get('[data-cy=create-marker]').should('not.have.attr', 'data-mismatch')

            // The rest of the plan as a series, picked as Ajuste: visits 3 to 6,
            // of which 3 and 6 are re-exams and go in as Revisión.
            cy.contains('[data-cy=create-type]', 'Ajuste').click()
            cy.contains('label', 'Repeat').find('select').select('care_plan')
            cy.get('[data-cy=create-series-markers]').should('contain', '3 (').and('contain', '6 (')
            cy.get('[data-cy=create-submit]').click()
          })
          cy.get('[data-cy=create-sheet]').should('not.exist')
          cy.task<{ starts_at: string; appointment_type_id: string }[]>('db:selectRows', { table: 'appointments', columns: 'starts_at, appointment_type_id', match: { patient_id: patient.id, status: 'booked' } }).then((rows) => {
            const types = [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((r) => (r.appointment_type_id === revisionId ? 'Revisión' : r.appointment_type_id === ajusteId ? 'Ajuste' : r.appointment_type_id))
            expect(types).to.deep.equal(['Revisión', 'Ajuste', 'Ajuste', 'Revisión'])
          })
        })
      })
    })
  })
})
