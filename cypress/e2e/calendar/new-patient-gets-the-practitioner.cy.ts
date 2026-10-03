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

  // The panel asked for the new patient's id back in the inserting statement.
  // For someone who sees only their own patients that read is checked against
  // my_own_patient_ids() as it stood before the insert -- without the new
  // patient -- so it failed with a row-level-security error however the
  // practitioner was set, and a practitioner could not book anyone new.
  it('can be created by a practitioner who sees only their own patients', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setExtraProfessionals', { accountId: account.accountId, extraProfessionals: 1 })
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      const email = `prac-book-${Date.now()}@example.test`
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email,
        password: 'Test1234!',
        fullName: 'Prac Propia',
        isPractitioner: true,
      }).then((prac) => {
        cy.login(email, 'Test1234!')
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        openNewAppointmentPanel('Prac Propia')

        cy.get('[data-cy=create-sheet]').within(() => {
          cy.get('[data-cy=create-new-patient]').click()
          cy.get('input[placeholder="First name"]').type('Nueva')
          cy.get('input[placeholder="Last name"]').type('DeLaPractica')
          cy.get('input[type="tel"]').type('600765432')
          cy.contains('[data-cy=create-type]', 'Consultation').click()
          cy.contains('[data-cy=create-practitioner]', 'Prac Propia').click()
          cy.get('input[type="date"]').clear().type(dateInputValue(yesterday()))
          cy.get('[data-cy=create-submit]').click()
        })
        cy.get('[data-cy=create-sheet]').should('not.exist')

        cy.task('db:patientByName', { accountId: account.accountId, firstName: 'Nueva', lastName: 'DeLaPractica' }).then((patient: any) => {
          expect(patient, 'the patient was created').to.not.eq(null)
          expect(patient.default_practitioner_id).to.eq(prac.teamMemberId)
          cy.task<{ numbers: { number: string }[] }>('db:patientWithContacts', { id: patient.id }).its('numbers.0.number').should('eq', '600765432')
        })
      })
    })
  })
})
