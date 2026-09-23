import { seedVisit, todayAt } from '../../support/calendar'

// Dragging a block moves the visit; dragging its bottom edge makes it longer.
// Both go through the reschedule confirmation (reason, fee, resend), which
// the redesign kept as it was. The drag handlers listen on window, so the
// gesture is driven there: press on the block, move, release.

const HOUR = 60 * 60 * 1000

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

describe('Dragging a block', () => {
  it('moves the visit an hour later, and resizes another by its bottom edge', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Mover', 'Arrastrado', 10, 0, { confirmationStatus: 'confirmed' }).then(({ appointmentId: moved }) => {
        seedVisit(account, null, 'Hecha', 'Quieta', 17, 0, { status: 'completed' })
        seedVisit(account, null, 'Alargar', 'Estirada', 14, 0, { confirmationStatus: 'confirmed' }).then(({ appointmentId: stretched }) => {
          cy.login(account.email, account.password)
          cy.visit('/calendar')
          cy.contains('select', 'Work week').select('day')
          cy.contains('[data-cy=appt-block]', 'Mover Arrastrado').should('exist')

          hourPx().then((px) => {
            // Move: the whole block, one hour down.
            drag(cy.contains('[data-cy=appt-block]', 'Mover Arrastrado'), px)
            cy.contains('h2', 'Rescheduling Appointment').should('be.visible')
            cy.contains('button', 'Confirm').click()
            cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
            cy.task<{ starts_at: string; ends_at: string; rescheduled: boolean }>('db:appointmentById', { appointmentId: moved }).then((a) => {
              expect(new Date(a.starts_at).getTime(), 'an hour later').to.eq(new Date(todayAt(11, 0)).getTime())
              expect(new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime(), 'same length').to.eq(HOUR / 2)
              expect(a.rescheduled).to.eq(true)
            })

            // Resize: the bottom edge, half an hour down.
            drag(cy.contains('[data-cy=appt-block]', 'Alargar Estirada').find('.cursor-ns-resize'), px / 2)
            cy.contains('h2', 'Rescheduling Appointment').should('be.visible')
            cy.contains('button', 'Confirm').click()
            cy.task<{ starts_at: string; ends_at: string }>('db:appointmentById', { appointmentId: stretched }).then((a) => {
              expect(new Date(a.starts_at).getTime(), 'start unchanged').to.eq(new Date(todayAt(14, 0)).getTime())
              expect(new Date(a.ends_at).getTime(), 'half an hour longer').to.eq(new Date(todayAt(15, 0)).getTime())
            })
            // The grid reloads after a confirm; wait for it to draw the new
            // length before touching another block.
            cy.contains('[data-cy=appt-block]', 'Alargar Estirada').should(($b) => expect($b[0].getBoundingClientRect().height).to.be.greaterThan(px * 0.9))
          })

          // Only a booked visit moves: a finished one stays where it happened.
          cy.contains('[data-cy=appt-block]', 'Hecha Quieta').should('not.have.class', 'cursor-grab')
          hourPx().then((px) => drag(cy.contains('[data-cy=appt-block]', 'Hecha Quieta'), px))
          cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
        })
      })
    })
  })
})
