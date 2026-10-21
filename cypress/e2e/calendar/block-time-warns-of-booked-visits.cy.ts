import { dateInputValue } from '../../support/calendar'

// "Bloquear horario" over visits already booked (components/calendar/
// BlockClashes.vue): the form lists them before saving and the button says
// "Block anyway". Blocking still moves and cancels nothing -- the visit stays
// booked -- but nobody finds it later inside the grey without being told.
describe('Blocking time over booked visits', () => {
  it('lists the visits the block would sit on, and keeps them booked', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Iker', lastName: 'Bloqueo' }).then((patient) => {
        const day = new Date()
        day.setDate(day.getDate() + 3)
        day.setHours(10, 0, 0, 0)
        cy.task<{ id: string }>('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          practitionerId: account.teamMemberId,
          startsAt: day.toISOString(),
        }).then((visit) => {
          cy.login(account.email, account.password)
          cy.visit('/calendar')
          cy.contains('button', 'Block time').click()
          cy.get('.fixed.inset-0.z-50').within(() => {
            cy.contains('label', 'Start date').parent().find('input').clear().type(dateInputValue(day))
            cy.contains('label', 'End date').parent().find('input').clear().type(dateInputValue(day))
            cy.contains('label', 'Start time').parent().find('input').clear().type('09:00')
            cy.contains('label', 'End time').parent().find('input').clear().type('12:00')

            cy.get('[data-cy=block-clashes]').should('contain', 'There is already a visit booked in this time')
            cy.get('[data-cy=block-clash]').should('have.length', 1).and('contain', 'Iker Bloqueo').and('contain', '10:00')
            cy.contains('button', 'Block anyway').should('be.visible')

            // Moved off the visit: nothing to say, and the button is Save.
            cy.contains('label', 'Start time').parent().find('input').clear().type('13:00')
            cy.contains('label', 'End time').parent().find('input').clear().type('14:00')
            cy.get('[data-cy=block-clashes]').should('not.exist')
            cy.contains('button', /^Save$/).should('be.visible')

            cy.contains('label', 'Start time').parent().find('input').clear().type('09:00')
            cy.contains('label', 'End time').parent().find('input').clear().type('12:00')
            cy.contains('button', 'Block anyway').click()
          })
          cy.get('.fixed.inset-0.z-50').should('not.exist')
          cy.task<any[]>('db:selectRows', { table: 'availability_blocks', columns: 'id', match: { account_id: account.accountId } }).should('have.length', 1)
          cy.task<any[]>('db:selectRows', { table: 'appointments', columns: 'status', match: { id: visit.id } }).its('0.status').should('not.eq', 'cancelled')
        })
      })
    })
  })
})
