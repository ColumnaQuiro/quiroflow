import type { StaffAccount } from '../../support/commands'

// Settings -> Clinics -> <clinic>: one page per location, one save for all of
// it, and a way to close a location that keeps its history
// (20260924164000_clinic_contact_and_archive). Every value is checked in the
// database, not only on screen.

function daysFromNow(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

function openClinic(clinicId: string) {
  cy.visit(`/settings/clinics/${clinicId}`)
  cy.get('[data-cy=clinic-page]').should('have.attr', 'data-ready', 'true')
}

function day(key: string) {
  return cy.get(`[data-cy=hours-day][data-day="${key}"]`)
}

function withPatient(account: StaffAccount) {
  return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Clara', lastName: 'Sede' })
}

describe('A clinic\'s settings page', () => {
  it('edits everything about a location in one save, and online booking reads the same hours', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/clinics')
      cy.get('[data-cy=clinics-page]').should('have.attr', 'data-ready', 'true')
      cy.get(`[data-cy=clinic-card][data-clinic-id="${account.clinicId}"]`).should('contain.text', 'No tax ID').and('contain.text', 'No opening hours set').click()
      cy.get('[data-cy=clinic-page]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=clinic-save-bar]').should('not.exist')
      cy.get('[data-cy=hours-not-set]').should('contain.text', 'marks no time as closed')

      cy.get('[data-cy=clinic-name]').clear().type('Clínica Centro')
      cy.get('[data-cy=clinic-save-bar]').should('be.visible')
      cy.get('[data-cy=clinic-address]').clear().type('Calle de Colón 14{enter}46004 Valencia')
      cy.get('[data-cy=clinic-phone]').type('963 12 34 56')
      cy.get('[data-cy=clinic-email]').type('centro@')
      cy.contains('That does not look like an email address.').should('be.visible')
      cy.get('[data-cy=clinic-email]').type('columnaquiro.com')
      cy.contains('That does not look like an email address.').should('not.exist')

      // Monday: morning and afternoon. Saturday: a range typed backwards.
      day('mon').find('[data-cy=hours-day-toggle]').then(($t) => {
        if ($t.attr('aria-checked') !== 'true') cy.wrap($t).click()
      })
      cy.get('[data-cy=hours-not-set]').should('not.exist')
      day('mon').find('[data-cy=hours-range]').first().find('input[type=time]').eq(0).clear().type('09:00')
      day('mon').find('[data-cy=hours-range]').first().find('input[type=time]').eq(1).clear().type('14:00')
      day('mon').find('[data-cy=hours-add-range]').click()
      day('mon').find('[data-cy=hours-range]').eq(1).find('input[type=time]').eq(1).clear().type('20:00')
      cy.get('[data-cy=hours-copy-monday]').click()
      day('fri').find('[data-cy=hours-range]').should('have.length', 2)
      day('sun').find('[data-cy=hours-day-toggle]').then(($t) => {
        if ($t.attr('aria-checked') === 'true') cy.wrap($t).click()
      })
      day('sat').find('[data-cy=hours-day-toggle]').then(($t) => {
        if ($t.attr('aria-checked') !== 'true') cy.wrap($t).click()
      })
      day('sat').find('input[type=time]').eq(0).clear().type('13:00')
      day('sat').find('input[type=time]').eq(1).clear().type('10:00')
      day('sat').find('[data-cy=hours-problem]').should('contain.text', 'A range ends before it starts.')

      // Nothing saves while a day is wrong.
      cy.get('[data-cy=clinic-save]').click()
      cy.contains('Some fields need fixing').should('be.visible')
      cy.task<{ name: string }>('db:clinicRow', { clinicId: account.clinicId }).its('name').should('equal', 'Main Location')

      day('sat').find('input[type=time]').eq(0).clear().type('10:00')
      day('sat').find('input[type=time]').eq(1).clear().type('13:00')
      day('sat').find('[data-cy=hours-problem]').should('not.exist')

      cy.get('[data-cy=tz-picker-button]').click()
      cy.get('[data-cy=tz-picker-search]').type('canar')
      cy.get('[data-cy=tz-option][data-zone="Atlantic/Canary"]').click()
      cy.get('[data-cy=tz-picker-button]').should('contain.text', 'Canarias')
      cy.get('[data-cy=clinic-slot][data-minutes="30"]').click()
      cy.get('[data-cy=clinic-legal-name]').type('Columna Quiro Valencia S.L.')
      cy.get('[data-cy=clinic-tax-id]').type('B12345678')
      cy.get('[data-cy=clinic-fiscal-incomplete]').should('not.exist')

      cy.get('[data-cy=clinic-save]').click()
      cy.get('[data-cy=clinic-save-bar]').should('not.exist')
      cy.task<any>('db:clinicRow', { clinicId: account.clinicId }).then((row) => {
        expect(row.name).to.equal('Clínica Centro')
        expect(row.address).to.equal('Calle de Colón 14\n46004 Valencia')
        expect(row.phone).to.equal('963 12 34 56')
        expect(row.email).to.equal('centro@columnaquiro.com')
        expect(row.timezone).to.equal('Atlantic/Canary')
        expect(row.slot_duration_minutes).to.equal(30)
        expect(row.legal_name).to.equal('Columna Quiro Valencia S.L.')
        expect(row.tax_id).to.equal('B12345678')
        // Same stored shape the calendar and the booking page read: every
        // day present, a closed day an empty list.
        expect(row.business_hours).to.deep.equal({
          mon: [['09:00', '14:00'], ['14:00', '20:00']],
          tue: [['09:00', '14:00'], ['14:00', '20:00']],
          wed: [['09:00', '14:00'], ['14:00', '20:00']],
          thu: [['09:00', '14:00'], ['14:00', '20:00']],
          fri: [['09:00', '14:00'], ['14:00', '20:00']],
          sat: [['10:00', '13:00']],
          sun: [],
        })
      })

      // Online booking shows those hours and sends you here to change them.
      cy.visit('/settings/online-booking')
      cy.clickUntil('main button:contains("Clinics & Hours")', '[data-cy=booking-clinic]')
      cy.get(`[data-cy=booking-clinic][data-clinic-id="${account.clinicId}"]`).within(() => {
        cy.get('[data-cy=booking-clinic-hours]').should('contain.text', '9:00–14:00 and 14:00–20:00').and('contain.text', '10:00–13:00')
        cy.get('[data-cy=booking-clinic-edit-hours]').click()
      })
      cy.location('pathname').should('eq', `/settings/clinics/${account.clinicId}`)
    })
  })

  it('says whose hours these are, since a practitioner\'s own hours win', () => {
    cy.seedStaffAccount().then((account) => {
      const stamp = Date.now()
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', isPractitioner: true,
        email: `own-${stamp}@example.test`, password: 'Test1234!', fullName: 'Olga Propio',
      }).then((olga) => {
        cy.task('db:setTeamMemberHours', { teamMemberId: olga.teamMemberId, hours: { mon: [['15:00', '20:00']] } })
      })
      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', isPractitioner: true,
        email: `none-${stamp}@example.test`, password: 'Test1234!', fullName: 'Nico Sede',
      })
      cy.login(account.email, account.password)
      openClinic(account.clinicId)
      cy.get('[data-cy=clinic-own-hours]')
        .should('contain.text', 'have their own hours')
        .and('contain.text', 'these hours neither shorten nor extend them')
        .and('contain.text', 'Nico Sede')
        .and('not.contain.text', 'Using these: Olga')
    })
  })

  it('asks before leaving with unsaved changes', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      openClinic(account.clinicId)
      cy.get('[data-cy=clinic-phone]').type('600 123 456')
      cy.get('[data-cy=clinic-back]').click()
      cy.get('[data-cy=confirm-dialog]').should('contain.text', 'Leave without saving?')
      cy.get('[data-cy=confirm-dialog-cancel]').click()
      cy.location('pathname').should('eq', `/settings/clinics/${account.clinicId}`)
      cy.get('[data-cy=clinic-phone]').should('have.value', '600 123 456')

      cy.get('[data-cy=clinic-discard]').click()
      cy.get('[data-cy=clinic-phone]').should('have.value', '')
      cy.get('[data-cy=clinic-back]').click()
      cy.location('pathname').should('eq', '/settings/clinics')
    })
  })

  it('archives a location only once nothing is booked ahead, keeps its history, and brings it back', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Sede Norte' }).then((north) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: north.id, firstName: 'Nora', lastName: 'Norte' }).then((p) => {
          cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: north.id, patientId: p.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(-20), status: 'completed' })
          cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: north.id, patientId: p.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(3) }).then((ahead) => {
            cy.login(account.email, account.password)
            openClinic(north.id)

            cy.get('[data-cy=clinic-archive]').click()
            cy.get('[data-cy=clinic-archive-upcoming]').should('contain.text', 'It has 1 appointments from today on.')
            cy.get('[data-cy=confirm-dialog-confirm]').should('be.disabled')
            cy.get('[data-cy=confirm-dialog-cancel]').click()

            // Once the one ahead is cancelled, it can go.
            cy.task('db:setAppointmentStatus', { appointmentId: ahead.id, status: 'cancelled' })
            openClinic(north.id)
            cy.get('[data-cy=clinic-archive]').click()
            cy.get('[data-cy=clinic-archive-upcoming]').should('not.exist')
            cy.get('[data-cy=confirm-dialog-confirm]').click()

            cy.location('pathname').should('eq', '/settings/clinics')
            cy.get(`[data-cy=clinic-card][data-clinic-id="${north.id}"]`).should('not.exist')
            cy.get(`[data-cy=clinic-archived-row][data-clinic-id="${north.id}"]`).should('contain.text', '2 appointments and 1 patients kept')
            cy.task<any>('db:clinicRow', { clinicId: north.id }).then((row) => {
              expect(row.archived_at).to.not.equal(null)
              expect(row.online_booking_enabled).to.equal(false)
            })

            // Out of the clinic switcher: one clinic left, so it is not a menu.
            cy.get('[data-cy=clinic-switcher]').should('not.have.attr', 'aria-haspopup')

            cy.get(`[data-cy=clinic-archived-row][data-clinic-id="${north.id}"]`).find('[data-cy=clinic-reactivate]').click()
            cy.get(`[data-cy=clinic-card][data-clinic-id="${north.id}"]`).should('exist')
            cy.task<any>('db:clinicRow', { clinicId: north.id }).then((row) => expect(row.archived_at).to.equal(null))
            cy.get('[data-cy=clinic-switcher]').should('have.attr', 'aria-haspopup', 'menu')
          })
        })
      })
    })
  })

  it('deletes only a location with no appointments, by typing its name', () => {
    cy.seedStaffAccount().then((account) => {
      withPatient(account).then((p) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(-5), status: 'completed' })
      })
      cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Valencia prueba' }).then((spare) => {
        cy.login(account.email, account.password)

        // The main clinic has a diary: deleting it is not on offer at all.
        openClinic(account.clinicId)
        cy.get('[data-cy=clinic-delete]').should('be.disabled')
        cy.get('[data-cy=clinic-delete-unavailable]').should('contain.text', 'has 1 appointments')

        openClinic(spare.id)
        cy.get('[data-cy=clinic-delete]').should('not.be.disabled').click()
        cy.get('[data-cy=confirm-dialog-confirm]').should('be.disabled')
        cy.get('[data-cy=confirm-dialog-word]').type('Valencia prueba')
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.location('pathname').should('eq', '/settings/clinics')
        cy.task('db:clinicRow', { clinicId: spare.id }).then((row) => expect(row).to.equal(null))
        cy.task<any>('db:clinicRow', { clinicId: account.clinicId }).should('not.equal', null)
      })
    })
  })
})
