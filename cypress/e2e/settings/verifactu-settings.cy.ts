// Settings > VeriFactu: each clinic decides for itself whether its records go
// to the AEAT, and to which service. It used to be one environment variable
// for every clinic on the platform.
describe('VeriFactu settings', () => {
  it('lets an owner choose test or live, and says why nothing is being sent', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PUT', '/api/verifactu/settings').as('save')
      cy.login(account.email, account.password)
      cy.visit('/settings/verifactu')

      // Off by default for a new clinic.
      cy.get('[data-cy="verifactu-mode-off"]').should('be.checked')
      cy.get('[data-cy="verifactu-not-sending"]').should('not.exist')

      cy.get('[data-cy="verifactu-mode-test"]').check()
      cy.get('[data-cy="verifactu-save"]').click()
      cy.wait('@save').its('response.statusCode').should('eq', 200)
      cy.reload()
      cy.get('[data-cy="verifactu-mode-test"]').should('be.checked')
      // On, but with no certificate: said in words rather than looking fine.
      cy.get('[data-cy="verifactu-not-sending"]').should('be.visible')

      // Live needs a day; the confirm is accepted by Cypress. No .clear():
      // typing YYYY-MM-DD into a native date input replaces the value, and
      // clearing one behaves differently across browsers.
      cy.get('[data-cy="verifactu-mode-live"]').check()
      cy.get('[data-cy="verifactu-live-date"]').type('2027-01-01')
      cy.get('[data-cy="verifactu-save"]').click()
      cy.wait('@save').its('response.statusCode').should('eq', 200)
      cy.task<{ verifactu_mode: string; verifactu_production_from: string }>('db:verifactuSettingsOf', { accountId: account.accountId }).then((row) => {
        expect(row.verifactu_mode).to.eq('live')
        // Midnight in Madrid, which is 23:00 UTC the day before.
        expect(new Date(row.verifactu_production_from).toISOString()).to.eq('2026-12-31T23:00:00.000Z')
      })
    })
  })

  it('fixes the date and keeps VeriFactu on once the real chain has started', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ environment: string; previous_huella: string | null }>('db:startProductionChain', { accountId: account.accountId, clinicId: account.clinicId }).then((record) => {
        // The first production record starts its own chain.
        expect(record.environment).to.eq('production')
        expect(record.previous_huella).to.eq(null)
      })

      cy.login(account.email, account.password)
      cy.visit('/settings/verifactu')
      cy.get('[data-cy="verifactu-locked"]').should('be.visible')
      cy.get('[data-cy="verifactu-mode-off"]').should('be.disabled')
      cy.get('[data-cy="verifactu-save"]').should('not.exist')

      // And the database says no whatever the path: the API refuses too.
      cy.request({ method: 'PUT', url: '/api/verifactu/settings', body: { mode: 'off' }, failOnStatusCode: false }).its('status').should('eq', 409)
    })
  })

  it('is for owners only, even to someone whose role grants everything', () => {
    // The Owner ROLE carries every permission; being the account's owner is
    // something else. Whose certificate signs for the company is the latter.
    cy.seedStaffAccount().then((account) => {
      const email = `owner-role-${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Owner', email, password: 'Test1234!' })
      cy.login(email, 'Test1234!')
      cy.visit('/settings/verifactu')
      cy.location('pathname').should('eq', '/dashboard')
      cy.request({ url: '/api/verifactu/settings', failOnStatusCode: false }).its('status').should('eq', 403)
    })
  })

  describe('the certificate', () => {
    function upload(nif: string) {
      cy.task<string>('cert:makeTestCertificate', { nif, password: 'prueba-1234' }).then((b64) => {
        cy.get('[data-cy="verifactu-cert-file"]').selectFile({ contents: Cypress.Buffer.from(b64, 'base64'), fileName: 'certificado.p12' })
      })
      cy.get('[data-cy="verifactu-cert-password"]').type('prueba-1234')
      cy.get('[data-cy="verifactu-cert-upload"]').click()
      cy.wait('@upload').its('response.statusCode').should('eq', 200)
    }

    it('says it is valid, and what each check found', () => {
      cy.seedStaffAccount().then((account) => {
        cy.task('db:setClinicFiscal', { clinicId: account.clinicId, taxId: 'B12345678', legalName: 'Clinica Prueba SL' })
        cy.intercept('POST', '/api/verifactu/certificate').as('upload')
        cy.login(account.email, account.password)
        cy.visit('/settings/verifactu')
        upload('B12345678')

        cy.get('[data-cy="verifactu-cert-status"]').should('contain.text', 'Valid')
        cy.get('[data-cy="verifactu-cert-checks"]')
          .should('contain.text', 'Issued for this company (B12345678)')
          .and('contain.text', 'In date')
          .and('contain.text', 'The stored password opens it')
        cy.get('[data-cy="verifactu-cert-aeat"]').should('contain.text', 'Nothing has been sent with it yet')
      })
    })

    it('flags a certificate that belongs to another company', () => {
      cy.seedStaffAccount().then((account) => {
        cy.task('db:setClinicFiscal', { clinicId: account.clinicId, taxId: 'B12345678', legalName: 'Clinica Prueba SL' })
        cy.intercept('POST', '/api/verifactu/certificate').as('upload')
        cy.login(account.email, account.password)
        cy.visit('/settings/verifactu')
        upload('B87654321')

        cy.get('[data-cy="verifactu-cert-status"]').should('contain.text', 'Needs attention')
        cy.get('[data-cy="verifactu-cert-checks"]').should('contain.text', 'It is not for this company (B12345678)')
      })
    })
  })
})
