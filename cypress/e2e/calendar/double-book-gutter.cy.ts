import type { StaffAccount } from '../../support/commands'
import { seedVisit, todayAt } from '../../support/calendar'

// A visit's card used to fill its column from edge to edge, so a taken time
// had no bare grid left: a click there opened the visit, and the only way to
// book a second one at that time was the "+ New appointment" button. Every
// column now keeps a strip down its right side that no card is drawn over.
// Clicking it books at that time, as clicking a free slot does; a visit
// dragged onto another one lands on the slot underneath (after the usual
// "that time is taken" question) and the two are drawn side by side; and in
// "Move…" picking mode a click on another visit's card picks the slot under
// it, where it used to do nothing.

function hourPx(): Cypress.Chainable<number> {
  // The day grid is twelve hours (08:00-20:00) tall.
  return cy.get('[data-cal-col]').first().then(($c) => $c[0].getBoundingClientRect().height / 12)
}

const block = (name: string) => cy.contains('[data-cy=appt-block]', name)
const rectOf = ($el: JQuery<HTMLElement>) => $el[0].getBoundingClientRect()

function openDay(account: StaffAccount, firstBlock: string) {
  cy.login(account.email, account.password)
  cy.visit('/calendar')
  cy.contains('select', 'Work week').select('day')
  // The week stays drawn until the day replaces it; a block found
  // before then is the week's, and is gone a moment later.
  cy.get('[data-cy=day-column-head]').should('exist')
  block(firstBlock).should('exist')
}

function expectStart(appointmentId: string, h: number, m = 0) {
  cy.task<{ starts_at: string }>('db:appointmentById', { appointmentId }).then((a) => {
    expect(new Date(a.starts_at).getTime(), `starts at ${h}:${String(m).padStart(2, '0')}`).to.eq(new Date(todayAt(h, m)).getTime())
  })
}

/** Both cards at the same height, neither over the other, and the strip to their right still bare. */
function expectSideBySide(a: string, b: string, gutter: number) {
  block(b).should('exist')
  block(a).should(($a) => {
    const $b = Cypress.$(`[data-cy=appt-block]:contains("${b}")`) as JQuery<HTMLElement>
    expect($b.length, `${b} on the grid`).to.eq(1)
    const col = $a.closest('[data-cal-col]')[0].getBoundingClientRect()
    const ra = rectOf($a)
    const rb = rectOf($b)
    const [left, right] = ra.left < rb.left ? [ra, rb] : [rb, ra]
    expect(Math.abs(ra.top - rb.top), 'same row').to.be.lessThan(2)
    expect(left.right, 'no overlap').to.be.at.most(right.left + 1)
    expect(col.right - right.right, 'gutter kept').to.be.at.least(gutter)
  })
}

