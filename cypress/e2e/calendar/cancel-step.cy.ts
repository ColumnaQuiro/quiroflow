import type { StaffAccount } from '../../support/commands'
import { offerExpiresAt, waitlistEntryMatches, WAITLIST_OFFER_CUTOFF_MINUTES } from '../../../utils/waitlistOffer'

// Cancelling from the appointment panel: the fee and the freed slot are two
// explicit choices, and the waitlist offer's deadline is capped at 20 minutes
// before the visit, on the server and on screen alike.

describe('Waitlist offer rules', () => {
  const now = new Date('2026-09-23T17:40:00Z')
  it('gives two hours when the slot is far enough off', () => {
    expect(offerExpiresAt(now, new Date('2026-09-24T09:00:00Z'))!.toISOString()).to.equal('2026-09-23T19:40:00.000Z')
  })
  it('caps the offer 20 minutes before a slot starting sooner than that', () => {
    // Starts in 50 min: two hours would outlive the visit.
    expect(offerExpiresAt(now, new Date('2026-09-23T18:30:00Z'))!.toISOString()).to.equal('2026-09-23T18:10:00.000Z')
    expect(WAITLIST_OFFER_CUTOFF_MINUTES).to.equal(20)
  })
  it('offers nothing once the cutoff has passed', () => {
    expect(offerExpiresAt(now, new Date('2026-09-23T17:55:00Z'))).to.equal(null)
  })
  it('matches "any" preferences and exact ones, and nothing else', () => {
    const slot = { appointmentTypeId: 'aj', practitionerId: 'marta' }
    expect(waitlistEntryMatches({ appointment_type_id: null, practitioner_id: null }, slot)).to.equal(true)
    expect(waitlistEntryMatches({ appointment_type_id: 'aj', practitioner_id: 'marta' }, slot)).to.equal(true)
    expect(waitlistEntryMatches({ appointment_type_id: 'pv', practitioner_id: null }, slot)).to.equal(false)
    expect(waitlistEntryMatches({ appointment_type_id: null, practitioner_id: 'javier' }, slot)).to.equal(false)
  })
})

/** Tomorrow at noon, local: inside the grid and far enough off for a full two-hour offer. */
function tomorrowNoon() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(12, 0, 0, 0)
  return d
}

interface Seeded {
  account: StaffAccount
  patientId: string
  appointmentId: string
  montseEntryId: string
}

function seed(feeCents: number | null): Cypress.Chainable<Seeded> {
  return cy.seedStaffAccount().then((account) => {
    cy.task('db:setCancellationFee', { accountId: account.accountId, cents: feeCents })
    const patient = (first: string, last: string) =>
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: last })
    return patient('Sergio', 'Navarro').then((sergio) =>
      cy
        .task<{ id: string }>('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: sergio.id,
          practitionerId: account.teamMemberId,
          startsAt: tomorrowNoon().toISOString(),
        })
        .then((appt) =>
          // Two matching entries, the older first; one that asked for another
          // practitioner and must not be offered this slot.
          patient('Montse', 'Aguilar').then((montse) =>
            cy
              .task<{ id: string }>('db:createWaitlistEntry', {
                accountId: account.accountId,
                clinicId: account.clinicId,
                patientId: montse.id,
                createdAt: new Date(Date.now() - 11 * 86_400_000).toISOString(),
              })
              .then((montseEntry) => {
                patient('Pau', 'Esteve').then((pau) =>
                  cy.task('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: pau.id, createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString() }),
                )
                return cy.wrap({ account, patientId: sergio.id, appointmentId: appt.id, montseEntryId: montseEntry.id })
              }),
          ),
        ),
    )
  })
}

function openCancelStep(account: StaffAccount) {
  cy.login(account.email, account.password)
  cy.visit('/calendar')
  cy.contains('select', 'Work week').select('day')
  cy.get('[aria-label="Next"]').click()
  cy.contains('[data-cy=appt-block]', 'Sergio Navarro').click()
  cy.get('[data-cy=cancel-appointment]').click()
  cy.get('[data-cy=cancel-sheet]').should('be.visible')
}

