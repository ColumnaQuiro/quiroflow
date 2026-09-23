import type { StaffAccount } from '../../support/commands'
import { seedVisit, todayAt } from '../../support/calendar'

// Opening a visit: the read-only hover card, and the side panel that replaced
// the edit modal. Everything is reached by keyboard or click -- the card by
// moving the grid's cell cursor onto a block, never by hovering -- so every
// state is assertable without pointer timing.

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))

function seed(): Cypress.Chainable<{ account: StaffAccount; roomId: string }> {
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 1' }).then((room) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
      seedVisit(account, room.id, 'Laura', 'Gómez', 10, 30, { checkedInAt: todayAt(10, 16), confirmationStatus: 'confirmed', confirmationSentAt: todayAt(8, 0) }).then(({ patientId }) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId, totalCents: 4500, status: 'unpaid' })
        cy.task('db:setStickyNote', { patientId, note: 'Hernia discal L5.' })
        cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId, packageName: 'Bono Ajustes 10', sessionsTotal: 10, sessionsUsed: 7, priceCents: 40000 })
      })
      seedVisit(account, room.id, 'Sergio', 'Navarro', 11, 30, { confirmationStatus: 'pending', reminderSentAt: todayAt(9, 0) })
      return cy.wrap({ account, roomId: room.id })
    }),
  )
}

function openCalendar(account: StaffAccount) {
  cy.login(account.email, account.password)
  cy.visit('/calendar')
  cy.contains('select', 'Work week').select('day')
  cy.contains('[data-cy=appt-block]', 'Laura Gómez').should('exist')
}

function block(name: string) {
  return cy.contains('[data-cy=appt-block]', name)
}

