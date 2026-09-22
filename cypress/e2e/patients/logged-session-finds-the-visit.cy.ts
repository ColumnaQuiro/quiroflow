// Logging a bono session while the patient is still in the room invented a
// second visit, and put it down to the front desk.
//
// Tomas Berenguer: his 17:00 Informe Quiropráctico was charged €60 and
// paid by card, and a €44 session came off his bono for the same visit. The
// session was logged at 17:55:21, while he was still with the practitioner;
// he was checked out at 17:56:23, 62 seconds later. "Log session" only looked
// for COMPLETED appointments, found none, and so created an off-calendar one
// — recorded against recepcion@example.test, the reception account that was
// signed in, which is not a practitioner at all.
describe('Logging a bono session', () => {
  it('attaches to the visit the patient is in, rather than inventing one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Enla', lastName: 'Sala' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 52800,
        }).then((purchase: any) => {
          // Arrived and with the practitioner, not yet checked out — the state
          // Tomas was in when his session was logged.
          cy.task('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            practitionerId: account.teamMemberId,
            startsAt: new Date().toISOString(),
            status: 'booked',
            checkedIn: true,
          }).then((appt: any) => {
            cy.login(account.email, account.password)
            cy.visit(`/patients/${patient.id}?tab=billing`)

            cy.contains('button', 'Log session').click()
            cy.on('window:confirm', () => true)
            cy.contains('Logging…').should('not.exist')

            cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((effects: any) => {
              expect(effects.sessions.length, 'one session').to.eq(1)
              // The visit he was actually in — no second appointment invented.
              expect(effects.sessions[0].appointment_id, 'attached to the real visit').to.eq(appt.id)
              expect(effects.appointments.length, 'no phantom appointment').to.eq(1)
            })
          })
        })
      })
    })
  })

  it('credits the patient’s practitioner when it has to invent the visit', () => {
    cy.seedStaffAccount().then((account) => {
      // The seeded plan covers one practitioner and the owner already holds
      // that seat; this test needs a second person to tell "the patient's
      // practitioner" apart from "whoever clicked".
      cy.task('db:setExtraProfessionals', { accountId: account.accountId, extraProfessionals: 1 })
      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email: `trata-${Date.now()}@example.test`,
        password: 'Test1234!',
        fullName: 'Trata Dora',
        isPractitioner: true,
      }).then((practitioner: any) => {
        cy.task('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Fuera',
          lastName: 'Agenda',
          defaultPractitionerId: practitioner.teamMemberId,
        }).then((patient: any) => {
          cy.task('db:createPackagePurchase', {
            accountId: account.accountId,
            patientId: patient.id,
            packageName: 'Bono 12',
            sessionsTotal: 12,
            sessionsUsed: 0,
            priceCents: 52800,
          }).then((purchase: any) => {
            // No appointment at all: genuinely off-calendar, so one is created.
            cy.login(account.email, account.password)
            cy.visit(`/patients/${patient.id}?tab=billing`)

            cy.contains('button', 'Log session').click()
            cy.on('window:confirm', () => true)
            cy.contains('Logging…').should('not.exist')

            cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((effects: any) => {
              expect(effects.sessions.length, 'one session').to.eq(1)
              expect(effects.appointments.length, 'the visit was invented').to.eq(1)
            })
            // The treating practitioner, not the signed-in receptionist.
            cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((effects: any) => {
              expect(effects.appointments[0].practitioner_id, 'credited to the patient’s practitioner').to.eq(practitioner.teamMemberId)
              expect(effects.appointments[0].practitioner_id, 'not whoever clicked').to.not.eq(account.teamMemberId)
            })
          })
        })
      })
    })
  })
})
