// How many of a day's free times a type shows on the booking page
// (appointment_types.online_slots_per_day,
// supabase/migrations/20261125094154_online_slots_per_day.sql): a clinic's
// "3 available slots per day" for first visits, so the diary looks in demand.
//
// 1. Set in Settings -> Appointment types, and cleared again.
// 2. The booking page shows that many, spread across the day; a type without
//    it shows every free time.
describe('Times shown per day, per appointment type', () => {
  beforeEach(() => {
    cy.seedStaffAccount().as('acct')
    cy.get('@acct').then((account: any) => {
      // Monday to Friday, 08:00-19:00: 22 half-hours a day.
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Primera visita', durationMinutes: 30, onlineBookingEnabled: true }).as('limited')
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30, onlineBookingEnabled: true }).as('open')
    })
  })

  const daySlots = () => cy.get('[data-cy=booking-slot]').then(($slots) => [...$slots].map((s) => s.textContent?.trim()))
  const openLastDay = (slug: string, typeId: string) => {
    cy.visit(`/book/${slug}?type=${typeId}`)
    cy.contains('Elija su fecha y hora').should('be.visible')
    // The furthest day on show: nothing booked, and not today.
    cy.get('.grid.grid-cols-7 button:not([disabled])').should('have.length.greaterThan', 0).last().click()
  }

  it('is set in Settings -> Appointment types, and cleared again', () => {
    cy.get('@acct').then((account: any) => {
      cy.get<{ id: string }>('@limited').then((type) => {
        cy.login(account.email, account.password)
        cy.visit(`/settings/appointment-types/${type.id}`)
        cy.get('[data-cy=type-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=type-slots-per-day]').scrollIntoView().type('30')
        cy.get('[data-cy=type-error-slots-per-day]').should('be.visible')
        cy.get('[data-cy=type-slots-per-day]').clear().type('3')
        cy.get('[data-cy=type-error-slots-per-day]').should('not.exist')
        cy.contains('button', 'Save').click()
        cy.contains(/^Saved$/).should('be.visible')
        cy.task<{ row: { online_slots_per_day: number | null } | null }>('db:appointmentTypeRow', { id: type.id }).its('row.online_slots_per_day').should('eq', 3)

        cy.reload()
        cy.get('[data-cy=type-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=type-slots-per-day]').should('have.value', '3').clear()
        cy.contains('button', 'Save').click()
        cy.contains(/^Saved$/).should('be.visible')
        cy.task<{ row: { online_slots_per_day: number | null } | null }>('db:appointmentTypeRow', { id: type.id }).its('row.online_slots_per_day').should('eq', null)
      })
    })
  })

  it('shows only that many on the booking page, spread across the day', () => {
    cy.get('@acct').then((account: any) => {
      cy.get<{ id: string }>('@limited').then((type) => {
        cy.task('db:updateRows', { table: 'appointment_types', values: { online_slots_per_day: 3 }, match: { id: type.id } })
        openLastDay(account.accountSlug, type.id)
        daySlots().should('deep.eq', ['08:00', '13:30', '18:30'])

        // What the page reads beside get_public_booking_info, as anon.
        cy.task<{ error: string | null; data: { appointment_type_id: string; online_slots_per_day: number }[] | null }>('db:callRpcAsAnon', {
          fn: 'get_appointment_type_slots_per_day',
          args: { p_type_ids: [type.id] },
        }).then((r) => {
          expect(r.error).to.eq(null)
          expect(r.data).to.deep.eq([{ appointment_type_id: type.id, online_slots_per_day: 3 }])
        })
      })
      // A type without it shows every free time, as before.
      cy.get<{ id: string }>('@open').then((open) => {
        openLastDay(account.accountSlug, open.id)
        daySlots().should('have.length', 22)
      })
    })
  })
})
