// Settings > Online Booking (one page instead of five tabs) and Settings >
// WhatsApp (one table for the five message templates).

describe('Online Booking settings', () => {
  it('saves the practitioner heading under the key the booking page reads', () => {
    // The page used to save it as 'choose_practitioner', which the booking
    // page never looked up. One saved that way is carried across.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setBookingTextOverrides', { accountId: account.accountId, overrides: { choose_practitioner: 'Elige fisio' } })
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/online-booking')
      cy.get('[data-cy="booking-settings"][data-ready="true"]')

      cy.get('[data-text-key="select_heading"] input').should('have.value', 'Elige fisio')
      // The three the page could not change before.
      cy.get('[data-text-key="any_practitioner_label"] input').clear().type('Primera cita libre')
      cy.get('[data-text-key="app_promo_heading"]').should('exist')
      cy.get('[data-cy="booking-save"]').click()
      cy.wait('@saveAccount')

      cy.task<{ online_booking_text_overrides: Record<string, string> }>('db:bookingAndWhatsappSettingsOf', { accountId: account.accountId }).then((row) => {
        expect(row.online_booking_text_overrides).to.deep.eq({ select_heading: 'Elige fisio', any_practitioner_label: 'Primera cita libre' })
      })
    })
  })

  it('keeps the practitioner order, and no longer asks for a referral URL nothing used', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/online-booking')
      cy.get('[data-cy="booking-settings"][data-ready="true"]')

      cy.contains('Patient referral URL').should('not.exist')
      cy.get('[data-cy="booking-status"]').should('contain', 'clinics')
      cy.get('[data-cy="booking-order-alphabetical"]').click().should('have.attr', 'aria-checked', 'true')
      cy.get('[data-cy="booking-save"]').click()
      cy.wait('@saveAccount').its('request.body').should('not.have.property', 'online_booking_referral_url')
      cy.task<{ online_booking_practitioner_order: string }>('db:bookingAndWhatsappSettingsOf', { accountId: account.accountId }).its('online_booking_practitioner_order').should('eq', 'alphabetical')
    })
  })
})

describe('WhatsApp settings', () => {
  afterEach(() => cy.task('db:stopMetaGraphStub'))

  it('picks each message’s template from Meta’s list, the new-lead alert included', () => {
    // The old page had a "Use for …" button per message on each template,
    // and none at all for the new-lead alert.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:startMetaGraphStub', {})
      cy.task('db:setWhatsappBusinessAccount', { accountId: account.accountId, businessAccountId: '232335383285622' })
      cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'EAAT-stub-token' })
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-cy="whatsapp-settings"][data-ready="true"]')
      cy.get('[data-cy="whatsapp-templates-count"]').should('contain', '0 of 5')

      cy.get('[data-template-use="staff-lead"] [data-cy="whatsapp-template-select"] option').contains('recordatorio_cita').then((option) => {
        cy.get('[data-template-use="staff-lead"] [data-cy="whatsapp-template-select"]').select(String(option.val()))
      })
      cy.get('[data-cy="whatsapp-templates-count"]').should('contain', '1 of 5')
      cy.get('[data-cy="whatsapp-save"]').click()
      cy.wait('@saveAccount')
      cy.task<{ new_lead_notify_whatsapp_template_name: string }>('db:bookingAndWhatsappSettingsOf', { accountId: account.accountId })
        .its('new_lead_notify_whatsapp_template_name')
        .should('eq', 'recordatorio_cita')
    })
  })

  it('lets a template be typed by hand when Meta’s list is not available', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-cy="whatsapp-settings"][data-ready="true"]')

      cy.get('[data-template-use="reminder"] [data-cy="whatsapp-template-name"]').type('recordatorio_manual')
      cy.get('[data-cy="whatsapp-save"]').click()
      cy.wait('@saveAccount').its('request.body.whatsapp_reminder_template_name').should('eq', 'recordatorio_manual')
    })
  })
})
