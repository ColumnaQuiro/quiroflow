import { assertDayGridShows, yesterday } from '../../support/calendar'

// Reception could press the bono button again and take a second session for
// the same visit.
//
// Adrian Oropeza's Bono 12: two package_sessions rows against one
// appointment, 18 seconds apart, 88 EUR of a 528 EUR bono gone on a single
// visit. The compare-and-set in usePackageSession does not catch it -- that
// defends a SHARED bono drawn on from two patients' screens at once, where
// the second write must lose. A second click on the same screen is not that:
// it reads the count the first one left behind and claims the next session
// quite legally. Nothing ever asked whether this appointment had already
// taken one.
const bookedDay = yesterday()

function at(day: Date, hour: number): string {
  const d = new Date(day)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

describe('A visit drawing on a bono', () => {
  it('takes one session however many times the button is pressed', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Adri', lastName: 'Doblecl' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 52800,
        }).then((purchase: any) => {
          // Yesterday, because AppointmentBillingTab bills nothing for a visit
          // that has not happened yet. Practitioner set, or loadAppointments
          // filters it out of every tab and it never reaches the grid.
          cy.task('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            practitionerId: account.teamMemberId,
            startsAt: at(bookedDay, 10),
            status: 'completed',
          })

          cy.login(account.email, account.password)
          cy.visit('/calendar')
          cy.contains('select', 'Work week').select('day')
          cy.get('[aria-label="Previous"]').click()
          assertDayGridShows(bookedDay)
          cy.contains('Adri Doblecl').should('be.visible').click({ force: true })
          cy.contains('h2', 'Edit Appointment').should('be.visible')

          cy.get('.fixed.inset-0.z-50').within(() => {
            cy.contains('button', 'billing').click()
            cy.contains('button', 'Use Bono 12', { timeout: 15000 }).click()
            cy.contains('Covered by', { timeout: 15000 }).should('be.visible')

            // Leave the tab and come back -- the route reception took to a
            // second press. The panel must not offer the bono again.
            cy.contains('button', 'details').click()
            cy.contains('button', 'billing').click()
            cy.contains('Covered by', { timeout: 15000 }).should('be.visible')
            cy.contains('button', 'Use Bono 12').should('not.exist')
          })

          cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((effects: any) => {
            expect(effects.sessions.length, 'package_sessions rows').to.eq(1)
            expect(effects.purchase.sessions_used, 'sessions_used on the bono').to.eq(1)

            // And the rule holds below the screen. The button is gone, so the
            // UI cannot ask for a second session any more -- this is what
            // stops the mobile app, a race, or the next thing written here
            // from taking one.
            cy.task('db:insertDuplicateSession', {
              accountId: account.accountId,
              patientId: patient.id,
              packagePurchaseId: purchase.id,
              appointmentId: effects.sessions[0].appointment_id,
              amountCents: 4400,
            }).then((res: any) => {
              expect(res.rejected, `second session refused (${res.message})`).to.eq(true)
            })
          })
        })
      })
    })
  })
})
