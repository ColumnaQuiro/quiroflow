import { dateInputValue } from '../../support/calendar'

/**
 * Monday of the current week, in the browser's own timezone.
 *
 * The calendar's week starts on Monday (startOfWeek in pages/calendar.vue)
 * and anchors on today, so Monday is the one weekday guaranteed to be on
 * screen in Work week view whatever day the suite runs -- including a
 * weekend run, where "today" itself is not rendered at all.
 */
function mondayOfThisWeek(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

describe('Removing an availability block', () => {
  // Deliberately never switches view. Work week is the default (viewMode in
  // pages/calendar.vue) and was the one view whose blocks were
  // `pointer-events-none` with no click handler, so a block could not be
  // opened -- and therefore not removed -- without first discovering that
  // Day view behaves differently. Selecting a view here would test the
  // wrong thing.
  it('opens a block from the default Work week view and removes it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').should('have.value', 'workweek')

      const monday = dateInputValue(mondayOfThisWeek())

      cy.contains('button', 'Block time').click()
      cy.get('.fixed.inset-0.z-50').within(() => {
        cy.contains('h2', 'Block Time').should('be.visible')
        // Practitioner and Room keep their defaults (all practitioners,
        // whole clinic), which is what makes the block render in every day
        // column rather than only under one room tab.
        cy.contains('label', 'Start date').parent().find('input').clear().type(monday)
        cy.contains('label', 'End date').parent().find('input').clear().type(monday)
        // Inside the grid's rendered hours (START_HOUR 8 to END_HOUR 20),
        // or the block would be positioned off the top of the column and
        // never be clickable regardless of this fix.
        cy.contains('label', 'Start time').parent().find('input').clear().type('09:00')
        cy.contains('label', 'End time').parent().find('input').clear().type('10:00')
        cy.contains('button', /^Save$/).click()
      })
      cy.get('.fixed.inset-0.z-50').should('not.exist')

      cy.contains('Blocked').should('be.visible')

      // The regression itself. While the block was pointer-events-none the
      // click fell through to the cell underneath, whose handler opens the
      // New Appointment panel -- so this asserted on the wrong heading and
      // the block stayed put.
      cy.contains('Blocked').first().click()
      cy.contains('h2', 'Edit Block').should('be.visible')

      // Cypress auto-accepts the window.confirm in remove().
      cy.contains('button', 'Remove block').click()
      cy.get('.fixed.inset-0.z-50').should('not.exist')
      cy.contains('Blocked').should('not.exist')
    })
  })
})
