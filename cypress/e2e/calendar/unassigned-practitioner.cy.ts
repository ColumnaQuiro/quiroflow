// An appointment with no practitioner is invisible on this calendar: the grid
// is one tab per practitioner and the query behind a tab is a plain
// `.eq('practitioner_id', ...)`, so a NULL row matches no tab at all. These
// two specs cover the two halves of that -- not creating such a row by
// accident, and being able to find one that exists anyway.

// Noon local, which sits inside the grid's 08:00-20:00 window (START_HOUR /
// END_HOUR in pages/calendar.vue) in every timezone. Deliberately not derived
// from toISOString() like a date input would be: the grid ranges from *local*
// midnight, so a UTC-derived "today" lands on the wrong day either side of
// the dateline.
function todayAtNoonLocal() {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

describe('Appointments with no practitioner', () => {
  // The calendar fetches its practitioners after mount and hands the tab it
  // settles on down to the booking panel as a prefill. The panel used to read
  // that prop exactly once, as it mounted, so a panel opened in the gap kept
  // '' for the whole of its life however long the form stayed open -- and
  // booked an appointment no tab could ever show. Holding team_member_clinics
  // open widens that gap enough to walk into deliberately, which is all the
  // calendar flake in #206 was doing by accident.
  it('adopts the calendar practitioner when the panel opens before it has loaded', () => {
    cy.seedStaffAccount({ ownerName: 'Dana Practitioner' }).then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Alice',
        lastName: 'Anderson',
      }).then(() => {
        cy.login(account.email, account.password)

        cy.intercept('GET', '**/rest/v1/team_member_clinics*', (req) => {
          req.on('response', (res) => {
            res.setDelay(6000)
          })
        }).as('teamMemberClinics')

        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')

        cy.clickUntil('button:contains("New Appointment")', 'input[placeholder="Search by name, phone, or email…"]')

        // The panel is open *and* the reference data is still in flight --
        // the precondition the bug needed, so assert it rather than hope for
        // it. This line is the difference between testing the fix and
        // testing nothing.
        cy.contains('No practitioners are assigned to this clinic yet.').should('exist')

        cy.wait('@teamMemberClinics')

        cy.get('.fixed.inset-0.z-50').within(() => {
          // The fix: the Practitioner select follows the prefill in once it
          // lands, with the user never touching it. Before it, this stayed on
          // "Unassigned" however long the panel was open. Selects in this
          // form, in order: Appointment Type, Room, Practitioner, Repeat.
          cy.get('select').eq(2).find('option:selected').should('have.text', 'Dana Practitioner')

          cy.get('input[placeholder="Search by name, phone, or email…"]').type('Alice')
          cy.contains('li', 'Alice Anderson').click()
          cy.get('select').eq(0).should('contain.text', 'Consultation').select('Consultation (30 min)')
          // Exact match -- 'Create' alone hits the "Create Appointment" tab
          // label, which is also a button and earlier in the DOM.
          cy.contains('button', /^Create$/).click()
        })
        cy.get('.fixed.inset-0.z-50').should('not.exist')

        // The point of all of the above: it lands on the practitioner's own
        // tab, which is the only place this calendar can show it.
        cy.get('[data-testid="practitioner-tab"]').should('have.length', 1).and('contain.text', 'Dana Practitioner').and('have.class', 'bg-brand')
        cy.contains('Alice Anderson').should('be.visible')
      })
    })
  })

  // Booking is not the only way to get one. A PracticeHub import whose
  // "Practitioner" column matched no team member, or a public API booking
  // that omitted one, writes NULL just the same -- and those rows still count
  // toward "Today at a glance" while appearing on no tab, so the grid
  // contradicts the number printed above it.
  it('shows an existing unassigned appointment on its own tab', () => {
    cy.seedStaffAccount({ ownerName: 'Dana Practitioner' }).then((account) => {
      cy.task<{ id: string }>('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Mona',
        lastName: 'Orphan',
      }).then((patient) => {
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: todayAtNoonLocal(),
          practitionerId: null,
        })

        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')

        // The calendar opens on the first practitioner's tab, where this
        // appointment correctly does not belong.
        cy.get('[data-testid="practitioner-tab"]').should('have.length', 1).and('contain.text', 'Dana Practitioner').and('have.class', 'bg-brand')
        cy.contains('Mona Orphan').should('not.exist')

        cy.get('[data-testid="practitioner-tab-unassigned"]').click()
        cy.contains('Mona Orphan').should('be.visible')
      })
    })
  })
})
