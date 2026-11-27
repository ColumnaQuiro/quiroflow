// An appointment with no practitioner is invisible on this calendar: the grid
// is one tab per practitioner and the query behind a tab is a plain
// `.eq('practitioner_id', ...)`, so a NULL row matches no tab at all. These
// specs cover the two halves of that -- not creating such a row by
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

        // The reference data (types, practitioners, clinic memberships, rooms)
        // comes in one request, calendar_reference; holding it holds all of it.
        cy.intercept('POST', '**/rest/v1/rpc/calendar_reference', (req) => {
          req.on('response', (res) => {
            res.setDelay(6000)
          })
        }).as('teamMemberClinics')

        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')

        cy.clickUntil('[data-cy=new-appointment]', '[data-cy=create-patient-search]')

        // The panel is open *and* the reference data is still in flight --
        // the precondition the bug needed, so assert it rather than hope for
        // it. This line is the difference between testing the fix and
        // testing nothing. (The tab bar shows placeholders until the team has
        // loaded; it used to say "No practitioners are assigned" meanwhile.)
        cy.get('[data-cy=practitioner-tabs-loading]').should('exist')

        cy.wait('@teamMemberClinics')

        cy.get('[data-cy=create-sheet]').within(() => {
          // The fix: the practitioner choice follows the prefill in once it
          // lands, with the user never touching it. Before it, this stayed on
          // "No practitioner" however long the panel was open.
          cy.contains('[data-cy=create-practitioner]', 'Dana Practitioner').should('have.attr', 'aria-checked', 'true')

          cy.get('[data-cy=create-patient-search]').type('Alice')
          cy.contains('[data-cy=create-patient-result]', 'Alice Anderson').click()
          cy.contains('[data-cy=create-type]', 'Consultation').click()
          cy.get('[data-cy=create-submit]').click()
        })
        cy.get('[data-cy=create-sheet]').should('not.exist')

        // The point of all of the above: it lands on the practitioner's own
        // tab, which is the only place this calendar can show it.
        cy.get('[data-testid="practitioner-tab"]').should('have.length', 1).and('contain.text', 'Dana Practitioner').and('have.class', 'bg-brand')
        cy.contains('Alice Anderson').should('be.visible')
      })
    })
  })

  // The "whole clinic" view lays the day out by room, so a slot clicked there
  // carries a room and no practitioner -- and the panel showed "No
  // practitioner" as already chosen. Two visits booked that way at a clinic
  // went on no practitioner's tab and into nobody's My Day, which lists one
  // practitioner's visits only: the patients were booked and never seen.
  it('asks who the visit is with when booked from the whole-clinic view, and lands in My Day', () => {
    cy.seedStaffAccount({ ownerName: 'Dana Practitioner' }).then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Alice',
        lastName: 'Anderson',
      }).then(() => {
        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        cy.get('[data-testid=practitioner-tab-all]').click()
        cy.get('[data-testid=practitioner-tab-all]').should('have.attr', 'aria-pressed', 'true')

        cy.clickUntil('[data-cy=new-appointment]', '[data-cy=create-patient-search]')
        cy.get('[data-cy=create-sheet]').within(() => {
          cy.get('[data-cy=create-patient-search]').type('Alice')
          cy.contains('[data-cy=create-patient-result]', 'Alice Anderson').click()
          cy.contains('[data-cy=create-type]', 'Consultation').click()

          // Nobody is chosen for the user, not even "No practitioner", and the
          // booking waits for an answer.
          cy.get('[data-cy=create-practitioner][aria-checked=true]').should('not.exist')
          cy.get('[data-cy=create-submit]').should('be.disabled').and('contain.text', 'Choose a practitioner to book')

          cy.contains('[data-cy=create-practitioner]', 'Dana Practitioner').click()
          cy.get('[data-cy=create-submit]').should('not.be.disabled').click()
        })
        cy.get('[data-cy=create-sheet]').should('not.exist')

        // Where the report came from: the visit is on the practitioner's own
        // day, not only somewhere in the clinic's.
        cy.visit('/practitioner')
        cy.contains('Alice Anderson').should('be.visible')
      })
    })
  })

  // "No practitioner" is still a choice, as long as it is made on purpose.
  it('books with no practitioner when that is picked deliberately', () => {
    cy.seedStaffAccount({ ownerName: 'Dana Practitioner' }).then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Nadia',
        lastName: 'Nobody',
      }).then(() => {
        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        cy.get('[data-testid=practitioner-tab-all]').click()

        cy.clickUntil('[data-cy=new-appointment]', '[data-cy=create-patient-search]')
        cy.get('[data-cy=create-sheet]').within(() => {
          cy.get('[data-cy=create-patient-search]').type('Nadia')
          cy.contains('[data-cy=create-patient-result]', 'Nadia Nobody').click()
          cy.contains('[data-cy=create-type]', 'Consultation').click()
          cy.contains('[data-cy=create-practitioner]', 'No practitioner').click().should('have.attr', 'aria-checked', 'true')
          cy.get('[data-cy=create-submit]').should('not.be.disabled').click()
        })
        cy.get('[data-cy=create-sheet]').should('not.exist')

        cy.get('[data-testid="practitioner-tab-unassigned"]').click()
        cy.contains('Nadia Nobody').should('be.visible')
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
