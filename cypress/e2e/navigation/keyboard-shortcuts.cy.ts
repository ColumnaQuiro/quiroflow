import { todayAt } from '../../support/calendar'

// Single-key shortcuts (composables/useShortcuts, listed by "?"): the critique
// found nothing but ⌘K and the calendar's arrows. Each one here is pressed on
// the page itself, never inside a field, the way staff would.

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const press = (keys: string) => cy.get('body').type(keys)

describe('Keyboard shortcuts', () => {
  it('lists themselves, open search and go between screens', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.get('[data-cy=sidebar]').should('have.attr', 'data-ready', 'true')

      press('?')
      cy.get('[data-cy=shortcuts-dialog]').should('be.visible').and('contain.text', 'Next unread')
      cy.get('body').type('{esc}')
      cy.get('[data-cy=shortcuts-dialog]').should('not.exist')

      // While a dialog is open, the screen behind it takes no keys.
      press('/')
      cy.get('[role=dialog] input').should('be.focused').type('gc')
      cy.location('pathname').should('eq', '/dashboard')
      cy.get('[data-cy=palette-shortcuts]').click()
      cy.get('[data-cy=shortcuts-dialog]').should('be.visible')
      cy.get('body').type('{esc}')

      // "g" then a letter, and only that: on the calendar "c" alone creates,
      // but "g c" there must not also open a new appointment.
      press('gc')
      cy.location('pathname').should('eq', '/calendar')
      cy.contains('select', 'Work week').should('exist')
      press('gc')
      cy.get('[data-cy=create-sheet]').should('not.exist')
      press('gp')
      cy.location('pathname').should('eq', '/patients')
    })
  })

  it('creates, steps and switches the calendar, and moves an open visit along', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Irene', lastName: 'Atajo' }).then((p) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: todayAt(10), confirmationStatus: 'confirmed' })
      })
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.get('[data-cy=sidebar]').should('have.attr', 'data-ready', 'true')

      press('d')
      cy.contains('select', 'Day').should('have.value', 'day')
      cy.contains('[data-cy=appt-block]', 'Irene Atajo').should('exist')
      press('j')
      cy.contains('[data-cy=appt-block]', 'Irene Atajo').should('not.exist')
      press('t')
      cy.contains('[data-cy=appt-block]', 'Irene Atajo').should('exist')

      press('c')
      cy.get('[data-cy=create-sheet]').should('be.visible')
      cy.get('body').type('{esc}')
      cy.get('[data-cy=create-sheet]').should('not.exist')

      cy.contains('[data-cy=appt-block]', 'Irene Atajo').click()
      cy.get('[data-cy=appt-sheet]').should('be.visible')
      cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'checkin')
      // With the visit open, "c" belongs to nothing: no second appointment.
      press('c')
      cy.get('[data-cy=create-sheet]').should('not.exist')
      press('a')
      cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'withp')
      press('p')
      cy.get('[data-cy=appt-tab-billing]').should('have.attr', 'aria-selected', 'true')
    })
  })

  it('walks the Inbox list, jumps to the next unread and goes to the reply', () => {
    cy.seedStaffAccount().then((account) => {
      const thread = (first: string, phone: string, ago: number) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Atajo' }).then((p) =>
          cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: p.id, phoneNumber: phone, direction: 'inbound', bodyPreview: `Hola, soy ${first}`, createdAt: minutesAgo(ago) }),
        )
      thread('Ana', '+34600000001', 10)
      thread('Berta', '+34600000002', 20)
      thread('Carla', '+34600000003', 30)

      cy.login(account.email, account.password)
      cy.visit('/inbox')
      cy.get('[data-cy=inbox-row]').should('have.length', 3)

      press('j')
      cy.get('[data-cy=inbox-row][aria-current=true]').should('contain.text', 'Ana Atajo')
      press('j')
      cy.get('[data-cy=inbox-row][aria-current=true]').should('contain.text', 'Berta Atajo')
      press('k')
      cy.get('[data-cy=inbox-row][aria-current=true]').should('contain.text', 'Ana Atajo')
      // Ana and Berta are read now; the next unread is Carla.
      press('u')
      cy.get('[data-cy=inbox-row][aria-current=true]').should('contain.text', 'Carla Atajo')
      press('r')
      cy.focused().should('match', 'textarea')
    })
  })
})
