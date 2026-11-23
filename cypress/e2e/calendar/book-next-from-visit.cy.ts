import type { StaffAccount } from '../../support/commands'
import { SEEDED_PRACTITIONER, dateInputValue, seedVisit, todayAt } from '../../support/calendar'

// "Book next appointment" on an open visit. The end of a visit at the desk
// is booking the one after it, so the visit's own panel opens the
// new-appointment panel on the same patient, practitioner and type, a week on
// at the same time. It is the filled button once the visit is processed and
// a quiet one before, because some clinics process later.

interface Seeded { account: StaffAccount; followUp: string }

function seed(): Cypress.Chainable<Seeded> {
  return cy.seedStaffAccount().then((account) =>
    // Two types, and the visits are of the second: the panel's own default is
    // the first, so the second being chosen is the visit's type carried over.
    cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30 }).then(() =>
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Revisión', durationMinutes: 45, stage: 'revision' }).then((followUp) =>
        cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Primera visita', durationMinutes: 60, stage: 'first_visit' }).then((first) =>
          seedVisit(account, null, 'Olga', 'Hecha', 10, 0, { status: 'completed', checkedInAt: todayAt(9, 58), appointmentTypeId: followUp.id }).then(() =>
            seedVisit(account, null, 'Bruno', 'Pendiente', 12, 30, { appointmentTypeId: followUp.id }).then(() =>
              seedVisit(account, null, 'Nora', 'Primera', 16, 0, { status: 'completed', checkedInAt: todayAt(15, 55), appointmentTypeId: first.id }).then(() =>
                cy.wrap({ account, followUp: followUp.id }),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}

function openCalendar(account: StaffAccount) {
  cy.login(account.email, account.password)
  cy.visit('/calendar')
  // The default work week has no weekend column, and today may be one.
  cy.contains('select', 'Work week').select('day')
}

function nextWeek(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return dateInputValue(d)
}

function chosen(selector: string) {
  return cy.get(`${selector}[aria-checked=true]`)
}

describe('Book next appointment, from a visit', () => {
  it('is the filled button on a processed visit and opens the booking on that patient', () => {
    seed().then(({ account }) => {
      openCalendar(account)
      cy.contains('[data-cy=appt-block]', 'Olga Hecha').click()
      cy.get('[data-cy=appt-sheet]').find('[data-cy=book-next]').should('have.attr', 'data-emphasis', 'primary').and('contain.text', 'Book next appointment').click()

      cy.get('[data-cy=appt-sheet]').should('not.exist')
      cy.get('[data-cy=create-sheet]').should('be.visible').within(() => {
        cy.get('[data-cy=create-patient-selected]').should('contain.text', 'Olga Hecha')
        cy.get('[data-cy=create-patient-search]').should('not.exist')
        chosen('[data-cy=create-type]').should('contain.text', 'Revisión')
        chosen('[data-cy=create-practitioner]').should('contain.text', SEEDED_PRACTITIONER)
        cy.get('[data-cy=create-when]').should('contain.text', '10:00')
        cy.get('input[type=date]').first().should('have.value', nextWeek())
      })
    })
  })

  it('is there, quietly, on a visit not processed yet', () => {
    seed().then(({ account }) => {
      openCalendar(account)
      cy.contains('[data-cy=appt-block]', 'Bruno Pendiente').click()
      cy.get('[data-cy=appt-sheet]').within(() => {
        // Processing is still this screen's filled step; booking sits beside "Move…".
        cy.get('[data-cy=move-appointment]').should('be.visible')
        cy.get('[data-cy=book-next]').should('have.attr', 'data-emphasis', 'quiet').click()
      })

      cy.get('[data-cy=create-sheet]').should('be.visible').within(() => {
        cy.get('[data-cy=create-patient-selected]').should('contain.text', 'Bruno Pendiente')
        chosen('[data-cy=create-type]').should('contain.text', 'Revisión')
        chosen('[data-cy=create-practitioner]').should('contain.text', SEEDED_PRACTITIONER)
        cy.get('[data-cy=create-when]').should('contain.text', '12:30')
      })
    })
  })

  it('does not carry a first visit over as the type of the next one', () => {
    seed().then(({ account }) => {
      openCalendar(account)
      cy.contains('[data-cy=appt-block]', 'Nora Primera').click()
      cy.get('[data-cy=appt-sheet]').find('[data-cy=book-next]').click()

      cy.get('[data-cy=create-sheet]').should('be.visible').within(() => {
        cy.get('[data-cy=create-patient-selected]').should('contain.text', 'Nora Primera')
        chosen('[data-cy=create-type]').should('have.length', 1).and('not.contain.text', 'Primera visita')
      })
    })
  })

  it('a booking opened the usual way afterwards starts from nothing', () => {
    seed().then(({ account }) => {
      openCalendar(account)
      cy.contains('[data-cy=appt-block]', 'Olga Hecha').click()
      cy.get('[data-cy=appt-sheet]').find('[data-cy=book-next]').click()
      cy.get('[data-cy=create-sheet]').find('[data-cy=create-patient-selected]').should('contain.text', 'Olga Hecha')
      cy.get('body').type('{esc}')
      cy.get('[data-cy=create-sheet]').should('not.exist')

      cy.get('[data-cy=new-appointment]').click()
      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-patient-search]').should('be.visible')
        cy.get('[data-cy=create-patient-selected]').should('not.exist')
      })
    })
  })
})
