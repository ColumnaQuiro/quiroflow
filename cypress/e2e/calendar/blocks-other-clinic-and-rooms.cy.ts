import type { StaffAccount } from '../../support/commands'
import { dateInputValue, openNewAppointmentPanel, seedVisit, todayAt } from '../../support/calendar'

// What the desk is warned about before a visit lands somewhere.
//
// - A practitioner's own block at their OTHER clinic is still their time:
//   moving a visit into it, or booking a new one over it, asked nothing,
//   because both checks read blocks for the clinic on screen only. A closure
//   of the whole other clinic stays that clinic's own.
// - A block on a ROOM counted when a visit was moved into that room, but the
//   new-appointment panel booked straight into it.
// - "Cambiar" moved a visit to a new time without the appointment_reschedules
//   row a drag or "Mover…" writes, so the move was missing from the visit's
//   history and the calendar's "moved from here" markers.

const MIN = 60 * 1000

function hourPx(): Cypress.Chainable<number> {
  // The day grid is twelve hours (08:00-20:00) tall.
  return cy.get('[data-cal-col]').first().then(($c) => $c[0].getBoundingClientRect().height / 12)
}

function drag(target: Cypress.Chainable<JQuery<HTMLElement>>, dy: number) {
  target.then(($el) => {
    const r = $el[0].getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + Math.min(r.height / 2, r.height - 2)
    cy.wrap($el).trigger('pointerdown', { pointerId: 7, clientX: x, clientY: y, button: 0, pointerType: 'mouse' })
    cy.window().trigger('pointermove', { pointerId: 7, clientX: x, clientY: y + dy / 2 })
    cy.window().trigger('pointermove', { pointerId: 7, clientX: x, clientY: y + dy })
    cy.window().trigger('pointerup', { pointerId: 7, clientX: x, clientY: y + dy })
  })
}

function openDay(account: StaffAccount, firstBlock: string) {
  cy.login(account.email, account.password)
  cy.visit('/calendar')
  cy.contains('select', 'Work week').select('day')
  cy.contains('[data-cy=appt-block]', firstBlock).should('exist')
}

const block = (name: string) => cy.contains('[data-cy=appt-block]', name)
const clash = () => cy.get('[data-cy=move-clash]')

function expectStart(appointmentId: string, h: number, m = 0) {
  cy.task<{ starts_at: string }>('db:appointmentById', { appointmentId }).then((a) => {
    expect(new Date(a.starts_at).getTime(), `starts at ${h}:${String(m).padStart(2, '0')}`).to.eq(new Date(todayAt(h, m)).getTime())
  })
}

function tomorrowAt(h: number, m = 0) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(h, m, 0, 0)
  return d
}

/** A second clinic the seeded practitioner also works at. */
function otherClinic(account: StaffAccount) {
  return cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Sede Norte' }).then((other) => {
    cy.task('db:linkTeamMemberToClinic', { teamMemberId: account.teamMemberId, clinicId: other.id })
    return cy.wrap(other.id)
  })
}

