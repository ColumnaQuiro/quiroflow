// Found in the settings QA round (30 Sep 2026). Each of these passed every
// existing spec, because none of them exercised the input or the state
// involved.

describe('Settings QA: page fixes', () => {
  it('keeps a discount code working all through the day it expires, and asks before deleting it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/online-booking')
      cy.get('[data-cy="booking-settings"][data-ready="true"]')
      cy.get('input[placeholder="BIENVENIDA"]').scrollIntoView().type('OTONO')
      cy.get('input[type="date"]').type('2026-10-31')
      cy.contains('button', /^(Add|Añadir)/).click()
      // Stored as the start of 1 November in Madrid (CET, +01:00), not UTC
      // midnight on the 31st, which stopped it at 01:00 that morning.
      cy.task<{ expires_at: string }[]>('db:selectRows', { table: 'online_booking_discount_codes', columns: 'expires_at', match: { account_id: account.accountId, code: 'OTONO' } }).then((rows) => {
        expect(new Date(rows[0]!.expires_at).toISOString()).to.eq('2026-10-31T23:00:00.000Z')
      })
      cy.contains('expires 31/10/2026').should('exist')

      cy.get('[data-cy="code-delete"]').click()
      cy.get('[data-cy="confirm-dialog"]').should('contain', 'OTONO').contains('button', 'Cancel').click()
      cy.contains('OTONO').should('exist')
      cy.get('[data-cy="code-delete"]').click()
      cy.get('[data-cy="confirm-dialog"]').contains('button', 'Delete code').click()
      cy.contains('OTONO').should('not.exist')
    })
  })

  it('reads a lead value the Spanish way: 1.500 is fifteen hundred', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/leads')
      cy.get('[data-cy="leads-settings"][data-ready="true"]')
      cy.get('[data-test="default-lead-value"]').clear().type('1.500')
      cy.get('[data-test="save-lead-settings"]').click()
      cy.task<{ lead_default_value_cents: number }[]>('db:selectRows', { table: 'accounts', columns: 'lead_default_value_cents', match: { id: account.accountId } })
        .its('0.lead_default_value_cents')
        .should('eq', 150000)
      cy.reload()
      cy.get('[data-test="default-lead-value"]').should('have.value', '1500,00')
    })
  })

  it('refuses a cleared notice box on Mobile App, and confirms an announcement in the app', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.intercept('POST', '/api/patient-push/send').as('send')
      cy.login(account.email, account.password)
      cy.visit('/settings/app')
      // The notice only applies while patients may cancel or move a visit.
      cy.get('[data-cy="app-cancel"] [role="switch"], [data-cy="app-cancel"][role="switch"]').first().then(($s) => {
        if ($s.attr('aria-checked') !== 'true') cy.wrap($s).click()
      })
      cy.get('#notice-hours').scrollIntoView().clear()
      cy.get('[data-cy="app-save"]').click()
      cy.contains('whole number of hours').should('be.visible')
      cy.get('@saveAccount.all').should('have.length', 0)

      cy.get('input[maxlength="64"]').scrollIntoView().type('Cerrado el viernes')
      cy.get('textarea[maxlength="300"]').type('Por festivo local.')
      cy.contains('button', /^Send to/).click()
      cy.get('[data-cy="confirm-dialog"]').should('contain', 'Cerrado el viernes').contains('button', 'Cancel').click()
      cy.get('@send.all').should('have.length', 0)
    })
  })

  it('adds a payment method called Credit without colliding with the hidden credit one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/payments')
      cy.get('[data-cy="payments-settings"][data-ready="true"]')
      cy.get('form input').last().type('Credit')
      cy.get('form').last().submit()
      cy.contains('[data-cy="method-name"]', 'Credit').should('exist')
      cy.contains('duplicate key').should('not.exist')
    })
  })

  it('asks before the Docs editor drops unsaved edits', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createDocTemplate', { accountId: account.accountId, title: 'Consentimiento', category: 'consent' })
      cy.login(account.email, account.password)
      cy.visit('/settings/docs')
      cy.contains('[data-cy="doc-title"]', 'Consentimiento').click()
      cy.get('[data-cy="doc-editor"] input[type="text"]').first().clear().type('Consentimiento informado')
      cy.contains('[data-cy="doc-editor"] button', 'Templates').click()
      cy.get('[data-cy="confirm-dialog"]').contains('button', 'Keep editing').click()
      cy.get('[data-cy="doc-editor"] input[type="text"]').first().should('have.value', 'Consentimiento informado')
      cy.contains('[data-cy="doc-editor"] button', 'Templates').click()
      cy.get('[data-cy="confirm-dialog"]').contains('button', 'Leave without saving').click()
      cy.contains('[data-cy="doc-title"]', 'Consentimiento').should('have.text', 'Consentimiento')
    })
  })

  it('offers a clinic to a practitioner whose only clinic was archived', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createClinic', { accountId: account.accountId, name: 'Sede Centro' }).then((centro) => {
        cy.task('db:setExtraProfessionals', { accountId: account.accountId, extraProfessionals: 3 })
        cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
          accountId: account.accountId,
          clinicId: centro.id,
          roleName: 'Practitioner',
          email: `stranded-${Date.now()}@example.test`,
          password: 'Test1234!',
          fullName: 'Paula Centro',
          isPractitioner: true,
        }).then((m) => {
          cy.task('db:archiveClinic', { clinicId: centro.id })
          cy.login(account.email, account.password)
          cy.visit(`/settings/team/${m.teamMemberId}`)
          cy.get('[data-cy="member-clinic"]').should('have.length', 1)
          cy.contains('Pick at least one clinic.').scrollIntoView().should('be.visible')
        })
      })
    })
  })
})
