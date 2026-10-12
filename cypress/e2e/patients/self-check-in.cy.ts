// "Ya estoy aquí": the patient checks themselves in on arrival
// (check_in_my_appointment, via /api/portal/appointments/check-in). The visit
// shows as arrived for the clinic; the window and repeats are the database's
// to refuse; and the desk's QR (/portal/check-in) brings a patient who is not
// signed in back to the check-in after they sign in.
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

describe('Patient self check-in', () => {
  it('checks in from the portal home, and the clinic sees them arrived', () => {
    const email = `checkin-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Llega' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(30) }).then((appt) => {
          cy.login(email, password)
          cy.visit('/portal')
          cy.get('[data-cy=patient-check-in]').should('contain.text', "I'm here").click()
          cy.get('[data-cy=patient-checked-in]').should('be.visible')
          cy.task<{ checked_in_at: string | null }>('db:appointmentById', { appointmentId: appt.id }).its('checked_in_at').should('not.be.null')
          // Pressing again keeps the first arrival.
          cy.task<{ checked_in_at: string }>('db:appointmentById', { appointmentId: appt.id }).then((first) => {
            cy.task<{ data: string | null }>('db:callRpcAs', { email, password, fn: 'check_in_my_appointment', args: { p_appointment_id: appt.id } }).its('data').then((again) => {
              expect(Date.parse(again!)).to.eq(Date.parse(first.checked_in_at))
            })
          })
        })
      })
    })
  })

  it('refuses a visit hours away, and offers nothing for it', () => {
    const email = `checkin-early-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Leo', lastName: 'Pronto' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(5 * 60) }).then((appt) => {
          cy.task<{ data: string | null; error: string | null }>('db:callRpcAs', { email, password, fn: 'check_in_my_appointment', args: { p_appointment_id: appt.id } }).its('data').should('be.null')
          cy.login(email, password)
          cy.visit('/portal/check-in')
          cy.get('[data-cy=portal-check-in-none]').should('be.visible')
          cy.visit('/portal')
          cy.contains('Your next visit').should('be.visible')
          cy.get('[data-cy=patient-check-in]').should('not.exist')
        })
      })
    })
  })

  it('the desk QR signs them in and brings them back to check in', () => {
    const email = `checkin-qr-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ada', lastName: 'Escanea' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(-10) })
        cy.visit('/portal/check-in')
        cy.location('pathname').should('eq', '/portal/login')
        cy.location('search').then((s) => expect(decodeURIComponent(s)).to.contain('next=/portal/check-in'))
        cy.get('input#email').type(email)
        cy.get('input#password').type(password, { log: false })
        cy.get('form').submit()
        cy.location('pathname').should('eq', '/portal/check-in')
        // Ten minutes late: still before it ends, so still on.
        cy.get('[data-cy=portal-check-in] [data-cy=patient-check-in]').click()
        cy.get('[data-cy=patient-checked-in]').should('be.visible')
      })
    })
  })
})
