// "Semana laboral" used to be Monday to Friday for every clinic. One that
// opens on Saturdays had to switch to "Semana" to see it, and then carry an
// empty Sunday column all week. The work week is now the days somebody
// works, from the same hours that hatch "Fuera de horario", plus any day
// that has a visit on it -- so a one-off Sunday appointment is never hidden.

const WINDOW: [string, string][] = [['09:00', '19:00']]

function hoursOn(days: string[]): Record<string, [string, string][]> {
  return Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, days.includes(d) ? WINDOW : []]))
}

/** Sunday of the week being shown (weeks start on Monday), at 11:00 local. */
function thisSundayAt11() {
  const d = new Date()
  d.setHours(11, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 6)
  return d.toISOString()
}

function openWorkWeek(account: { email: string; password: string }) {
  cy.login(account.email, account.password)
  cy.visit('/calendar')
  cy.contains('select', 'Work week').should('have.value', 'workweek')
}

function shownDays() {
  return cy.get('[data-cy=week-day-col]').then((cols) => [...cols].map((c) => c.getAttribute('data-day')))
}

describe('Work week', () => {
  it('includes Saturday for someone who works Monday to Saturday, and leaves Sunday out', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: hoursOn(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']) })
      openWorkWeek(account)
      cy.get('[data-cy=week-day-col]').should('have.length', 6)
      shownDays().should('deep.equal', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
    })
  })

  it('still shows a closed day that has a visit on it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: hoursOn(['mon', 'tue', 'wed', 'thu', 'fri']) })
      cy.task<{ id: string }>('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Domingo',
        lastName: 'Excepcional',
      }).then((patient) => {
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          practitionerId: account.teamMemberId,
          startsAt: thisSundayAt11(),
        })
      })
      openWorkWeek(account)
      cy.get('[data-cy=week-day-col]').should('have.length', 6)
      shownDays().should('deep.equal', ['mon', 'tue', 'wed', 'thu', 'fri', 'sun'])
    })
  })
})
