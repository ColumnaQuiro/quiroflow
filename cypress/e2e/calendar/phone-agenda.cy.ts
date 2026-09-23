import { seedVisit, todayAt } from '../../support/calendar'

// Below md the day view is a one-column agenda, and an appointment opens full
// screen with its next step under the thumb. 375px, the narrowest phone the
// app supports.

describe('The day on a phone', () => {
  beforeEach(() => {
    cy.viewport(375, 812)
  })

  it('lists the day in one column, folds what is done, and notes the next patient', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Carmen', 'Ortiz', 9, 0, { status: 'completed' })
      seedVisit(account, null, 'Pablo', 'Ferrer', 9, 30, { status: 'completed' })
      seedVisit(account, null, 'Laura', 'Gómez', 10, 30, { checkedInAt: todayAt(10, 16) }).then(({ patientId }) => {
        cy.task('db:setStickyNote', { patientId, note: 'Hernia discal L5.' })
      })
      seedVisit(account, null, 'Sergio', 'Navarro', 11, 30, { confirmationStatus: 'pending' })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      // A phone that never chose a view lands on the day, which is the agenda.
      cy.get('[data-cy=phone-agenda]').should('be.visible')
      cy.get('[data-cy=calendar-grid]').should('not.exist')
      cy.document().its('documentElement.scrollWidth').should('be.at.most', 375)

      cy.get('[data-cy=agenda-scope-mine]').should('have.attr', 'aria-selected', 'true').and('contain.text', '· 4')
      cy.get('[data-cy=agenda-counts]').should('contain.text', '1 unconfirmed').and('contain.text', '1 waiting')

      // Done visits collapse into one row, and open on a tap.
      cy.get('[data-cy=agenda-done]').should('contain.text', '2 done · 09:00–10:00')
      cy.get('[data-cy=agenda-item]').should('have.length', 2)
      cy.get('[data-cy=agenda-done]').click()
      cy.get('[data-cy=agenda-item]').should('have.length', 4)

      // The next patient's note, before she is in the room.
      cy.get('[data-cy=agenda-next-note]').should('contain.text', 'Hernia discal L5.')

      // Switching scope reloads the day (the done row folds again), so the
      // tab is found afresh afterwards.
      cy.get('[data-cy=agenda-scope-all]').click()
      cy.get('[data-cy=agenda-scope-all]').should('have.attr', 'aria-selected', 'true').and('contain.text', '· 4')
      cy.get('[data-cy=agenda-done]').should('contain.text', '2 done')
    })
  })

  it('opens an appointment full screen with the next step in the footer', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Laura', 'Gómez', 10, 30, { checkedInAt: todayAt(10, 16) })
      cy.login(account.email, account.password)
      cy.visit('/calendar')

      cy.contains('[data-cy=agenda-item]', 'Laura Gómez').click()
      cy.get('[data-cy=appt-sheet]').should('be.visible').invoke('outerWidth').should('eq', 375)
      // One next-step button, and it is the footer's.
      cy.get('[data-cy=advance-stage]').should('have.length', 1).closest('.appt-panel-footer').should('exist')
      cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'withp').click()
      cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'checkout')
      cy.get('[data-cy=mark-no-show]').should('be.disabled')
      cy.get('[data-cy=appt-sheet] button[aria-label="Close"]').click()
      cy.contains('[data-cy=agenda-item]', 'Laura Gómez').should('have.attr', 'data-stage', 'withp')

      // "+" books from the agenda, also full screen.
      cy.get('[data-cy=agenda-new]').click()
      cy.get('[data-cy=create-sheet]').should('be.visible').invoke('outerWidth').should('eq', 375)
    })
  })
})
