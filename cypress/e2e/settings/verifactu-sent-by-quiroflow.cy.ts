// Settings > VeriFactu > Who sends: a clinic can let QuiroFlow send its
// records with the platform's certificate, under an apoderamiento (IZ860)
// or a signed colaboración social document. Nothing goes with QuiroFlow's
// certificate until QuiroFlow confirms the authorisation; the platform
// account's owners are the ones who do.
describe('VeriFactu sent by QuiroFlow', () => {
  afterEach(() => {
    cy.task('db:setVerifactuPlatform', { accountId: null })
  })

  // The review list shows every clinic that ever asked, so each test's clinic
  // has a name of its own to be found by.
  function withPlatformAndClinic(fn: (platform: any, clinic: any, clinicName: string) => void) {
    const clinicName = `Clinica Delegada ${Date.now()} SL`
    cy.seedStaffAccount().then((platform) => {
      cy.task('db:setClinicFiscal', { clinicId: platform.clinicId, taxId: 'B16365504', legalName: 'Plataforma Prueba SL' })
      cy.task('db:setVerifactuPlatform', { accountId: platform.accountId })
      cy.seedStaffAccount().then((clinic) => {
        cy.task('db:setClinicFiscal', { clinicId: clinic.clinicId, taxId: 'B12345678', legalName: clinicName })
        cy.task('db:setVerifactuMode', { accountId: clinic.accountId, mode: 'test' })
        fn(platform, clinic, clinicName)
      })
    })
  }

  it('asks QuiroFlow via an IZ860 apoderamiento, and sends once QuiroFlow confirms it', () => {
    withPlatformAndClinic((platform, clinic, clinicName) => {
      cy.intercept('PUT', '/api/verifactu/sender').as('sender')
      cy.login(clinic.email, clinic.password)
      cy.visit('/settings/verifactu')

      cy.get('[data-cy="verifactu-sender-own"]').should('be.checked')
      cy.get('[data-cy="verifactu-sender-apoderamiento"]').check()
      cy.get('[data-cy="verifactu-sender-save"]').click()
      cy.wait('@sender').its('response.statusCode').should('eq', 200)

      // The steps name who to authorise, as the AEAT knows them.
      cy.get('[data-cy="verifactu-apoderamiento-steps"]').should('contain', 'IZ860')
      cy.get('[data-cy="verifactu-platform-identity"]').should('contain', 'B16365504').and('contain', 'Plataforma Prueba SL')
      cy.get('[data-cy="verifactu-delegation-status"]').should('contain', 'Waiting')
      cy.get('[data-cy="verifactu-not-sending"]').should('contain', 'not confirmed')
      // No certificate of its own is asked for.
      cy.get('[data-cy="verifactu-certificate"]').should('not.exist')
      cy.get('[data-cy="verifactu-certificate-by-quiroflow"]').should('be.visible')

      // QuiroFlow's side.
      cy.intercept('GET', '/api/verifactu/delegations').as('delegations')
      cy.login(platform.email, platform.password)
      cy.visit('/settings/verifactu')
      cy.wait('@delegations')
      cy.get('[data-cy="verifactu-sender"]').should('not.exist')
      cy.contains('[data-cy="verifactu-delegation-row"]', clinicName).within(() => {
        cy.get('[data-cy="verifactu-delegation-accept"]').click()
        cy.get('[data-cy="verifactu-delegation-withdraw"]').should('be.visible')
      })
      cy.task<{ accepted_at: string | null }>('db:verifactuDelegationOf', { accountId: clinic.accountId }).its('accepted_at').should('not.eq', null)

      cy.login(clinic.email, clinic.password)
      cy.visit('/settings/verifactu')
      cy.get('[data-cy="verifactu-delegation-status"]').should('contain', 'Authorised')
      cy.get('[data-cy="verifactu-not-sending"]').should('not.exist')
    })
  })

  it('takes the signed document as a PDF, and does not let it be confirmed without one', () => {
    withPlatformAndClinic((platform, clinic, clinicName) => {
      cy.login(clinic.email, clinic.password)
      cy.visit('/settings/verifactu')
      cy.intercept('PUT', '/api/verifactu/sender').as('sender')
      cy.get('[data-cy="verifactu-sender-colaboracion"]').check()
      cy.get('[data-cy="verifactu-sender-save"]').click()
      cy.wait('@sender').its('response.statusCode').should('eq', 200)
      cy.get('[data-cy="verifactu-colaboracion-steps"]').should('contain', 'BOE-A-2024-27600')

      // Nothing to confirm yet: QuiroFlow cannot accept an unsigned request.
      cy.intercept('GET', '/api/verifactu/delegations').as('delegations')
      cy.login(platform.email, platform.password)
      cy.visit('/settings/verifactu')
      cy.wait('@delegations')
      cy.contains('[data-cy="verifactu-delegation-row"]', clinicName).find('[data-cy="verifactu-delegation-accept"]').should('be.disabled')
      cy.request({ method: 'PUT', url: `/api/verifactu/delegations/${clinic.accountId}`, body: { accepted: true }, failOnStatusCode: false }).its('status').should('eq', 409)

      cy.login(clinic.email, clinic.password)
      cy.visit('/settings/verifactu')
      // A photo renamed .pdf is not a document.
      cy.intercept('POST', '/api/verifactu/delegation-document').as('upload')
      cy.get('[data-cy="verifactu-signed-document-file"]').selectFile({ contents: Cypress.Buffer.from('not a pdf'), fileName: 'firma.pdf', mimeType: 'application/pdf' })
      cy.get('[data-cy="verifactu-signed-document-upload"]').click()
      cy.wait('@upload').its('response.statusCode').should('eq', 400)
      cy.get('[data-cy="verifactu-signed-document"]').should('not.exist')

      cy.get('[data-cy="verifactu-signed-document-file"]').selectFile({ contents: Cypress.Buffer.from('%PDF-1.4\n%firmado\n'), fileName: 'representacion.pdf', mimeType: 'application/pdf' })
      cy.get('[data-cy="verifactu-signed-document-upload"]').click()
      cy.wait('@upload').its('response.statusCode').should('eq', 200)
      cy.get('[data-cy="verifactu-signed-document"]').should('contain', 'representacion.pdf')

      cy.login(platform.email, platform.password)
      cy.visit('/settings/verifactu')
      cy.wait('@delegations')
      cy.contains('[data-cy="verifactu-delegation-row"]', clinicName).find('[data-cy="verifactu-delegation-accept"]').should('not.be.disabled')
    })
  })

  it('is not offered where there is no platform, and the review list is QuiroFlow’s alone', () => {
    cy.seedStaffAccount().then((clinic) => {
      cy.login(clinic.email, clinic.password)
      cy.visit('/settings/verifactu')
      cy.get('[data-cy="verifactu-certificate"]').should('be.visible')
      cy.get('[data-cy="verifactu-sender"]').should('not.exist')
      cy.request({ url: '/api/verifactu/delegations', failOnStatusCode: false }).its('status').should('eq', 403)
      cy.request({ method: 'PUT', url: '/api/verifactu/sender', body: { sender: 'apoderamiento' }, failOnStatusCode: false }).its('status').should('eq', 409)
    })
  })
})
