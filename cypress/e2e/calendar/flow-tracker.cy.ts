import type { StaffAccount } from '../../support/commands'

// The calendar's info panel about TODAY: "Today at a glance", and the flow
// tracker above it -- who has arrived, who is in session, who is waiting to
// pay, and the one step each needs next.
// Both describe the real calendar day whatever the grid is navigated to.

/** Today at hh:mm, local -- the calendar's day starts at local midnight. */
function today(h: number, m = 0) {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
function tomorrow(h: number) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))

function seedDay(): Cypress.Chainable<StaffAccount> {
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 1' }).then((room) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
      const visit = (first: string, last: string, startsAt: string, extra: Record<string, unknown> = {}) =>
        cy
          .task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: last })
          .then((patient) =>
            cy
              .task<{ id: string }>('db:createAppointment', {
                accountId: account.accountId,
                clinicId: account.clinicId,
                patientId: patient.id,
                practitionerId: account.teamMemberId,
                roomId: room.id,
                startsAt,
                ...extra,
              })
              .then((appt) => ({ patientId: patient.id, appointmentId: appt.id })),
          )

      visit('Laura', 'Gómez', today(10, 30), { checkedInAt: today(10, 16), confirmationStatus: 'confirmed' })
      visit('Jordi', 'Mas', today(10), { checkedInAt: today(9, 55), flowWithPractitionerAt: today(10, 2) })
      visit('Íñigo', 'Romero', today(11), { checkedInAt: today(10, 55), flowWithPractitionerAt: today(11), flowCheckoutAt: today(11, 25) }).then(({ patientId }) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId, totalCents: 4000, status: 'unpaid' })
      })
      visit('Sergio', 'Navarro', today(12), { confirmationStatus: 'pending' })
      visit('Pablo', 'Ferrer', today(12, 30), { status: 'completed' })
      visit('Nuria', 'Sala', today(13), { status: 'no_show' })
      visit('Carla', 'Cancel', today(13, 30), { status: 'cancelled' })
      // Deleted: never happened, so neither booked nor in the building.
      visit('Borja', 'Borrado', today(14), { checkedInAt: today(13, 50), deletedAt: today(9) })
      // Booked for today, then moved to tomorrow: counts as today's, as rescheduled.
      visit('Marta', 'Movida', tomorrow(16)).then(({ appointmentId }) => {
        cy.task('db:createReschedule', { accountId: account.accountId, appointmentId, fromStartsAt: today(16), toStartsAt: tomorrow(16) })
      })
      return cy.wrap(account)
    }),
  )
}

function column(stage: 'arrived' | 'withp' | 'checkout') {
  return cy.get(`[data-cy=flow-${stage}]`)
}
function rowIn(stage: 'arrived' | 'withp' | 'checkout', name: string) {
  return column(stage).contains('[data-cy=flow-row]', name)
}

describe('Calendar: today at a glance and the flow tracker', () => {
  it("counts today's visits, whatever day the grid shows", () => {
    seedDay().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      // 8 = seven live visits today + the one moved away; Borja's deletion is not counted.
      cy.get('[data-cy=glance-booked]').should('contain.text', '8')
      cy.get('[data-cy=glance-seen]').should('contain.text', '1 (13 %)')
      cy.get('[data-cy=glance-rescheduled]').should('contain.text', '1 (13 %)')
      cy.get('[data-cy=glance-cancelled]').should('contain.text', '1 (13 %)')
      cy.get('[data-cy=glance-missed]').should('contain.text', '1 (13 %)')

      // Stepping the grid to tomorrow leaves today's numbers alone.
      cy.get('button[aria-label="Next"]').first().click()
      cy.get('[data-cy=glance-booked]').should('contain.text', '8')
      rowIn('arrived', 'Laura Gómez').should('exist')
    })
  })

  it('shows who is in the building and moves each one step on', () => {
    seedDay().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      cy.get('[data-cy=flow-tracker]').should('be.visible')
      rowIn('arrived', 'Laura Gómez').should('contain.text', 'arrived 10:16 · booked 10:30')
      rowIn('withp', 'Jordi Mas').should('contain.text', 'since 10:02')
      rowIn('checkout', 'Íñigo Romero').should('contain.text', 'owes 40,00')
      column('arrived').find('[data-cy=flow-count]').should('have.text', '1')
      // Not in the building: waiting to come, done, gone, or deleted.
      cy.get('[data-cy=flow-tracker]').should('not.contain.text', 'Sergio Navarro').and('not.contain.text', 'Pablo Ferrer').and('not.contain.text', 'Borja Borrado')

      // Laura: into session, then to checkout -- the grid block follows.
      rowIn('arrived', 'Laura Gómez').find('[data-cy=flow-advance]').click()
      rowIn('withp', 'Laura Gómez').should('exist')
      column('arrived').find('[data-cy=flow-count]').should('have.text', '0')
      cy.contains('[data-cy=appt-block]', 'Laura Gómez').should('have.attr', 'data-stage', 'withp')
      rowIn('withp', 'Laura Gómez').find('[data-cy=flow-advance]').click()
      rowIn('checkout', 'Laura Gómez').should('exist')
      cy.contains('[data-cy=appt-block]', 'Laura Gómez').should('have.attr', 'data-stage', 'checkout')

      // "Cobrar" writes nothing: it opens the visit on its Cobro tab.
      rowIn('checkout', 'Íñigo Romero').find('[data-cy=flow-advance]').should('contain.text', 'Charge').click()
      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.contains('Íñigo Romero').should('exist')
        cy.get('[data-cy=appt-tab-billing]').should('have.attr', 'aria-selected', 'true')
      })
      cy.get('body').type('{esc}')
      cy.get('[data-cy=appt-sheet]').should('not.exist')

      // The name opens the visit on its summary.
      rowIn('withp', 'Jordi Mas').find('[data-cy=flow-open]').click()
      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.contains('Jordi Mas').should('exist')
        cy.get('[data-cy=appt-tab-summary]').should('have.attr', 'aria-selected', 'true')
      })
    })
  })

  it('opens a visit from the tracker while the grid is on another day', () => {
    seedDay().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      cy.get('button[aria-label="Next"]').first().click()
      rowIn('withp', 'Jordi Mas').find('[data-cy=flow-open]').click()
      cy.get('[data-cy=appt-sheet]').should('contain.text', 'Jordi Mas')
    })
  })

  it('hides behind its display toggle', () => {
    seedDay().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.get('[data-cy=flow-tracker]').should('be.visible')
      cy.get('[data-cy=display-flowTracker]').should('have.attr', 'aria-checked', 'true').click()
      cy.get('[data-cy=flow-tracker]').should('not.exist')
      cy.get('[data-cy=display-flowTracker]').click()
      // The switch sits further down the scrolling panel than the tracker,
      // so clicking it scrolls the tracker out of view; it is back, above.
      cy.get('[data-cy=flow-tracker]').scrollIntoView().should('be.visible')
    })
  })
})
