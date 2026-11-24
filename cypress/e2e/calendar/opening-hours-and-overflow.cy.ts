// Three things a clinic asked of the calendar on moving from Quirocitas:
//
// - "Opening hours only": the grid always ran from 08:00, so a clinic that
//   opens at 16:00 scrolled past eight grey hours to reach its first patient.
// - The display switches are remembered. "Hide rescheduled" reset on every
//   reload, so the moved-visit markers came back each morning and read as
//   the visits still being there.
// - Day view's "+N more" opens the visits it folds in. It was a label: the
//   seventh visit at 18:00 could only be reached by switching to rows.

/** Today at hh:mm, local -- the grid ranges from local midnight. */
function todayAt(h: number, m = 0) {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const everyDay = (from: string, to: string) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [[from, to]]]))

const hourMark = (label: string) => cy.get('[data-cy=grid-scroller]').contains('span', new RegExp(`^${label}$`))

describe('Calendar: opening hours, remembered switches, Day view overflow', () => {
  it('fits the grid to the opening hours when asked, and remembers the switches', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: everyDay('16:00', '20:30') })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paula', lastName: 'Tarde' }).then((patient) =>
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: todayAt(17) }),
      )

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      cy.contains('[data-cy=appt-block]', 'Paula Tarde').should('exist')

      // Off by default: the grid starts at 08:00, grey until 16:00.
      hourMark('08:00').should('exist')

      cy.get('[data-cy=display-openHoursOnly]').should('have.attr', 'aria-checked', 'false').click()
      hourMark('08:00').should('not.exist')
      hourMark('15:00').should('not.exist')
      hourMark('16:00').should('exist')
      hourMark('20:00').should('exist')
      cy.contains('[data-cy=appt-block]', 'Paula Tarde').should('exist')

      cy.get('[data-cy=display-hideRescheduled]').click().should('have.attr', 'aria-checked', 'true')

      // Both stay as they were left after a reload.
      cy.reload()
      cy.contains('[data-cy=appt-block]', 'Paula Tarde').should('exist')
      cy.get('[data-cy=display-openHoursOnly]').should('have.attr', 'aria-checked', 'true')
      cy.get('[data-cy=display-hideRescheduled]').should('have.attr', 'aria-checked', 'true')
      hourMark('08:00').should('not.exist')
      hourMark('16:00').should('exist')
    })
  })

  it('lists the visits behind Day view\'s "+N more" and opens the one picked', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: everyDay('09:00', '19:00') })
      cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 1' }).then((room) => {
        // Seven at 10:00 in one room: Day view draws six lanes, five visits
        // and the chip for the other two.
        for (const name of ['Ana', 'Bea', 'Carla', 'Dani', 'Eva', 'Fran', 'Gema']) {
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: name, lastName: 'Diez' }).then((patient) =>
            cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, roomId: room.id, startsAt: todayAt(10) }),
          )
        }
      })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      cy.get('[data-cy=appt-block]').should('have.length', 5)
      cy.get('[data-cy=day-overflow-chip]').should('contain.text', '+2').and('have.attr', 'aria-expanded', 'false').click()
      cy.get('[data-cy=day-overflow-list] [data-cy=day-overflow-entry]').should('have.length', 2).and('contain.text', '10:00')

      // A click elsewhere closes it; the chip opens it again.
      cy.get('body').click(0, 0)
      cy.get('[data-cy=day-overflow-list]').should('not.exist')
      cy.get('[data-cy=day-overflow-chip]').click()

      cy.get('[data-cy=day-overflow-entry]')
        .first()
        .invoke('text')
        .then((text) => {
          const name = text.replace('10:00', '').trim()
          cy.get('[data-cy=day-overflow-entry]').first().click()
          cy.get('[data-cy=day-overflow-list]').should('not.exist')
          cy.get('[data-cy=appt-sheet]').should('contain.text', name)
        })
    })
  })
})
