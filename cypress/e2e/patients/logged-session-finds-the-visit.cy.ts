// Logging a bono session while the patient is still in the room invented a
// second visit, and put it down to the front desk.
//
// One patient's 17:00 Informe Quiropráctico was charged €60 and paid by
// card, and a €44 session came off their bono for the same visit. The
// session was logged at 17:55:21, while they were still with the practitioner;
// they were checked out at 17:56:23, 62 seconds later. "Log session" only looked
// for COMPLETED appointments, found none, and so created an off-calendar one
// — recorded against recepcion@example.test, the reception account that was
// signed in, which is not a practitioner at all.
/**
 * The session's effects once it has actually been logged.
 *
 * Polled, because nothing on the page marks the moment the request is done.
 * `cy.contains('Logging…').should('not.exist')` looked like it did, but it
 * passes on its first try whenever it runs before Vue has re-rendered the
 * button into its "Logging…" state -- and cy.task, which reads the database,
 * is never retried. The handler makes four round trips (find the visit, claim
 * the session, invent the visit, record the session), so the read regularly
 * landed before them and found nothing: locally, 7 runs in 8 failed that way
 * with retries off, and in CI it was the second most retried test.
 */
function sessionLogged(patientId: string, packagePurchaseId: string, attempt = 0): Cypress.Chainable<any> {
  return cy.task<any>('db:packageSessionEffects', { patientId, packagePurchaseId }).then((effects) => {
    if (effects.sessions.length > 0 || attempt >= 40) return cy.wrap(effects)
    cy.wait(250)
    return sessionLogged(patientId, packagePurchaseId, attempt + 1)
  })
}

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
          // that patient was in when their session was logged.
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

            cy.get('[data-cy="log-session-open"]').click()
            cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()
            sessionLogged(patient.id, purchase.id).then((effects: any) => {
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

            cy.get('[data-cy="log-session-open"]').click()
            cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()
            sessionLogged(patient.id, purchase.id).then((effects: any) => {
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

  it('warns before inventing a second visit on a day already paid for', () => {
    // Today's visit took the last session of the patient's old bono at
    // checkout; a new bono was sold a minute later and a session logged on it.
    // The visit was no longer unlogged, so the dialog opened on "not on the
    // calendar", already picked, for today -- one click charged the same
    // visit twice. It must now say so, and not make it the default.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Dos', lastName: 'Bonos' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono viejo',
          sessionsTotal: 12,
          sessionsUsed: 11,
          priceCents: 52800,
        }).then((oldBono: any) => {
          cy.task('db:createPackagePurchase', {
            accountId: account.accountId,
            patientId: patient.id,
            packageName: 'Bono nuevo',
            sessionsTotal: 12,
            sessionsUsed: 0,
            priceCents: 48000,
          }).then((newBono: any) => {
            cy.task('db:createAppointment', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              patientId: patient.id,
              practitionerId: account.teamMemberId,
              startsAt: new Date(Date.now() - 60_000).toISOString(),
              status: 'completed',
            }).then((appt: any) => {
              cy.task('db:usePackageSession', {
                accountId: account.accountId,
                patientId: patient.id,
                packagePurchaseId: oldBono.id,
                appointmentId: appt.id,
                amountCents: 4400,
              })
              cy.login(account.email, account.password)
              cy.visit(`/patients/${patient.id}?tab=billing`)

              // The old bono is used up, so the only live button is the new one's.
              cy.get('[data-cy="log-session-open"]:not([disabled])').should('have.length', 1).click()
              cy.get('[data-cy="log-session-day-already-paid"]').should('be.visible').and('contain', 'Bono viejo')
              cy.get('[data-cy="log-session-new"] input[type="radio"]').should('not.be.checked')
              cy.get('[data-cy="confirm-dialog-confirm"]').should('be.disabled')

              // Still possible on purpose -- a second visit the same day is rare, not wrong.
              cy.get('[data-cy="log-session-new"]').click()
              cy.get('[data-cy="log-session-day-already-paid"]').should('be.visible')
              cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled')
              cy.task<any>('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: newBono.id }).then((effects) => {
                expect(effects.sessions.filter((s: any) => s.package_purchase_id === newBono.id).length, 'nothing drawn from the new bono').to.eq(0)
              })
            })
          })
        })
      })
    })
  })

  it('uses no session when the visit it needs cannot be recorded', () => {
    // The visit insert's error used to be discarded: the session was then
    // recorded against no visit and the bono was one session down, with
    // nothing on screen to say so. Forced here, since nothing in a healthy
    // stack makes that insert fail on demand.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sin', lastName: 'Visita' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 52800,
        }).then((purchase: any) => {
          cy.login(account.email, account.password)
          cy.intercept('POST', '**/rest/v1/appointments*', {
            statusCode: 400,
            body: { code: '23502', message: 'forced by the spec', details: null, hint: null },
          }).as('visitInsert')
          cy.visit(`/patients/${patient.id}?tab=billing`)

          const alerts: string[] = []
          cy.on('window:alert', (text) => {
            alerts.push(text)
          })
          cy.get('[data-cy="log-session-open"]').click()
          cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()
          cy.wait('@visitInsert')

          cy.wrap(alerts).should((seen) => {
            expect(seen.join(' '), 'says it did not use a session').to.contain('no session was used')
          })
          cy.task<any>('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((effects) => {
            expect(effects.sessions.length, 'no session recorded').to.eq(0)
            expect(effects.purchase.sessions_used, 'the claimed session given back').to.eq(0)
            expect(effects.invoices.length, 'nothing charged').to.eq(0)
          })
        })
      })
    })
  })
})
