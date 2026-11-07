import { seedVisit } from '../../support/calendar'

// The calendar when something goes wrong on the way: a range that cannot be
// read, a drag the browser takes back, a note that does not save.
//
// Each of these used to look like success. A failed range left the grid on
// its placeholders forever, with nothing to press. On the iPad a finger that
// starts on a block and moves is a scroll, which the browser reports with
// pointercancel and never pointerup -- the block stayed drawn at the wrong
// time and the next tap on any block was swallowed. And both notes in the
// panel said "saved" whatever the database answered.

function hourPx(): Cypress.Chainable<number> {
  // The day grid is twelve hours (08:00-20:00) tall.
  return cy.get('[data-cal-col]').first().then(($c) => $c[0].getBoundingClientRect().height / 12)
}

function openDay(account: { email: string; password: string }) {
  cy.login(account.email, account.password)
  cy.visit('/calendar')
  cy.contains('select', 'Work week').select('day')
}

describe('The calendar when something fails', () => {
  it('says a range failed to load, keeps booking paused, and recovers on retry', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Rango', 'Fallido', 10, 0, { confirmationStatus: 'confirmed' }).then(() => {
        let failing = false
        cy.intercept({ method: 'GET', url: /\/rest\/v1\/appointments\?select=id%2Cpatient_id%2Croom_id/ }, (req) => {
          if (failing) req.reply({ statusCode: 500, body: { message: 'failed' } })
        })
        openDay(account)
        cy.contains('[data-cy=appt-block]', 'Rango Fallido').should('exist')

        cy.then(() => {
          failing = true
        })
        // The next day: a new range, read from scratch.
        cy.get('button[aria-label="Next"]:visible').first().click()
        cy.get('[data-cy=calendar-range-failed]', { timeout: 20000 }).should('contain', "Couldn't load this day's appointments")
        // Placeholders, not an empty day to book into.
        cy.get('[data-cal-col]').first().should('have.class', 'pointer-events-none')

        cy.then(() => {
          failing = false
        })
        cy.get('[data-cy=calendar-range-retry]').click()
        cy.get('[data-cy=calendar-range-failed]').should('not.exist')
        cy.get('[data-cal-col]').first().should('not.have.class', 'pointer-events-none')
        // And back to the visit's own day, read normally.
        cy.get('button[aria-label="Previous"]:visible').first().click()
        cy.contains('[data-cy=appt-block]', 'Rango Fallido').should('be.visible')
      })
    })
  })

  it('puts a block back when the browser cancels the drag, and the next tap still opens it', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Gesto', 'Cancelado', 10, 0, { confirmationStatus: 'confirmed' }).then(() => {
        openDay(account)
        const block = () => cy.contains('[data-cy=appt-block]', 'Gesto Cancelado')
        block().should('exist')

        hourPx().then((px) => {
          block().then(($el) => {
            const top = $el[0].style.top
            const r = $el[0].getBoundingClientRect()
            const x = r.left + r.width / 2
            const y = r.top + 6
            cy.wrap($el).trigger('pointerdown', { pointerId: 7, clientX: x, clientY: y, button: 0, pointerType: 'touch' })
            cy.window().trigger('pointermove', { pointerId: 7, clientX: x, clientY: y + px / 2 })
            cy.window().trigger('pointermove', { pointerId: 7, clientX: x, clientY: y + px })
            block().should(($b) => expect($b[0].style.top).not.to.eq(top))

            // A second finger lifting is not the end of this drag.
            cy.window().trigger('pointerup', { pointerId: 8, clientX: x, clientY: y + px })
            cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
            block().should(($b) => expect($b[0].style.top).not.to.eq(top))

            // The browser takes the gesture for a scroll.
            cy.window().trigger('pointercancel', { pointerId: 7, clientX: x, clientY: y + px })
            block().should(($b) => expect($b[0].style.top).to.eq(top))
            cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
          })
        })

        block().click()
        cy.get('[data-cy=appt-sheet]').should('be.visible')
      })
    })
  })

  it('says a visit note was not saved, and saves it on the next try', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Nota', 'Perdida', 10, 0, { confirmationStatus: 'confirmed' }).then(({ appointmentId }) => {
        let failing = true
        cy.intercept({ method: 'PATCH', url: /\/rest\/v1\/appointments\?id=eq\./ }, (req) => {
          if (failing) req.reply({ statusCode: 500, body: { message: 'failed' } })
        })
        openDay(account)
        cy.contains('[data-cy=appt-block]', 'Nota Perdida').click()
        cy.get('[data-cy=visit-note]').type('Trae la resonancia').blur()
        cy.get('[data-cy=visit-note-unsaved]', { timeout: 20000 }).should('be.visible')

        cy.then(() => {
          failing = false
        })
        cy.get('[data-cy=visit-note]').focus().blur()
        cy.get('[data-cy=visit-note-unsaved]').should('not.exist')
        cy.contains('Note for this visit').should('contain', 'saved')
        cy.task<{ note: string | null }>('db:appointmentById', { appointmentId }).its('note').should('eq', 'Trae la resonancia')
      })
    })
  })
})
