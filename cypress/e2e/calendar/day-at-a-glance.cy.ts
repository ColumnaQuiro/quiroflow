import type { StaffAccount } from '../../support/commands'

// The calendar grid as the front desk reads it: every visit drawn in its
// stage, the day counted above the grid, each count a filter, the hours
// nobody works hatched, and a slot freed for the waitlist marked as taken.
// Every state here is asserted through data-cy / data-stage hooks, never by
// hovering, so none of it depends on pointer timing.

/** Today at hh:mm, local -- the grid ranges from local midnight. */
function today(h: number, m = 0) {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))

interface Seeded {
  account: StaffAccount
  roomId: string
}

function seedDay(): Cypress.Chainable<Seeded> {
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 1' }).then((room) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
      const visit = (first: string, last: string, h: number, m: number, extra: Record<string, unknown> = {}) =>
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
                startsAt: today(h, m),
                ...extra,
              })
              .then((appt) => ({ patientId: patient.id, appointmentId: appt.id })),
          )

      visit('Jordi', 'Mas', 10, 0, { checkedInAt: today(9, 55), flowWithPractitionerAt: today(10, 2) })
      visit('Laura', 'Gómez', 10, 30, { checkedInAt: today(10, 16), confirmationStatus: 'confirmed' }).then(({ patientId }) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId, totalCents: 4500, status: 'unpaid' })
        cy.task('db:setStickyNote', { patientId, note: 'Hernia discal L5.' })
      })
      visit('Sergio', 'Navarro', 11, 0, { confirmationStatus: 'pending' }).then(({ appointmentId }) => {
        cy.task('db:createReschedule', { accountId: account.accountId, appointmentId, fromStartsAt: today(17), toStartsAt: today(11) })
        cy.task('db:createReschedule', { accountId: account.accountId, appointmentId, fromStartsAt: today(16), toStartsAt: today(17) })
      })
      visit('Elena', 'Castro', 11, 30, { source: 'online', confirmationStatus: 'pending' })
      visit('David', 'Ramos', 12, 0, { confirmationStatus: 'reschedule_requested' })
      visit('Raúl', 'Iglesias', 12, 30, { confirmationStatus: 'confirmed' })
      visit('Íñigo', 'Romero', 13, 0, { checkedInAt: today(12, 55), flowWithPractitionerAt: today(13, 0), flowCheckoutAt: today(13, 25) })
      visit('Nuria', 'Sala', 13, 30, { status: 'no_show' })
      visit('Pablo', 'Ferrer', 14, 0, { status: 'completed' })
      visit('Carla', 'Cancel', 14, 30, { status: 'cancelled' })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Teresa', lastName: 'Llorens' }).then((teresa) => {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        cy.task('db:createWaitlistEntry', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: teresa.id,
          status: 'offered',
          offered: { startsAt: today(15), endsAt: today(15, 30), roomId: room.id, practitionerId: account.teamMemberId, expiresAt: tomorrow.toISOString() },
        })
      })
      return cy.wrap({ account, roomId: room.id })
    }),
  )
}

function block(name: string) {
  return cy.contains('[data-cy=appt-block]', name)
}

