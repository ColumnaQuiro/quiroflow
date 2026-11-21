// The Settings menu regrouped (21 Nov 2026): eleven short groups instead of
// seven long ones, and three settings that were in the wrong place moved --
// the staff alerts for a booking and a lead into one Team alerts page, the
// default phone country into New Patient Fields, and the Google review link
// out of Messages into Reviews. The two that changed page changed permission
// with it (20261121193000_settings_regroup_permissions.sql).

const PASSWORD = 'Test1234!'

function staff(account: { accountId: string; clinicId: string }, patch: Record<string, unknown>) {
  const email = `regroup-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch })
  return cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Regroup Test' }).then(() => email)
}

function update(email: string, accountId: string, values: Record<string, unknown>) {
  return cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', { email, password: PASSWORD, table: 'accounts', op: 'update', values, match: { id: accountId } })
}

function accountRow(accountId: string, columns: string) {
  return cy.task<Record<string, unknown>[]>('db:selectRows', { table: 'accounts', columns, match: { id: accountId } }).its(0)
}

describe('Settings, regrouped', () => {
  it('shows the menu in its new groups', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/messages')
      cy.get('[data-cy="messages-settings"][data-ready="true"]')
      cy.get('#settings-sections p').then(($groups) => {
        expect($groups.toArray().map((g) => g.textContent?.trim())).to.deep.equal([
          'Clinic',
          'Scheduling',
          'For your patients',
          'Patient record',
          'Clinical content',
          'What you sell',
          'Payments & invoices',
          'Communication',
          'Acquisition',
          'Data & security',
          'Developers',
        ])
      })
      cy.get('#settings-sections').contains('a', 'Team alerts').should('have.attr', 'href', '/settings/team-alerts')
      cy.get('#settings-sections').contains('a', 'Reviews').should('have.attr', 'href', '/settings/reviews')
      cy.get('#settings-sections').contains('a', 'Changes & cancellations').should('have.attr', 'href', '/settings/reschedule-reasons')
      cy.get('#settings-sections').contains('a', 'Rooms').should('have.attr', 'href', '/settings/rooms')
      // Messages says where the three settings it used to hold went.
      cy.get('[data-cy="default-phone-country"]').should('not.exist')
      cy.get('[data-cy="messages-phone-country-link"]').should('have.attr', 'href', '/settings/new-patient-fields')
      cy.get('[data-cy="messages-reviews-link"]').should('have.attr', 'href', '/settings/reviews')
    })
  })

  it('saves the booking alert in Team alerts, without touching the lead one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/online-booking')
      cy.get('[data-cy="booking-team-alerts-link"]').click()
      cy.location('pathname').should('eq', '/settings/team-alerts')
      cy.get('[data-cy="team-alerts-settings"][data-ready="true"]')
      cy.get('[data-cy="booking-notify-email"]').type('reservas@example.test')
      cy.get('[data-cy="booking-notify-whatsapp"]').type('600 222 333')
      cy.get('[data-cy="team-alerts-save"]').click()
      cy.wait('@saveAccount').its('request.body').should((body) => {
        expect(body.online_booking_notify_email).to.eq('reservas@example.test')
        expect(body).not.to.have.property('new_lead_notify_email')
      })
      cy.get('[data-cy="booking-notify-whatsapp"]').should('have.value', '+34600222333')
      accountRow(account.accountId, 'online_booking_notify_email, online_booking_notify_whatsapp').should('deep.equal', {
        online_booking_notify_email: 'reservas@example.test',
        online_booking_notify_whatsapp: '+34600222333',
      })
    })
  })

  it('keeps the default phone country in New Patient Fields', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/new-patient-fields')
      cy.get('[data-cy="fields-settings"][data-ready="true"]')
      cy.get('[data-cy="fields-save"]').should('be.disabled')
      cy.get('[data-cy="default-phone-country"]').select('PT')
      cy.get('[data-cy="fields-save"]').should('not.be.disabled').click()
      cy.get('[data-cy="fields-save"]').should('be.disabled')
      accountRow(account.accountId, 'default_phone_country').its('default_phone_country').should('eq', 'PT')
    })
  })

  it('saves the Google review link in Reviews, and refuses one patients could not open', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/reviews')
      cy.get('[data-cy="reviews-settings"][data-ready="true"]')
      cy.get('[data-cy="review-url"]').type('g.page/r/clinica/review')
      cy.get('[data-cy="reviews-save"]').click()
      cy.contains('has to start with https://').should('be.visible')
      cy.get('[data-cy="review-url"]').clear().type('https://g.page/r/clinica/review')
      cy.get('[data-cy="reviews-save"]').click()
      cy.get('[data-cy="reviews-save"]').should('be.disabled')
      accountRow(account.accountId, 'google_review_url').its('google_review_url').should('eq', 'https://g.page/r/clinica/review')
    })
  })

  it('asks for the permission of the page each moved setting is on now', () => {
    cy.seedStaffAccount().then((account) => {
      staff(account, { settings_access: true, clinic_config: true, communication_config: false }).then((email) => {
        update(email, account.accountId, { default_phone_country: 'FR' }).its('changed').should('eq', 1)
        update(email, account.accountId, { online_booking_notify_email: 'x@example.test' }).its('error').should('match', /needs communication_config/)
        // The rest of Online Booking is still clinic settings.
        update(email, account.accountId, { online_booking_max_days_ahead: 45 }).its('changed').should('eq', 1)
      })
      staff(account, { settings_access: true, clinic_config: false, communication_config: true }).then((email) => {
        update(email, account.accountId, { online_booking_notify_email: 'y@example.test', online_booking_notify_whatsapp_template_name: 'aviso_reserva' }).its('changed').should('eq', 1)
        update(email, account.accountId, { google_review_url: 'https://g.page/r/x/review' }).its('changed').should('eq', 1)
        update(email, account.accountId, { default_phone_country: 'IT' }).its('error').should('match', /needs clinic_config/)

        // And the pages open for them, where the menu says they are.
        cy.login(email, PASSWORD)
        cy.visit('/settings/team-alerts')
        cy.get('[data-cy="team-alerts-settings"][data-ready="true"]')
        cy.get('[data-cy="booking-notify-email"]').should('have.value', 'y@example.test')
        cy.visit('/settings/reviews')
        cy.get('[data-cy="reviews-settings"][data-ready="true"]')
        cy.get('#settings-sections').contains('a', 'New Patient Fields').should('not.exist')
      })
    })
  })
})
