import type { StaffAccount } from '../../support/commands'

// A description of an appointment type for patients booking online
// (appointment_types.online_description), as PracticeHub has: a list of bare
// names leaves a new patient guessing which visit to book. Written in
// Settings -> Appointment types, shown under the name on the booking page --
// on the service card, or in the summary when there is no card to put it on.

const DESCRIPTION = 'Primera valoración: historia y exploración.\nTrae tus informes.'

function createType(account: StaffAccount, name: string) {
  return cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name, onlineBookingEnabled: true })
}

function descriptionOf(id: string) {
  return cy.task<{ row: { online_description: string | null } | null }>('db:appointmentTypeRow', { id }).then((st) => st.row?.online_description ?? null)
}

describe('A description of an appointment type for patients', () => {
  it('is written in settings and shown when booking online, and cleared to nothing', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      createType(account, 'Revisión')
      createType(account, 'Primera visita').then((type) => {
        cy.login(account.email, account.password)
        cy.visit(`/settings/appointment-types/${type.id}`)
        cy.get('[data-cy=type-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=type-online-description]').type(DESCRIPTION)
        cy.contains('button', 'Save').click()
        cy.contains(/^Saved$/).should('be.visible')
        descriptionOf(type.id).should('eq', DESCRIPTION)

        // On its card, line break kept; the other type has none.
        cy.visit(`/book/${account.accountSlug}`)
        cy.contains('[data-cy=booking-service-option]', 'Primera visita')
          .find('[data-cy=booking-service-description]')
          .should('have.text', DESCRIPTION)
          .and('have.css', 'white-space', 'pre-line')
        cy.contains('[data-cy=booking-service-option]', 'Revisión').find('[data-cy=booking-service-description]').should('not.exist')

        // A link to that type alone shows no cards, so the summary carries it.
        cy.visit(`/book/${account.accountSlug}?type=${type.id}`)
        cy.get('[data-cy=booking-summary-description]').should('have.text', DESCRIPTION)

        // Emptied, it is no description at all rather than an empty string.
        cy.visit(`/settings/appointment-types/${type.id}`)
        cy.get('[data-cy=type-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=type-online-description]').should('have.value', DESCRIPTION).clear()
        cy.contains('button', 'Save').click()
        cy.contains(/^Saved$/).should('be.visible')
        descriptionOf(type.id).should('eq', null)
        cy.visit(`/book/${account.accountSlug}`)
        cy.contains('[data-cy=booking-service-option]', 'Primera visita').find('[data-cy=booking-service-description]').should('not.exist')
      })
    })
  })
})
