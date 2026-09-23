import { SEEDED_PRACTITIONER, assertDayGridShows, dateInputValue, openNewAppointmentPanel, yesterday } from '../../support/calendar'

// Books yesterday rather than taking the panel's default of 09:00 today.
// AppointmentBillingTab only raises an invoice once the visit has actually
// happened (loadAppointmentTiming: starts_at > now => "This appointment
// hasn't happened yet"), so a 09:00-today appointment has no invoice, no
// service picker and no billing UI on any CI run that starts before 09:00
// UTC -- which is what turned this spec red every morning while passing all
// afternoon. Yesterday is in the past whatever the clock says, and 09:00
// still sits inside the day grid's 08:00-20:00 window so the appointment is
// visible to click once the calendar is stepped back a day.
//
// Yesterday, not a fixed weekday -- see yesterday() for why the weekday
// makes no difference to this grid.
const bookedDay = yesterday()

describe('Appointment booking and billing checkout', () => {
  it('books an appointment, then records a payment that completes it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createServiceProduct', { accountId: account.accountId, name: 'Adjustment', priceCents: 5000 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Alice', lastName: 'Anderson' }).then(
        () => {
          cy.login(account.email, account.password)
          cy.visit('/calendar')

          // The calendar defaults to Work week, which only shows today's
          // column within the visible viewport if today happens to fall
          // early in the Mon-Fri range -- on other days it sits off to the
          // right behind horizontal scroll, so the freshly-created
          // appointment below wouldn't actually be visible without one.
          // Day view guarantees a single, always-visible column instead.
          cy.contains('select', 'Work week').select('day')

          openNewAppointmentPanel()

          cy.get('.fixed.inset-0.z-50').within(() => {
            cy.get('input[placeholder="Search by name, phone, or email…"]').type('Alice')
            cy.contains('li', 'Alice Anderson').click()
            // Appointment types load async into this panel -- wait for the option
            // to actually exist rather than racing the fetch (Type select; Room/
            // Practitioner selects come after it). Its label includes the
            // effective duration, so this must match the option's exact text.
            cy.get('select').eq(0).should('contain.text', 'Consultation').select('Consultation (30 min)')
            // Named explicitly rather than left to the panel's prefill. An
            // appointment with no practitioner is filtered out of every
            // practitioner tab by loadAppointments() and so never reaches
            // the grid -- see openNewAppointmentPanel(). The prefill is now
            // correct by the time the panel mounts; choosing the
            // practitioner here means this spec no longer depends on that.
            cy.contains('label', 'Practitioner').parent().find('select').select(SEEDED_PRACTITIONER)
            cy.get('input[type="date"]').clear().type(dateInputValue(bookedDay))
            // Exact match -- a substring match on 'Create' hits the
            // "Create Appointment" tab label (also a button, earlier in the
            // DOM) before ever reaching this actual submit button, silently
            // clicking a no-op and leaving the panel open.
            cy.contains('button', /^Create$/).click()
          })

          // Checks the panel itself is gone, not just this specific
          // placeholder -- it changes to the selected patient's name once
          // picked, so it would falsely read "gone" even with the panel
          // still open.
          cy.get('.fixed.inset-0.z-50').should('not.exist')

          // The calendar is still on today; the appointment was booked for
          // yesterday, so step back a day to bring it into the grid, and
          // check the grid actually got there before reading it.
          cy.get('[aria-label="Previous"]').click()
          assertDayGridShows(bookedDay)
          cy.contains('Alice Anderson').should('be.visible')

          // The default-time appointment can land far enough down the day grid that
          // Cypress's own scroll-into-view leaves it flush under the calendar's sticky
          // column-header row -- a real (if minor) sticky-header quirk, not a broken
          // click handler, so force past it rather than asserting on exact scroll offsets.
          cy.contains('Alice Anderson').click({ force: true })
          cy.get('[data-cy=appt-sheet]').should('be.visible')

          cy.get('[data-cy=appt-sheet]').within(() => {
            cy.get('[data-cy=appt-tab-billing]').click()
            // Nothing is invoiced until someone says how the visit is paid --
            // see ensureInvoice(). "Charge this visit" is that decision (the
            // appointment type carries no price of its own here, so it isn't
            // labelled with an amount).
            cy.contains('Not charged yet').should('be.visible')
            cy.contains('button', 'Charge this visit').click()
            cy.contains('-- Add Service/Product --').should('be.visible')
            cy.get('select').eq(0).should('contain.text', 'Adjustment').select('Adjustment (50,00 €)')

            cy.contains('Total: 50,00 €').should('be.visible')
            cy.contains('Balance due: 50,00 €').should('be.visible')

            cy.contains('button', 'Process').click()

            cy.contains('paid', { matchCase: false }).should('be.visible')
            cy.contains('Balance due: 0,00 €').should('be.visible')
          })
        },
      )
    })
  })
})
