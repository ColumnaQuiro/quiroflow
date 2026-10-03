import { dateInputValue, openNewAppointmentPanel } from '../../support/calendar'

// Deleting a visit leaves its row, with deleted_at set and the status still
// 'booked'. Two readers took that row for a real booking: the calendar's
// "Sin próxima" check, which then stayed quiet for a patient with nothing
// ahead, and the create panel's care-plan count, which booked one session
// too few for every deleted one. And the panel's own clash list could be
// overwritten by the answer for a date no longer on screen.

/** Today at hh:mm, local -- the grid ranges from local midnight. */
function today(h: number, m = 0) {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
function daysFromNow(days: number, h = 10) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(h, 0, 0, 0)
  return d
}

describe('Deleted visits are not bookings', () => {
  it('flags "No next visit" when the only visit ahead was deleted', () => {
    cy.seedStaffAccount().then((account) => {
      const visit = (first: string, extra: Record<string, unknown>) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Prueba' }).then((p) => {
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: today(10), status: 'completed' })
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(7).toISOString(), ...extra })
        })
      visit('Borrada', { deletedAt: new Date().toISOString() })
      visit('Reservada', {})

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      cy.contains('[data-cy=appt-block]', 'Borrada Prueba').find('[data-cy=appt-block-no-next]').should('contain.text', 'No next visit')
      cy.contains('[data-cy=appt-block]', 'Reservada Prueba').should('exist').find('[data-cy=appt-block-no-next]').should('not.exist')
    })
  })

  it('offers the care-plan sessions a deleted booking no longer holds', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Marín' }).then((patient) => {
        const started = daysFromNow(-14)
        cy.task('db:createCarePlan', { accountId: account.accountId, patientId: patient.id, totalVisits: 6, startedAt: dateInputValue(started) })
        const appt = (startsAt: Date, extra: Record<string, unknown>) =>
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: startsAt.toISOString(), ...extra })
        appt(daysFromNow(-7), { status: 'completed' })
        appt(daysFromNow(7), {})
        appt(daysFromNow(14), { deletedAt: new Date().toISOString() })

        cy.login(account.email, account.password)
        cy.visit(`/calendar?patient=${patient.id}`)
        cy.get('[data-cy=booking-for]').should('contain.text', 'Lucía Marín')
        cy.get('[data-testid="practitioner-tabs"]').contains('button', 'Test Owner').should('be.visible')
        cy.clickUntil('button:contains("New Appointment")', '[data-cy=create-sheet]')
        cy.get('[data-cy=create-patient-selected]').should('contain.text', 'Lucía Marín')
        // 6 in the plan, 1 done, 1 booked: 4 to book. The deleted one is not
        // a booking.
        cy.get('[data-cy=create-sheet] option[value=care_plan]').should('contain.text', '4 sessions left')
      })
    })
  })

  it('keeps the clash of the date on screen when an older date answers late', () => {
    cy.seedStaffAccount().then((account) => {
      const later = daysFromNow(30, 11)
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Clara', lastName: 'Vidal' }).then((clara) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: clara.id, practitionerId: account.teamMemberId, startsAt: later.toISOString() })
      })
      const laterFrom = new Date(later)
      laterFrom.setHours(0, 0, 0, 0)
      // The panel's own read of who is booked: every one of them is held
      // back, except the one for the date the test moves to.
      cy.intercept({ method: 'GET', url: '**/rest/v1/appointments*' }, (req) => {
        const url = decodeURIComponent(req.url)
        if (!url.includes('select=id,starts_at,ends_at,practitioner_id,room_id,patients(first_name,last_name)')) return
        if (url.includes(`starts_at=gte.${laterFrom.toISOString()}`)) return
        req.on('response', (res) => {
          res.setDelay(4000)
        })
      }).as('booked')

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      openNewAppointmentPanel()
      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('input[type="time"]').clear().type('11:00')
        cy.get('input[type="date"]').clear().type(dateInputValue(later))
        cy.get('[data-cy=create-clash]').should('contain.text', 'Clara Vidal at 11:00')
      })
      // The held-back answer for the first date lands now; it must not wipe
      // out the clash on the date being booked.
      cy.wait(5000)
      cy.get('[data-cy=create-clash]').should('contain.text', 'Clara Vidal at 11:00')
    })
  })
})
