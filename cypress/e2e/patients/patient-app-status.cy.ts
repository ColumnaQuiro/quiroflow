// Whether a patient has the app, on their record. The front desk's question
// is "do they have it, or do I send them the link?", and the only answer used
// to be a device count in Settings > App: app_opens knew the clinic of each
// device but not whose it was. record_app_open now keeps the signed-in user,
// with no new argument, so the app needs no release for it to fill.

describe('Patient app status on the record', () => {
  it('offers an invite to a patient with no login, in their language', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sinapp', lastName: 'Prueba' }).then((p) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${p.id}`, {
          onBeforeLoad(win) {
            cy.stub(win.navigator.clipboard, 'writeText').as('copy').resolves()
          },
        })
        cy.get('[data-cy=patient-app-status]', { timeout: 15000 }).should('have.attr', 'data-state', 'none')
        cy.get('[data-cy=patient-app-invite]').click()
        cy.get('@copy').should('have.been.calledOnce')
        cy.get('@copy').its('firstCall.args.0').should('contain', 'Hola Sinapp').and('contain', `código de la clínica ${account.accountSlug}`).and('contain', 'play.google.com')
      })
    })
  })

  it('says they have an account before any device is linked, and the app once one opens it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Conapp', lastName: 'Prueba' }).then((p) => {
        const email = `conapp-${Date.now()}@example.test`
        const password = 'Password123!'
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: p.id, email, password })
        cy.login(account.email, account.password)

        cy.visit(`/patients/${p.id}`)
        cy.get('[data-cy=patient-app-status]', { timeout: 15000 }).should('have.attr', 'data-state', 'account')
        cy.get('[data-cy=patient-app-invite]').should('not.exist')

        // What mobile/app.vue does on launch, with the patient signed in.
        cy.task<{ error: string | null }>('db:callRpcAsPatient', {
          email,
          password,
          fn: 'record_app_open',
          args: { p_account_slug: account.accountSlug, p_device_id: crypto.randomUUID(), p_platform: 'ios' },
        }).its('error').should('be.null')

        cy.reload()
        cy.get('[data-cy=patient-app-status]', { timeout: 15000 }).should('have.attr', 'data-state', 'app').and('contain', 'iPhone')
      })
    })
  })
})
