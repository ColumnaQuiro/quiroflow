// A moved visit on the calendar: the visit itself always shows where it now
// is, and the slot it left behind carries a faded "Moved to ..." marker.
// "Hide rescheduled" hides only those markers.
//
// It used to hide every appointment that had ever been moved, wherever it
// now sat -- so a confirmed visit moved into today vanished from today, and
// a completed one from its past day, the moment the switch was on.

/** Today / tomorrow / yesterday at hh:mm, local -- the grid ranges from local midnight. */
function at(dayOffset: number, h: number, m = 0) {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))

describe('Calendar: rescheduled visits', () => {
  it('always shows the moved visit, and a marker at the slot it left that the switch hides', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 1' }).then((room) => {
        cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
        const movedVisit = (first: string, last: string, fromStartsAt: string, toStartsAt: string, extra: Record<string, unknown> = {}) =>
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: last }).then((patient) =>
            cy
              .task<{ id: string }>('db:createAppointment', {
                accountId: account.accountId,
                clinicId: account.clinicId,
                patientId: patient.id,
                practitionerId: account.teamMemberId,
                roomId: room.id,
                startsAt: toStartsAt,
                rescheduled: true,
                ...extra,
              })
              .then((appt) => cy.task('db:createReschedule', { accountId: account.accountId, appointmentId: appt.id, fromStartsAt, toStartsAt })),
          )
        // Moved INTO today and confirmed: a real visit today.
        movedVisit('Rosa', 'Real', at(-1, 11), at(0, 11), { confirmationStatus: 'confirmed' })
        // Moved OUT of today to tomorrow: today keeps only a marker.
        movedVisit('Marta', 'Movida', at(0, 16), at(1, 16))
        // Moved within today, 10:00 -> 12:00: the visit at 12, a marker at 10.
        movedVisit('Carlos', 'Mismo', at(0, 10), at(0, 12))
      })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      const block = (name: string) => cy.contains('[data-cy=appt-block]', name)
      const marker = (name: string) => cy.contains('[data-cy=moved-away-marker]', name)

      block('Rosa Real').should('have.attr', 'data-stage', 'confirmed')
      block('Carlos Mismo').should('exist')
      marker('Marta Movida').scrollIntoView().should('contain.text', 'Moved to').and('be.visible')
      marker('Carlos Mismo').should('contain.text', 'Moved to 12:00')
      // Only a marker for Marta today -- the visit itself is tomorrow.
      cy.contains('[data-cy=appt-block]', 'Marta Movida').should('not.exist')

      // The switch takes the markers away and leaves every visit.
      cy.get('[data-cy=display-hideRescheduled]').click()
      cy.get('[data-cy=moved-away-marker]').should('not.exist')
      block('Rosa Real').should('have.attr', 'data-stage', 'confirmed')
      block('Carlos Mismo').should('exist')

      cy.get('[data-cy=display-hideRescheduled]').click()
      // A marker opens the visit it stands for.
      marker('Marta Movida').scrollIntoView().click()
      cy.get('[data-cy=appt-sheet]').should('contain.text', 'Marta Movida')
    })
  })
})
