// Found in the review round after the settings redesign (#495, #497, #498).
// Each of these passed every existing spec, because none of them exercised
// the input or the figure involved.

describe('Settings review fixes', () => {
  it('saves a typed receipt number without breaking the page', () => {
    // A number input's v-model hands back a Number; the page called .trim()
    // on it, so typing a digit broke Invoicing and Save stuck on "Saving…".
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/invoicing')
      cy.get('[data-cy="invoicing-settings"][data-ready="true"]')

      cy.get('[data-cy="receipt-next"]').type('1208')
      cy.contains('Keeps counting on its own').should('not.exist')
      cy.get('[data-cy="invoice-settings-save"]').click()
      cy.wait('@saveAccount').its('request.body.next_invoice_number').should('eq', 1208)
      cy.get('[data-cy="invoice-settings-save"]').should('contain', 'Save changes')
    })
  })

  it('refuses a bono or a plan with no price, rather than saving it at 0 €', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)

      cy.visit('/settings/packages')
      cy.get('[data-cy="settings-list"][data-ready="true"]')
      cy.get('[data-cy="package-add"]').click()
      cy.get('[data-cy="package-name-input"]').type('Bono sin precio')
      cy.get('[data-cy="package-save"]').click()
      cy.get('[data-cy="package-form"]').should('contain', 'a price')
      cy.contains('[data-cy="package-card"]', 'Bono sin precio').should('not.exist')

      cy.visit('/settings/memberships')
      cy.get('[data-cy="settings-list"][data-ready="true"]')
      cy.get('[data-cy="membership-add"]').click()
      cy.get('[data-cy="membership-name-input"]').type('Plan sin precio')
      cy.get('[data-cy="membership-save"]').click()
      cy.get('[data-cy="membership-form"]').should('contain', 'a price')
      cy.contains('[data-cy="membership-row"]', 'Plan sin precio').should('not.exist')
    })
  })

  it('keeps a charged service, whoever asks to delete it', () => {
    // The page counts only receipts its user can open; the database sees them
    // all and refuses.
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createServiceProduct', { accountId: account.accountId, name: 'Radiografía', priceCents: 4500 }).then((service) => {
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rosa' }).then((patient: any) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4500, status: 'unpaid' }).then((inv: any) => {
            cy.task('db:chargeService', { accountId: account.accountId, invoiceId: inv.id, serviceId: service.id, priceCents: 4500 })
            cy.task('db:deleteServiceProduct', { serviceId: service.id }).its('code').should('eq', '23503')
          })
        })
      })
    })
  })

  it('prints the account balance the patient list shows', () => {
    // It used to take the statement's running sum, which counts a payment
    // made from credit, and the credit it came from, twice.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Berta', lastName: 'Balance' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, method: 'cash' })
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4000, status: 'unpaid' }).then((inv: any) => {
          cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
          cy.login(account.email, account.password)
          cy.visit('/settings/invoicing')
          cy.get('[data-cy="invoicing-settings"][data-ready="true"]')
          cy.get('[data-cy="receipt-show-account"]').should('have.attr', 'aria-checked', 'false').click()
          cy.get('[data-cy="invoice-settings-save"]').click()
          cy.wait('@saveAccount')

          cy.task<number>('db:liveBalance', { patientId: patient.id }).then((cents) => {
            // The extractor turns the € into an invisible character, as on
            // every amount in this PDF, so the sign is matched loosely.
            const amount = (Math.abs(cents) / 100).toFixed(2).replace('.', '\\.')
            const expected = new RegExp(`Account balance: \\D{0,2}${amount} ${cents < 0 ? 'due' : 'credit'}`)
            cy.request({ url: `/api/invoices/${inv.id}/pdf`, encoding: 'binary' })
              .then((res) => cy.task('pdf:text', { binary: res.body }))
              .then((texts) => expect((texts as string[]).join('\n')).to.match(expected))
          })
        })
      })
    })
  })
})

