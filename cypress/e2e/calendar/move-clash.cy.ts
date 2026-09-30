import type { StaffAccount } from '../../support/commands'
import { seedVisit, todayAt } from '../../support/calendar'

// Booking a new visit onto a taken time needs "allow double booking" ticked;
// moving one used to need nothing at all. A drag, a resize, "Mover…" and
// "Cambiar" all saved straight over another patient or a block, checking only
// working hours. Each now names what the new time clashes with and lets the
// desk go back or move it anyway -- and a move to a free time asks nothing.
//
// A resize that leaves the start where it was is not a reschedule either: the
// patient comes at the same time, so it saves without the reschedule dialog,
// without the "moved" flag and without an appointment_reschedules row.

const MIN = 60 * 1000

function hourPx(): Cypress.Chainable<number> {
  // The day grid is twelve hours (08:00-20:00) tall.
  return cy.get('[data-cal-col]').first().then(($c) => $c[0].getBoundingClientRect().height / 12)
}

// The drag handlers listen on window: press on the block, move, release.
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

function reschedulesOf(appointmentId: string) {
  return cy.task<unknown[]>('db:selectRows', { table: 'appointment_reschedules', columns: 'id', match: { appointment_id: appointmentId } })
}

describe('Moving a visit onto a taken time', () => {
  it('asks before a drag lands on another patient, and moves it only when told to', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Mover', 'Encima', 10, 0).then(({ appointmentId }) => {
        seedVisit(account, null, 'Ocupa', 'Hueco', 11, 0)
        openDay(account, 'Mover Encima')

        hourPx().then((px) => {
          drag(block('Mover Encima'), px)
          clash().should('be.visible').and('contain.text', 'Ocupa Hueco').and('contain.text', '11:00')
          cy.contains('h2', 'Rescheduling Appointment').should('not.exist')

          // Back out: nothing is written and the block goes back where it was.
          cy.get('[data-cy=confirm-dialog-cancel]').click()
          clash().should('not.exist')
          cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
          expectStart(appointmentId, 10)

          // On purpose this time: the usual reschedule confirmation follows.
          drag(block('Mover Encima'), px)
          clash().should('be.visible')
          cy.get('[data-cy=confirm-dialog-confirm]').click()
          cy.contains('h2', 'Rescheduling Appointment').should('be.visible')
          cy.contains('button', 'Confirm').click()
          cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
          expectStart(appointmentId, 11)
        })
      })
    })
  })

  it('asks before a drag lands in a blocked time, and asks nothing for a free one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: account.clinicId, startsAt: todayAt(12, 0), endsAt: todayAt(13, 0) })
      seedVisit(account, null, 'Mover', 'Bloqueo', 10, 0).then(({ appointmentId }) => {
        openDay(account, 'Mover Bloqueo')

        hourPx().then((px) => {
          drag(block('Mover Bloqueo'), px * 2)
          clash().should('be.visible').and('contain.text', 'Blocked').and('contain.text', '12:00')
          cy.get('[data-cy=confirm-dialog-cancel]').click()
          expectStart(appointmentId, 10)

          // 11:00 is free: straight to the reschedule confirmation.
          drag(block('Mover Bloqueo'), px)
          cy.contains('h2', 'Rescheduling Appointment').should('be.visible')
          clash().should('not.exist')
          cy.contains('button', 'Confirm').click()
          cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
          expectStart(appointmentId, 11)
        })
      })
    })
  })

  it('asks before a resize runs into the next visit, and a resize is not a reschedule', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Alargar', 'Choque', 14, 0).then(({ appointmentId: stretched }) => {
        seedVisit(account, null, 'Siguiente', 'Cita', 15, 0)
        seedVisit(account, null, 'Estirar', 'Libre', 17, 0).then(({ appointmentId: free }) => {
          openDay(account, 'Alargar Choque')
          cy.intercept('PATCH', '**/rest/v1/appointments*').as('save')

          hourPx().then((px) => {
            // 14:00-14:30 pulled to 15:30 runs over Siguiente Cita at 15:00.
            drag(block('Alargar Choque').find('.cursor-ns-resize'), px)
            clash().should('be.visible').and('contain.text', 'Siguiente Cita')
            cy.get('[data-cy=confirm-dialog-confirm]').click()
            cy.wait('@save')
            cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
            cy.task<{ starts_at: string; ends_at: string; rescheduled: boolean }>('db:appointmentById', { appointmentId: stretched }).then((a) => {
              expect(new Date(a.starts_at).getTime(), 'start unchanged').to.eq(new Date(todayAt(14, 0)).getTime())
              expect(new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime(), 'ninety minutes').to.eq(90 * MIN)
              expect(a.rescheduled, 'a longer visit is not a moved one').to.eq(false)
            })
            reschedulesOf(stretched).should('have.length', 0)

            // Into free time: no question of any kind.
            drag(block('Estirar Libre').find('.cursor-ns-resize'), px / 2)
            cy.wait('@save')
            clash().should('not.exist')
            cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
            cy.task<{ starts_at: string; ends_at: string; rescheduled: boolean }>('db:appointmentById', { appointmentId: free }).then((a) => {
              expect(new Date(a.ends_at).getTime(), 'half an hour longer').to.eq(new Date(todayAt(18, 0)).getTime())
              expect(a.rescheduled).to.eq(false)
            })
            reschedulesOf(free).should('have.length', 0)
          })
        })
      })
    })
  })

  it('asks the same from "Cambiar" and from "Mover…"', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Cambia', 'Hora', 13, 0).then(({ appointmentId: changed }) => {
        seedVisit(account, null, 'Ocupa', 'Tarde', 14, 0)
        seedVisit(account, null, 'Ocupa', 'Mañana', 10, 0)
        seedVisit(account, null, 'Mueve', 'Hueco', 16, 0, { durationMinutes: 60 }).then(({ appointmentId: moved }) => {
          openDay(account, 'Cambia Hora')

          // "Cambiar": 13:00 -> 14:00, where Ocupa Tarde is.
          block('Cambia Hora').click()
          cy.get('[data-cy=appt-sheet]').within(() => {
            cy.get('[data-cy=appt-edit]').click()
            cy.get('[data-cy=appt-edit-form] input[type=time]').clear().type('14:00')
            cy.get('[data-cy=appt-edit-save]').click()
          })
          clash().should('be.visible').and('contain.text', 'Ocupa Tarde')
          cy.get('[data-cy=confirm-dialog-cancel]').click()
          clash().should('not.exist')
          cy.get('[data-cy=appt-edit-form]').should('be.visible') // still editing, to pick another time
          expectStart(changed, 13)

          cy.get('[data-cy=appt-edit-save]').click()
          cy.get('[data-cy=confirm-dialog-confirm]').click()
          cy.get('[data-cy=appt-sheet-when]').should('contain.text', '14:00–14:30')
          expectStart(changed, 14)
          cy.get('body').type('{esc}')
          cy.get('[data-cy=appt-sheet]').should('not.exist')

          // "Mover…": a 60-minute visit dropped at 09:30 runs into Ocupa Mañana at 10:00.
          block('Mueve Hueco').click()
          cy.get('[data-cy=move-appointment]').click()
          cy.get('[data-cy=appt-sheet]').should('not.exist')
          hourPx().then((px) => {
            cy.get('[data-cal-col]').first().click(30, px * 1.5 + 5)
            clash().should('be.visible').and('contain.text', 'Ocupa Mañana')
            cy.get('[data-cy=confirm-dialog-cancel]').click()
            // Still picking: the next click is another try, not a lost move.
            cy.contains('Rescheduling').should('be.visible')
            expectStart(moved, 16)

            cy.get('[data-cal-col]').first().click(30, px * 1.5 + 5)
            cy.get('[data-cy=confirm-dialog-confirm]').click()
            cy.contains('h2', 'Rescheduling Appointment').should('be.visible')
            cy.contains('button', 'Confirm').click()
            cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
            expectStart(moved, 9, 30)
          })
        })
      })
    })
  })
})