describe('Calendar: the day at a glance', () => {
  it('draws each visit in its stage, with what it owes and what to watch for', () => {
    seedDay().then(({ account }) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      block('Sergio Navarro').should('have.attr', 'data-stage', 'pending')
      block('Elena Castro').should('have.attr', 'data-stage', 'online')
      block('David Ramos').should('have.attr', 'data-stage', 'resched')
      block('Raúl Iglesias').should('have.attr', 'data-stage', 'confirmed')
      block('Laura Gómez').should('have.attr', 'data-stage', 'arrived')
      block('Jordi Mas').should('have.attr', 'data-stage', 'withp')
      block('Íñigo Romero').should('have.attr', 'data-stage', 'checkout')
      block('Nuria Sala').should('have.attr', 'data-stage', 'noshow')
      block('Pablo Ferrer').should('have.attr', 'data-stage', 'completed')

      // The stage label says where the patient is; "Arrived" carries the time.
      block('Laura Gómez').find('[data-cy=appt-block-stage]').should('contain.text', 'Arrived 10:16')
      // Red is money: the patient's balance, on the block.
      block('Laura Gómez').find('[data-cy=appt-block-owes]').should('contain.text', 'Owes').and('contain.text', '45,00')
      block('Laura Gómez').find('[data-cy=appt-block-note]').should('exist')
      block('Sergio Navarro').find('[data-cy=appt-block-moved]').should('contain.text', '2')
      // In the room with nothing booked after: the moment to book the next one.
      block('Jordi Mas').find('[data-cy=appt-block-no-next]').should('contain.text', 'No next visit')
      // ...and not on a visit still to come.
      block('Raúl Iglesias').find('[data-cy=appt-block-no-next]').should('not.exist')

      // Cancelled visits leave the grid until asked for.
      cy.contains('[data-cy=appt-block]', 'Carla Cancel').should('not.exist')
      cy.get('[data-cy=display-showCancelled]').click()
      block('Carla Cancel').should('have.attr', 'data-stage', 'cancelled')
      cy.get('[data-cy=display-showCancelled]').click()
      cy.contains('[data-cy=appt-block]', 'Carla Cancel').should('not.exist')

      // Hours nobody works are hatched (08:00-09:00 here).
      cy.get('[data-cy=closed-hours]').should('exist')

      // The slot freed for the waitlist is marked, not offered as free.
      cy.get('[data-cy=freed-slot]').should('contain.text', 'Slot offered to Teresa Llorens').and('contain.text', 'replies by')
    })
  })

  it('counts the day, and each count dims everything it does not match', () => {
    seedDay().then(({ account }) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      cy.get('[data-cy=day-counts-total]').should('contain.text', '9')
      cy.get('[data-cy=day-filter-pending]').invoke('text').should('match', /2\s*unconfirmed/)
      cy.get('[data-cy=day-filter-resched]').invoke('text').should('match', /1\s*want to move/)
      cy.get('[data-cy=day-filter-arrived]').invoke('text').should('match', /1\s*waiting/)
      cy.get('[data-cy=day-filter-withp]').invoke('text').should('match', /1\s*in session/)
      cy.get('[data-cy=day-filter-checkout]').invoke('text').should('match', /1\s*to pay/)
      cy.get('[data-cy=day-filter-owes]').should('contain.text', 'owe').and('contain.text', '45,00')

      cy.get('[data-cy=day-filter-owes]').click().should('have.attr', 'aria-pressed', 'true')
      block('Laura Gómez').should('not.have.attr', 'data-dimmed')
      block('Sergio Navarro').should('have.attr', 'data-dimmed')
      cy.get('[data-cy=appt-block]:not([data-dimmed])').should('have.length', 1)

      // Switching filter: online bookings count as unconfirmed too.
      cy.get('[data-cy=day-filter-pending]').click()
      cy.get('[data-cy=appt-block]:not([data-dimmed])').should('have.length', 2)
      block('Elena Castro').should('not.have.attr', 'data-dimmed')

      cy.get('[data-cy=day-filter-clear]').click()
      cy.get('[data-cy=appt-block][data-dimmed]').should('not.exist')

      // Week view puts the two counts that need someone to act in each day's header.
      cy.contains('select', 'Day').select('week')
      cy.get('[data-cy=day-header-counts]').should('contain.text', '2 unconfirmed').and('contain.text', '1 owe')
    })
  })

  it('moves a cell cursor with the arrow keys and books the free cell on Enter', () => {
    seedDay().then(({ account }) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      block('Laura Gómez').should('exist')

      // Room 1 is the first column and empty. To the top of the day (08:00,
      // hatched -- nobody works then, so no booking prompt), then two slots
      // down to 09:00, which is free.
      cy.get('[data-cy=calendar-grid]').focus().type('{uparrow}'.repeat(30))
      cy.get('[data-cy=calendar-grid] [aria-live=polite]').should('contain.text', 'Room 1, 08:00').and('contain.text', 'unavailable')
      cy.get('[data-cy=slot-ghost]').should('not.exist')
      cy.get('[data-cy=calendar-grid]').type('{downarrow}{downarrow}')
      cy.get('[data-cy=slot-ghost]').should('contain.text', 'Book 09:00').and('contain.text', 'Enter')

      // Onto a booked cell: the ghost goes, the visit is announced.
      cy.get('[data-cy=calendar-grid]').type('{rightarrow}{downarrow}{downarrow}')
      cy.get('[data-cy=calendar-grid] [aria-live=polite]').should('contain.text', 'Sala 1, 10:00').and('contain.text', 'Jordi Mas')
      cy.get('[data-cy=slot-ghost]').should('not.exist')

      cy.get('[data-cy=calendar-grid]').type('{leftarrow}{enter}')
      cy.get('input[type="time"]').should('have.value', '10:00')
    })
  })
})