describe('Cancelling an appointment', () => {
  it('adds the fee to the balance and offers the slot to the first match', () => {
    seed(1500).then(({ account, patientId, appointmentId, montseEntryId }) => {
      openCancelStep(account)

      cy.get('[data-cy=cancel-sheet]').within(() => {
        cy.get('[data-cy=cancel-notice]').should('contain.text', 'Starts in')
        // Oldest matching entry first; the offer names her and her deadline.
        cy.get('[data-cy=cancel-waitlist-entry]').should('have.length', 2).first().should('contain.text', 'Montse Aguilar').and('contain.text', 'first')
        cy.get('[data-cy=cancel-offer]').should('contain.text', 'Offer it to Montse Aguilar')
        cy.get('[data-cy=cancel-offer-deadline]').invoke('text').should('match', /until \d\d:\d\d to accept/).and('contain', 'If not, it goes to Pau')

        // The button says what will happen, and changes with each choice.
        cy.get('[data-cy=confirm-cancel]').should('have.text', 'Cancel appointment · offer slot')
        cy.get('[data-cy=cancel-fee-balance]').click()
        cy.contains('[data-cy=confirm-cancel]', 'Cancel appointment · charge 15,00 € · offer slot').should('exist')
        cy.get('[data-cy=cancel-leave-free]').click()
        cy.contains('[data-cy=confirm-cancel]', 'Cancel appointment · charge 15,00 €').should('exist')
        cy.get('[data-cy=cancel-summary]').should('contain.text', 'the slot stays free')
        cy.get('[data-cy=cancel-offer]').click()
        cy.get('[data-cy=cancel-summary]').should('contain.text', 'Montse gets the offer now')

        cy.get('[data-cy=confirm-cancel]').click()
      })
      cy.get('[data-cy=appt-sheet]').should('not.exist')

      // Off the grid, and the slot marked as offered in its place.
      cy.contains('[data-cy=appt-block]', 'Sergio Navarro').should('not.exist')
      cy.get('[data-cy=freed-slot]').should('contain.text', 'Slot offered to Montse Aguilar').and('contain.text', 'replies by')

      cy.task<{ status: string }>('db:appointmentById', { appointmentId }).its('status').should('eq', 'cancelled')
      cy.task<{ status: string; offer_expires_at: string; offered_starts_at: string }>('db:waitlistEntryById', { id: montseEntryId }).then((entry) => {
        expect(entry.status).to.eq('offered')
        const lapses = new Date(entry.offer_expires_at).getTime()
        expect(lapses, 'no later than 20 min before the visit').to.be.at.most(new Date(entry.offered_starts_at).getTime() - 20 * 60_000)
        expect(lapses, 'no later than two hours from now').to.be.at.most(Date.now() + 2 * 3_600_000 + 60_000)
      })
      cy.task<{ status: string; total_cents: number; invoice_line_items: { description: string }[] }[]>('db:invoicesFor', { patientId }).then((invoices) => {
        expect(invoices).to.have.length(1)
        expect(invoices[0].status).to.eq('unpaid')
        expect(invoices[0].total_cents).to.eq(1500)
        expect(invoices[0].invoice_line_items[0].description).to.eq('Cancellation fee')
      })
    })
  })

  it('asks nothing about a fee the clinic does not charge, and can leave the slot free', () => {
    seed(null).then(({ account, patientId, appointmentId, montseEntryId }) => {
      openCancelStep(account)
      cy.get('[data-cy=cancel-sheet]').within(() => {
        cy.get('[data-cy=cancel-offer]').should('exist')
        cy.get('[data-cy=cancel-fee]').should('not.exist')
        cy.get('[data-cy=cancel-leave-free]').click()
        cy.get('[data-cy=confirm-cancel]').should('have.text', 'Cancel appointment').click()
      })
      cy.get('[data-cy=appt-sheet]').should('not.exist')
      cy.task<{ status: string }>('db:appointmentById', { appointmentId }).its('status').should('eq', 'cancelled')
      // Nobody was offered anything: offer-next was not called.
      cy.task<{ status: string }>('db:waitlistEntryById', { id: montseEntryId }).its('status').should('eq', 'waiting')
      cy.get('[data-cy=freed-slot]').should('not.exist')
      cy.task('db:invoicesFor', { patientId }).should('have.length', 0)
    })
  })

  it('goes back to the appointment without cancelling', () => {
    seed(1500).then(({ account, appointmentId }) => {
      openCancelStep(account)
      cy.get('[data-cy=cancel-back]').click()
      cy.get('[data-cy=cancel-sheet]').should('not.exist')
      cy.get('[data-cy=appt-sheet]').should('be.visible')
      cy.task<{ status: string }>('db:appointmentById', { appointmentId }).its('status').should('eq', 'booked')
    })
  })
})
