describe('Reschedule mode (cross-week move)', () => {
  it('moves an appointment to a different week via Reschedule button + slot click, not drag', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Alice', lastName: 'Anderson' }).then(() => {
        cy.login(account.email, account.password)
        cy.visit('/calendar')

        // Day view keeps the appointment (and, later, the target slot a week
        // out) in a single always-visible column -- same reasoning as the
        // booking/billing spec.
        cy.contains('select', 'Work week').select('day')

        cy.clickUntil('button:contains("New Appointment")', 'input[placeholder="Search by name, phone, or email…"]')

        cy.get('.fixed.inset-0.z-50').within(() => {
          cy.get('input[placeholder="Search by name, phone, or email…"]').type('Alice')
          cy.contains('li', 'Alice Anderson').click()
          cy.get('select').eq(0).should('contain.text', 'Consultation').select('Consultation (30 min)')
          cy.contains('button', /^Create$/).click()
        })
        cy.get('.fixed.inset-0.z-50').should('not.exist')
        cy.contains('Alice Anderson').should('be.visible')

        // Open the appointment and enter reschedule mode instead of dragging.
        cy.contains('Alice Anderson').click({ force: true })
        cy.contains('h2', 'Edit Appointment').should('be.visible')
        cy.contains('button', 'Reschedule…').click()

        // The modal closes and the picking banner takes its place -- the
        // whole point being that navigation still works from here.
        cy.contains('h2', 'Edit Appointment').should('not.exist')
        cy.contains('Rescheduling').should('be.visible')
        cy.contains('Alice Anderson').should('be.visible') // still on the original day, untouched so far

        // Navigate a full week forward, one day at a time, while still in
        // reschedule mode -- this is exactly the gap drag-and-drop can't
        // cross (it only ever sees whatever day/room columns are already
        // rendered in the DOM right now).
        for (let i = 0; i < 7; i++) {
          cy.get('[aria-label="Next"]').click()
        }
        // Each nav click re-triggers an async reload of the visible range;
        // firing all 7 back-to-back can leave an earlier one still in
        // flight. Its result would only ever be a stale *render* (the slot
        // click below reads anchorDate directly, not the appointments list),
        // but a stale render could still cover the target pixel with a leftover
        // block. Giving the last reload a moment to land avoids that.
        cy.wait(300)

        // Click a clearly empty part of the day column (well within the
        // initial viewport, no scrolling needed) to pick the new slot.
        cy.get('[data-cal-col]').first().click(30, 60)

        cy.contains('h2', 'Rescheduling Appointment').should('be.visible')
        cy.contains('Alice Anderson').should('be.visible')
        cy.contains('button', 'Confirm').click()
        cy.contains('h2', 'Rescheduling Appointment').should('not.exist')
        cy.contains('Rescheduling').should('not.exist') // banner gone, mode exited

        // It's now on this (one-week-later) day...
        cy.contains('Alice Anderson').should('be.visible')

        // ...and gone from the original day, seven days back.
        for (let i = 0; i < 7; i++) {
          cy.get('[aria-label="Previous"]').click()
        }
        cy.contains('Alice Anderson').should('not.exist')
      })
    })
  })
})