// Found in the review round after #500, #501 and #503.
describe('Settings review fixes, second round', () => {
  it('keeps the manual WhatsApp setup open while its account ID is typed', () => {
    // It was bound to the account ID itself, so the first character folded
    // the section shut around the field being typed in.
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-cy="whatsapp-settings"][data-ready="true"]')
      cy.get('[data-cy="whatsapp-manual"]').should('have.attr', 'open')
      cy.get('#wa-waba').type('123456789012345')
      cy.get('[data-cy="whatsapp-manual"]').should('have.attr', 'open')
      cy.get('#wa-waba').should('have.value', '123456789012345')
      cy.get('#wa-token').should('be.visible')
    })
  })

  it('stays on a saved reply whose save failed, with the edit still there', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/saved-replies')
      cy.get('[data-cy="replies-settings"][data-ready="true"]')
      cy.get('[data-cy="reply-new"]').click()
      cy.get('[data-cy="reply-title"]').clear().type('Horario')
      cy.get('[data-cy="reply-save"]').click()
      cy.contains('[data-cy="reply-row"]', 'Horario')
      cy.get('[data-cy="reply-new"]').click()
      cy.get('[data-cy="reply-title"]').clear().type('Parking')
      cy.get('[data-cy="reply-save"]').click()
      cy.contains('[data-cy="reply-row"]', 'Parking')

      cy.intercept('PATCH', '**/rest/v1/saved_replies*', { statusCode: 500, body: { message: 'Network down' } }).as('failSave')
      cy.get('[data-cy="reply-body"]').type('Hay un parking enfrente.')
      cy.contains('[data-cy="reply-row"]', 'Horario').click()
      cy.wait('@failSave')
      cy.get('[data-cy="reply-title"]').should('have.value', 'Parking')
      cy.get('[data-cy="reply-body"]').should('have.value', 'Hay un parking enfrente.')
      cy.get('[data-cy="reply-editor"]').should('contain', 'Unsaved changes')
    })
  })

  it('previews each paragraph of the email on its own line', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/messages')
      cy.get('[data-cy="messages-settings"][data-ready="true"]')
      cy.get('[data-cy="messages-confirmation"]').within(() => {
        cy.get('[data-cy="channel-email"]').then(($b) => {
          if ($b.attr('aria-pressed') !== 'true') cy.wrap($b).click()
        })
        cy.get('[contenteditable="true"]').first().clear().type('Hola{enter}Tu cita es mañana')
        cy.get('[data-cy="email-preview"] .whitespace-pre-line').should(($el) => {
          expect($el[0].innerText).to.eq('Hola\nTu cita es mañana')
        })
      })
    })
  })

  it('saves a cleared number box as the default rather than failing', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)

      cy.visit('/settings/messages')
      cy.get('[data-cy="messages-settings"][data-ready="true"]')
      cy.get('[data-cy="messages-reminder"] [data-cy="messages-enabled"]').then(($s) => {
        if ($s.attr('aria-checked') !== 'true') cy.wrap($s).click()
      })
      cy.get('[data-cy="reminder-hours"]').clear()
      cy.get('[data-cy="messages-save"]').click()
      cy.wait('@saveAccount').its('response.statusCode').should('be.lessThan', 300)
      cy.get('@saveAccount').its('request.body.appointment_reminder_hours_before').should('eq', 24)

      cy.visit('/settings/online-booking')
      cy.get('[data-cy="booking-settings"][data-ready="true"]')
      cy.get('[data-cy="booking-max-days"]').clear()
      cy.get('[data-cy="booking-save"]').click()
      cy.wait('@saveAccount').its('response.statusCode').should('be.lessThan', 300)
      cy.get('@saveAccount').its('request.body.online_booking_max_days_ahead').should('eq', 90)
    })
  })

  it('gates Messages and Saved Replies on communication settings, like the menu does', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { settings_access: true, communication_config: false } })
      const email = `nocomms-${Date.now()}@example.test`
      const password = 'Test1234!'
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password, fullName: 'Sin Comunicación' }).then(() => {
        cy.login(email, password)
        for (const path of ['/settings/messages', '/settings/saved-replies']) {
          cy.visit(path)
          cy.location('pathname', { timeout: 20000 }).should('eq', '/dashboard')
        }
      })
    })
  })
})