describe('A taken time can still be booked or dropped on', () => {
  it('books a second visit from the strip beside the first', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30, defaultPriceCents: 4500 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Segunda', lastName: 'Visita' })
      seedVisit(account, null, 'Primera', 'Cita', 10, 0)
      openDay(account, 'Primera Cita')

      // The card's own column: a visit with no room is in "Unassigned", not
      // in the first column.
      block('Primera Cita').closest('[data-cal-col]').then(($col) => {
        const col = rectOf($col)
        const y = (col.height / 12) * 2 + 8 // 10:00
        // The card stops short of the column's right edge.
        block('Primera Cita').should(($b) => expect(col.right - rectOf($b).right, 'gutter').to.be.at.least(16))

        // Over the strip the grid says a visit can go there.
        cy.wrap($col).trigger('pointermove', col.width - 8, y, { pointerType: 'mouse' })
        cy.get('[data-cy=gutter-ghost]').should('be.visible').and('not.have.attr', 'data-solid')

        // A click on it is a click on 10:00, not on the visit.
        cy.wrap($col).click(col.width - 8, y)
        cy.get('[data-cy=appt-sheet]').should('not.exist')
        cy.get('[data-cy=create-sheet]').should('be.visible')
        cy.get('[data-cy=create-when]').should('contain.text', '10:00')
        // The slot being booked is marked in the strip, leaving the visit
        // already there in view.
        cy.get('[data-cy=gutter-ghost]').should('have.attr', 'data-solid')
        cy.get('[data-cy=create-ghost]').should('not.exist')
      })

      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-patient-search]').type('Segunda')
        cy.contains('[data-cy=create-patient-result]', 'Segunda Visita').click()
        cy.contains('[data-cy=create-type]', 'Ajuste').click()
        cy.get('[data-cy=create-clash]').should('contain.text', 'Primera Cita')
        cy.get('[data-cy=create-double-book]').check()
        cy.get('[data-cy=create-submit]').should('not.be.disabled').click()
      })
      cy.get('[data-cy=create-sheet]').should('not.exist')

      expectSideBySide('Primera Cita', 'Segunda Visita', 16)
    })
  })

  it('lands a visit dragged onto another one beside it', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Quieta', 'Cita', 10, 0)
      seedVisit(account, null, 'Mover', 'Encima', 11, 0).then(({ appointmentId }) => {
        openDay(account, 'Mover Encima')

        hourPx().then((px) => {
          // Released with the pointer on the other visit's card.
          block('Mover Encima').then(($el) => {
            const r = rectOf($el)
            const x = r.left + r.width / 2
            const y = r.top + r.height / 2
            cy.wrap($el).trigger('pointerdown', { pointerId: 7, clientX: x, clientY: y, button: 0, pointerType: 'mouse' })
            cy.window().trigger('pointermove', { pointerId: 7, clientX: x, clientY: y - px / 2 })
            cy.window().trigger('pointermove', { pointerId: 7, clientX: x, clientY: y - px })
            cy.window().trigger('pointerup', { pointerId: 7, clientX: x, clientY: y - px })
          })
          cy.get('[data-cy=move-clash]').should('be.visible').and('contain.text', 'Quieta Cita')
          cy.get('[data-cy=confirm-dialog-confirm]').click()
          cy.contains('h2', 'Reschedule appointment').should('be.visible')
          cy.contains('button', 'Move appointment').click()
          cy.contains('h2', 'Reschedule appointment').should('not.exist')
          expectStart(appointmentId, 10)
        })
        expectSideBySide('Quieta Cita', 'Mover Encima', 16)
      })
    })
  })

  it('picks the slot under a card when "Move…" is choosing a time', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Quieta', 'Cita', 10, 0)
      seedVisit(account, null, 'Viaja', 'Luego', 15, 0).then(({ appointmentId }) => {
        openDay(account, 'Viaja Luego')

        block('Viaja Luego').click()
        cy.get('[data-cy=move-appointment]').click()
        cy.get('[data-cy=appt-sheet]').should('not.exist')
        cy.contains('Rescheduling').should('be.visible')

        // A click on the visit already at 10:00 is a click on 10:00.
        block('Quieta Cita').click()
        cy.get('[data-cy=appt-sheet]').should('not.exist')
        cy.get('[data-cy=move-clash]').should('be.visible').and('contain.text', 'Quieta Cita')
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.contains('h2', 'Reschedule appointment').should('be.visible')
        cy.contains('button', 'Move appointment').click()
        cy.contains('h2', 'Reschedule appointment').should('not.exist')
        expectStart(appointmentId, 10)
        expectSideBySide('Quieta Cita', 'Viaja Luego', 16)
      })
    })
  })

  // Day view again, so the spec does not depend on today being a weekday:
  // with three rooms and Unassigned at 1024px the columns are at their
  // narrowest there too.
  it('still shows two readable cards beside the strip in narrow columns', () => {
    cy.viewport(1024, 768)
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 2' })
      cy.task('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 3' })
      seedVisit(account, null, 'Estrecha', 'Uno', 10, 0)
      seedVisit(account, null, 'Estrecha', 'Dos', 10, 0)
      openDay(account, 'Estrecha Uno')

      expectSideBySide('Estrecha Uno', 'Estrecha Dos', 16)
      block('Estrecha Uno').should(($b) => expect(rectOf($b).width, 'card width').to.be.at.least(40))
    })
  })
})