describe('Opening a visit', () => {
  it('shows the read-only card on keyboard focus, and none for a touch', () => {
    seed().then(({ account }) => {
      openCalendar(account)

      // 08:00 in Room 1, one column right to Sala 1, five slots down to 10:30.
      cy.get('[data-cy=calendar-grid]').focus().type(`${'{uparrow}'.repeat(30)}{rightarrow}${'{downarrow}'.repeat(5)}`)
      // The card takes no pointer events, so Cypress's "visible" (which asks
      // what is under the point) sees the grid beneath it; assert content.
      cy.get('[data-cy=appt-hover]').within(() => {
        cy.contains('Laura Gómez').should('exist')
        cy.contains('10:30–11:00').should('exist')
        cy.get('[data-cy=appt-hover-stage]').should('contain.text', 'Arrived at 10:16').and('contain.text', 'had confirmed')
        cy.get('[data-cy=appt-hover-owes]').should('contain.text', 'Owes').and('contain.text', '45,00').and('contain.text', '1 unpaid visit')
        cy.get('[data-cy=appt-hover-bono]').should('contain.text', 'Bono Ajustes 10').and('contain.text', '3 left')
        cy.get('[data-cy=appt-hover-note]').should('contain.text', 'Hernia discal L5.')
        // Read-only: nothing to press or type in.
        cy.get('button, input, textarea, select').should('not.exist')
      })
      block('Laura Gómez').children().first().should('have.class', 'ring-2')

      // Enter opens it; Escape closes it and hands focus back to the grid.
      cy.get('[data-cy=calendar-grid]').type('{enter}')
      cy.get('[data-cy=appt-sheet]').should('be.visible')
      cy.get('[data-cy=appt-hover]').should('not.exist')
      cy.get('body').type('{esc}')
      cy.get('[data-cy=appt-sheet]').should('not.exist')
      cy.focused().should('have.attr', 'data-cy', 'calendar-grid')
      cy.get('[data-cy=calendar-grid]').blur()

      // A touch gets no card; a mouse does.
      block('Sergio Navarro').trigger('pointerenter', { pointerType: 'touch' })
      cy.wait(400)
      cy.get('[data-cy=appt-hover]').should('not.exist')
      block('Sergio Navarro').trigger('pointerenter', { pointerType: 'mouse' })
      cy.get('[data-cy=appt-hover]').should('contain.text', 'Sergio Navarro').and('contain.text', 'Reminder sent today 09:00 · no reply')
    })
  })

  it('walks the visit through its stages from the panel', () => {
    seed().then(({ account }) => {
      openCalendar(account)
      block('Laura Gómez').click()

      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.get('#appt-name').should('have.text', 'Laura Gómez')
        cy.get('[data-cy=appt-sheet-facts]').should('contain.text', 'no next visit')
        cy.get('[data-cy=stage-track] [aria-current=step]').should('contain.text', 'Arrived').and('contain.text', '10:16')
        // cy.contains, not contain.text: formatEur puts a non-breaking space
        // before the €, which only cy.contains normalises.
        cy.get('[data-cy=visit-money]').should('contain.text', 'Bono Ajustes 10').and('contain.text', '3 of 10 left')
        cy.contains('[data-cy=visit-money]', 'uses 1 session at 40,00 €').should('exist')
        cy.get('[data-cy=patient-balance]').should('contain.text', 'Owes')
        cy.get('[data-cy=collect-balance]').should('have.attr', 'href').and('include', '?tab=money')
        cy.get('[data-cy=messages-sent]').should('contain.text', 'Confirmation · today 08:00')
        // In the building: "No-show" is not an option any more.
        cy.get('[data-cy=mark-no-show]').should('be.disabled')

        cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'withp').click()
        cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'checkout').click()
        cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'charge')
      })
      block('Laura Gómez').should('have.attr', 'data-stage', 'checkout')

      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.get('[data-cy=undo-stage]').click()
        cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'checkout')
        // "Cobrar" goes to the Cobro tab -- the existing billing tab.
        cy.get('[data-cy=advance-stage]').click()
        cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'charge').click()
        cy.get('[data-cy=appt-tab-billing]').should('have.attr', 'aria-selected', 'true')
        cy.contains('Not charged yet').should('be.visible')
      })
    })
  })

  it('confirms by hand, marks a no-show, keeps the notes and edits the time inline', () => {
    seed().then(({ account }) => {
      openCalendar(account)
      block('Sergio Navarro').click()

      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.get('[data-cy=stage-track] li').first().should('have.attr', 'data-state', 'waiting').and('contain.text', 'Unconfirmed')
        cy.get('[data-cy=mark-confirmed]').click()
        cy.get('[data-cy=mark-confirmed]').should('not.exist')
        cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'checkin')

        cy.get('[data-cy=visit-note]').type('Viene por molestia cervical.').blur()
        cy.contains('Note for this visit').should('contain.text', 'saved')
        cy.get('[data-cy=appt-tab-history]').click()
        cy.get('[data-cy=appt-history]').should('contain.text', 'Reminder sent')
      })
      block('Sergio Navarro').should('have.attr', 'data-stage', 'confirmed')

      // Change the time inline: 11:30 -> 12:30.
      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.get('[data-cy=appt-tab-summary]').click()
        cy.get('[data-cy=appt-edit]').click()
        cy.get('[data-cy=appt-edit-form] input[type=time]').clear().type('12:30')
        cy.get('[data-cy=appt-edit-save]').click()
        cy.get('[data-cy=appt-sheet-when]').should('contain.text', '12:30–13:00')
        cy.get('[data-cy=mark-no-show]').should('not.be.disabled').click()
        cy.get('[data-cy=stage-off-track]').should('contain.text', 'No-show')
      })
      block('Sergio Navarro').should('have.attr', 'data-stage', 'noshow')

      // The note survived a reload.
      cy.get('body').type('{esc}')
      cy.reload()
      cy.contains('select', 'Work week').select('day')
      block('Sergio Navarro').click()
      cy.get('[data-cy=visit-note]').should('have.value', 'Viene por molestia cervical.')
    })
  })
})
