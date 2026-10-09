import { dateInputValue } from '../../support/calendar'

// "Reservar las visitas que faltan" on a patient's care plan opens the
// calendar's new appointment already following the plan, and a series booked
// that way tells the patient once -- the first visit's confirmation and the
// list of dates (send-series-confirmation) -- not once per visit.

function nextWeekday(weekday: number, h: number, minDays = 3): Date {
  const d = new Date()
  d.setDate(d.getDate() + minDays)
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1)
  d.setHours(h, 0, 0, 0)
  return d
}

describe("Booking a care plan's visits", () => {
  it('goes from the plan to a series that follows it, confirmed once', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30 })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nerea', lastName: 'Font' }).then((patient) => {
        cy.task('db:createCarePlan', { accountId: account.accountId, patientId: patient.id, totalVisits: 3, name: 'Plan cervical' })

        let singles = 0
        cy.intercept('POST', '/api/appointments/send-confirmation', (req) => {
          singles++
          req.reply({ success: true })
        })
        cy.intercept('POST', '/api/appointments/send-series-confirmation', { success: true, first: true, list: [] }).as('series')

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy="care-plan-book"]', { timeout: 20000 }).should('contain', 'Book the 3 visits left')
        cy.get('[data-cy="care-plan-book-open"]').click()
        cy.location('search').should('include', `patient=${patient.id}`).and('include', 'repeat=plan')
        cy.get('[data-cy=booking-for]').should('contain.text', 'Nerea Font')

        cy.get('[data-testid="practitioner-tabs"]').contains('button', 'Test Owner').should('be.visible')
        cy.clickUntil('button:contains("New Appointment")', '[data-cy=create-sheet]')
        const first = nextWeekday(1, 10)
        cy.get('[data-cy=create-sheet]').within(() => {
          cy.contains('[data-cy=create-type]', 'Ajuste').click()
          cy.get('input[type="date"]').clear().type(dateInputValue(first))
          cy.get('input[type="time"]').clear().type('10:00')
          cy.get('[data-cy=create-more] summary').click()
          // Already following the plan.
          cy.contains('label', 'Repeat').find('select').should('have.value', 'care_plan')
          cy.get('[data-cy=create-send-confirmation]').should('be.checked')
          cy.get('[data-cy=create-submit]').click()
        })
        cy.get('[data-cy=create-sheet]').should('not.exist')

        cy.wait('@series').its('request.body.appointmentIds').should('have.length', 3)
        cy.then(() => expect(singles, 'no per-visit confirmations').to.equal(0))
        cy.task<{ starts_at: string }[]>('db:selectRows', { table: 'appointments', columns: 'starts_at', match: { patient_id: patient.id } }).should('have.length', 3)

        // Nothing left to book now.
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.contains('Plan cervical', { timeout: 20000 }).should('be.visible')
        cy.contains('0 completed').should('exist')
        cy.get('[data-cy="care-plan-book"]').should('not.exist')
      })
    })
  })

  it('only confirms one patient at a time, in the member\'s own account', () => {
    cy.seedStaffAccount().then((account) => {
      const at = (d: number) => nextWeekday(2, 11, d).toISOString()
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Uno', lastName: 'Serie' }).then((a) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Dos', lastName: 'Serie' }).then((b) => {
          cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: a.id, practitionerId: account.teamMemberId, startsAt: at(3) }).then((a1) => {
            cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: a.id, practitionerId: account.teamMemberId, startsAt: at(10) }).then((a2) => {
              cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: b.id, practitionerId: account.teamMemberId, startsAt: at(17) }).then((b1) => {
                cy.login(account.email, account.password)
                cy.visit('/calendar')
                const send = (ids: string[]) => cy.request({ method: 'POST', url: '/api/appointments/send-series-confirmation', body: { appointmentIds: ids }, failOnStatusCode: false })
                send([a1.id, b1.id]).its('status').should('eq', 400)
                send([a1.id, a2.id]).its('status').should('eq', 200)
                cy.seedStaffAccount().then((other) => {
                  cy.clearAllCookies()
                  cy.clearAllLocalStorage()
                  cy.login(other.email, other.password)
                  cy.visit('/calendar')
                  send([a1.id, a2.id]).its('status').should('eq', 404)
                })
              })
            })
          })
        })
      })
    })
  })
})
