import { SEEDED_PRACTITIONER, dateInputValue, openNewAppointmentPanel, yesterday } from '../../support/calendar'

// A patient booked into a practitioner's calendar was never linked to them.
//
// The booking panel creates the patient from name, email and phone, and the
// appointment records who is seeing them -- but nothing wrote that
// practitioner onto the patient. Beatriz Ferrando's dashboard therefore read
// "0 total patients" beside "13 active": thirteen people she had treated,
// none of them assigned to her. Seven of those thirteen were created through
// this very panel, with her selected in it.
//
// Account-wide it was 1,381 of 1,559 patients with no practitioner at all.
describe('A patient created while booking', () => {
  it('is assigned to the practitioner the appointment is with', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      openNewAppointmentPanel()

      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-new-patient]').click()
        cy.get('input[placeholder="First name"]').type('Nueva')
        cy.get('input[placeholder="Last name"]').type('Asignada')
        cy.contains('[data-cy=create-type]', 'Consultation').click()
        cy.contains('[data-cy=create-practitioner]', SEEDED_PRACTITIONER).click()
        cy.get('input[type="date"]').clear().type(dateInputValue(yesterday()))
        cy.get('[data-cy=create-submit]').click()
      })
      cy.get('[data-cy=create-sheet]').should('not.exist')

      // Assigned in the database, not merely displayed somewhere -- this is
      // the field the dashboard's Total patients counts, and the one the
      // income report would need to attribute money with no appointment.
      cy.task('db:patientByName', { accountId: account.accountId, firstName: 'Nueva', lastName: 'Asignada' }).then((patient: any) => {
        expect(patient, 'the patient was created').to.not.eq(null)
        expect(patient.default_practitioner_id, 'assigned to the booking practitioner').to.eq(account.teamMemberId)
      })
    })
  })

  it('is left unassigned when the appointment has no practitioner', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      openNewAppointmentPanel()

      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-new-patient]').click()
        cy.get('input[placeholder="First name"]').type('Sin')
        cy.get('input[placeholder="Last name"]').type('Practicante')
        cy.contains('[data-cy=create-type]', 'Consultation').click()
        cy.contains('[data-cy=create-practitioner]', 'No practitioner').click()
        cy.get('input[type="date"]').clear().type(dateInputValue(yesterday()))
        cy.get('[data-cy=create-submit]').click()
      })
      cy.get('[data-cy=create-sheet]').should('not.exist')

      // Empty is the honest answer when nobody was named -- better than
      // guessing, which is how a wrong default would spread silently.
      cy.task('db:patientByName', { accountId: account.accountId, firstName: 'Sin', lastName: 'Practicante' }).then((patient: any) => {
        expect(patient, 'the patient was created').to.not.eq(null)
        expect(patient.default_practitioner_id, 'nobody named, nobody assigned').to.eq(null)
      })
    })
  })
})