describe('Blocks at the other clinic, room blocks, and "Cambiar"', () => {
  it('asks before a drag lands in time the practitioner blocked at their other clinic', () => {
    cy.seedStaffAccount().then((account) => {
      otherClinic(account).then((otherClinicId) => {
        cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: otherClinicId, practitionerId: account.teamMemberId, startsAt: todayAt(12, 0), endsAt: todayAt(13, 0), note: 'Norte' })
        // The whole other clinic closed at 11:00 -- not this one.
        cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: otherClinicId, startsAt: todayAt(11, 0), endsAt: todayAt(12, 0) })
        seedVisit(account, null, 'Mover', 'Norte', 10, 0).then(({ appointmentId }) => {
          openDay(account, 'Mover Norte')
          hourPx().then((px) => {
            drag(block('Mover Norte'), px * 2)
            clash().should('be.visible').and('contain.text', 'Norte').and('contain.text', '12:00')
            cy.get('[data-cy=confirm-dialog-cancel]').click()
            expectStart(appointmentId, 10)

            drag(block('Mover Norte'), px)
            cy.contains('h2', 'Rescheduling Appointment').should('be.visible')
            clash().should('not.exist')
            cy.contains('button', 'Confirm').click()
            cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
            expectStart(appointmentId, 11)
          })
        })
      })
    })
  })

  it('warns in the new-appointment panel about a blocked room and the practitioner’s block at the other clinic', () => {
    cy.seedStaffAccount().then((account) => {
      otherClinic(account).then((otherClinicId) => {
        cy.task<{ id: string }[]>('db:selectRows', { table: 'calendar_resources', columns: 'id', match: { clinic_id: account.clinicId, name: 'Room 1' } }).then((rooms) => {
          cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: account.clinicId, roomId: rooms[0]!.id, startsAt: tomorrowAt(11).toISOString(), endsAt: tomorrowAt(12).toISOString() })
        })
        cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: otherClinicId, practitionerId: account.teamMemberId, startsAt: tomorrowAt(15).toISOString(), endsAt: tomorrowAt(16).toISOString() })
        cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: otherClinicId, startsAt: tomorrowAt(17).toISOString(), endsAt: tomorrowAt(18).toISOString() })
      })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      openNewAppointmentPanel()

      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('input[type="date"]').clear().type(dateInputValue(tomorrowAt(0)))

        // Room 1 is blocked 11:00-12:00; the practitioner is not.
        cy.get('input[type="time"]').clear().type('11:00')
        cy.contains('label', 'Room').find('select').select('Room 1')
        cy.get('[data-cy=create-clash]').should('contain.text', 'Room 1').and('contain.text', 'a block at 11:00')
        cy.get('[data-cy=create-submit]').should('be.disabled')
        cy.contains('[data-cy=create-practitioner]', 'Test Owner').should('contain.text', 'Free')
        cy.contains('label', 'Room').find('select').select('No room')
        cy.get('[data-cy=create-clash]').should('not.exist')
        cy.get('[data-cy=create-free]').should('exist')

        // 15:00 is blocked for them at the other clinic.
        cy.get('input[type="time"]').clear().type('15:00')
        cy.get('[data-cy=create-clash]').should('contain.text', 'a block at 15:00')
        cy.contains('[data-cy=create-practitioner]', 'Test Owner').should('contain.text', 'With a block')

        // The other clinic's own closure is not theirs.
        cy.get('input[type="time"]').clear().type('17:00')
        cy.get('[data-cy=create-clash]').should('not.exist')
        cy.get('[data-cy=create-free]').should('exist')
      })
    })
  })

  it('records a "Cambiar" to a new time in the visit’s moves, and not a change of length', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Cambia', 'Registro', 13, 0).then(({ appointmentId }) => {
        openDay(account, 'Cambia Registro')

        // Longer, same start: not a move.
        block('Cambia Registro').click()
        cy.get('[data-cy=appt-sheet]').within(() => {
          cy.get('[data-cy=appt-edit]').click()
          cy.get('[data-cy=appt-edit-form] input[type=number]').clear().type('45')
          cy.get('[data-cy=appt-edit-save]').click()
        })
        cy.get('[data-cy=appt-sheet-when]').should('contain.text', '13:00–13:45')
        cy.task<unknown[]>('db:selectRows', { table: 'appointment_reschedules', columns: 'id', match: { appointment_id: appointmentId } }).should('have.length', 0)

        // A new start is.
        cy.get('[data-cy=appt-sheet]').within(() => {
          cy.get('[data-cy=appt-edit]').click()
          cy.get('[data-cy=appt-edit-form] input[type=time]').clear().type('15:00')
          cy.get('[data-cy=appt-edit-save]').click()
        })
        cy.get('[data-cy=appt-sheet-when]').should('contain.text', '15:00–15:45')
        expectStart(appointmentId, 15)
        cy.task<{ from_starts_at: string; to_starts_at: string; created_by: string | null }[]>('db:selectRows', {
          table: 'appointment_reschedules',
          columns: 'from_starts_at, to_starts_at, created_by',
          match: { appointment_id: appointmentId },
        }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(new Date(rows[0]!.from_starts_at).getTime()).to.eq(new Date(todayAt(13)).getTime())
          expect(new Date(rows[0]!.to_starts_at).getTime()).to.eq(new Date(todayAt(15)).getTime())
          expect(new Date(rows[0]!.to_starts_at).getTime() - new Date(rows[0]!.from_starts_at).getTime()).to.eq(120 * MIN)
          expect(rows[0]!.created_by).to.eq(account.teamMemberId)
        })
      })
    })
  })
})
