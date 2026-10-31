import { todayAt } from '../../support/calendar'

// The line under each room in the day view says who is working there today.
// It used to name the first visit it found: a room two people shared read as
// one person's, and the "Unassigned" column -- visits with no room -- carried
// the name of whoever had one, as if it were their column.

const EVERY_DAY_8_TO_8 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['08:00', '20:00']]]))

describe('Practitioners under the room columns', () => {
  it('names everyone in a shared room, and nobody under Unassigned', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setExtraProfessionals', { accountId: account.accountId, extraProfessionals: 1 })
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_8_TO_8 })
      cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala Compartida' }).then((room) => {
        cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          roleName: 'Practitioner',
          email: `colega-${Date.now()}@example.test`,
          password: 'Test1234!',
          fullName: 'Colega Sala',
          isPractitioner: true,
        }).then((colleague) => {
          cy.task('db:setTeamMemberHours', { teamMemberId: colleague.teamMemberId, hours: EVERY_DAY_8_TO_8 })
          const visit = (first: string, practitionerId: string, h: number, roomId: string | null) =>
            cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Sala' }).then((p) =>
              cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId, startsAt: todayAt(h), roomId }),
            )
          visit('Ana', account.teamMemberId, 10, room.id)
          visit('Bea', colleague.teamMemberId, 11, room.id)
          visit('Carla', colleague.teamMemberId, 12, null)
        })
      })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      // With two practitioners the calendar opens on one of them.
      cy.contains('button', 'Whole clinic').click()
      cy.get('[data-cy=day-column-head][data-room="Sala Compartida"] [data-cy=day-column-staff]').should('have.text', 'Test Owner · Colega Sala')
      cy.get('[data-cy=day-column-head][data-room="Unassigned"]').should('exist').find('[data-cy=day-column-staff]').should('not.exist')
    })
  })
})
