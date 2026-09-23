// Moving an appointment asks whether the new time is outside working hours.
// Whose hours it asks about is the whole question.
//
// The grid hatches an hour when NOBODY works it -- on the all-staff tab that
// is the union of every practitioner's schedule, which is right for shading
// and wrong for a move. The check used the same union, so dropping an
// appointment onto a day its own practitioner does not work said nothing at
// all, as long as some colleague worked then.
//
// Lauren McCoy is the case. Booked with Natacha, who works Wednesday
// mornings, reassigned to Jordana, who works Wednesday afternoons only, and
// then moved -- twice -- inside that Wednesday morning. Nothing objected at
// any step, because Natacha's hours kept the morning "open".
//
// Both tests move the same appointment with the same click. Only the
// practitioner's own hours differ, which is the only thing that should decide
// the answer.
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const WHOLE_GRID: [string, string][] = [['08:00', '20:00']]

function todayAt(hour: number, minute = 0) {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

// Hours that cover every day but this one. The appointment's practitioner is
// off today, which is the state the union used to paper over.
function everyDayButToday(): Record<string, [string, string][]> {
  const todayKey = DAY_KEYS[new Date().getDay()]
  return Object.fromEntries(DAY_KEYS.map((d) => [d, d === todayKey ? [] : WHOLE_GRID]))
}

function everyDay(): Record<string, [string, string][]> {
  return Object.fromEntries(DAY_KEYS.map((d) => [d, WHOLE_GRID]))
}

// Seeds one visit at 10:00 today with the owner as its practitioner, plus a
// colleague who works the whole grid today -- so the calendar's own union
// says the day is open whatever the owner's hours say.
function seedMove(ownerHours: Record<string, [string, string][]>) {
  return cy.seedStaffAccount().then((account) => {
    // The seeded plan covers one practitioner and the owner holds that seat.
    cy.task('db:setExtraProfessionals', { accountId: account.accountId, extraProfessionals: 1 })
    cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: ownerHours })
    return cy
      .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email: `colega-${Date.now()}@example.test`,
        password: 'Test1234!',
        fullName: 'Colega Cubre',
        isPractitioner: true,
      })
      .then((colleague) => {
        cy.task('db:setTeamMemberHours', { teamMemberId: colleague.teamMemberId, hours: everyDay() })
        return cy
          .task<{ id: string }>('db:createPatient', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            firstName: 'Lauren',
            lastName: 'Movida',
          })
          .then((patient) => {
            cy.task('db:createAppointment', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              patientId: patient.id,
              practitionerId: account.teamMemberId,
              startsAt: todayAt(10, 0),
            })
            return cy.wrap(account)
          })
      })
  })
}

// The all-staff tab (no practitioner filter) is the default, and it is where
// the union applied. Day view keeps the visit and the target slot in one
// always-visible column.
function enterRescheduleMode() {
  cy.contains('select', 'Work week').select('day')
  cy.contains('Lauren Movida').click({ force: true })
  cy.get('[data-cy=appt-sheet]').should('be.visible')
  cy.get('[data-cy=move-appointment]').click()
  cy.get('[data-cy=appt-sheet]').should('not.exist')
  cy.contains('Rescheduling').should('be.visible')
}

describe('The out-of-hours question on a move', () => {
  it('is asked when the appointment’s own practitioner is off, though a colleague works then', () => {
    seedMove(everyDayButToday()).then((account: any) => {
      const asked: string[] = []
      // Declined, so the appointment should stay exactly where it was -- the
      // dialog firing and the move being abandoned are one assertion.
      cy.on('window:confirm', (text) => {
        asked.push(text)
        return false
      })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      enterRescheduleMode()

      cy.get('[data-cal-col]').first().click(30, 60)

      cy.wrap(asked).should('have.length', 1)
      cy.wrap(asked).its(0).should('contain', 'outside working hours')
      // Declining leaves reschedule mode running and the visit untouched: no
      // confirmation dialog, still at its original time.
      cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
      cy.contains('Lauren Movida').should('be.visible')
    })
  })

  it('is not asked when that practitioner works the time being picked', () => {
    seedMove(everyDay()).then((account: any) => {
      const asked: string[] = []
      cy.on('window:confirm', (text) => {
        asked.push(text)
        return true
      })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      enterRescheduleMode()

      cy.get('[data-cal-col]').first().click(30, 60)

      // Straight to the move's own confirmation, nothing in the way.
      cy.contains('h2', 'Rescheduling Appointment').should('be.visible')
      cy.wrap(asked).should('have.length', 0)
    })
  })
})
