// The WhatsApp, Instagram and Meta Ads access tokens sat on `accounts`, which
// every member of the clinic can read -- and Settings > WhatsApp loaded two of
// them into the page. They are secrets now: written through the server, never
// read back, and used from account_secrets by everything that sends.

const PASSWORD = 'Test1234!'

describe('Messaging tokens are secrets', () => {
  it('saves the tokens where no member can read them, and says only that they are stored', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PUT', '/api/whatsapp/tokens').as('saveTokens')
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-cy="whatsapp-settings"][data-ready="true"]')
      // Unique per run: the Instagram id is unique across accounts.
      cy.get('[data-test="instagram-user-id"]').scrollIntoView().type(`1784${Date.now()}`)
      cy.get('[data-test="instagram-access-token"]').type('IG-SECRET-TOKEN')
      cy.get('[data-test="meta-ads-account-id"]').type('act_123')
      cy.get('[data-test="meta-ads-token"]').type('ADS-SECRET-TOKEN')
      cy.get('[data-cy="whatsapp-save"]').click()
      cy.wait('@saveTokens').its('response.statusCode').should('eq', 200)

      cy.task<Record<string, string | null>>('db:messagingTokenColumnsOf', { accountId: account.accountId }).should('deep.equal', {
        whatsapp_access_token: null,
        instagram_access_token: null,
        meta_ads_access_token: null,
      })

      cy.reload()
      cy.get('[data-cy="whatsapp-settings"][data-ready="true"]')
      cy.get('[data-test="instagram-access-token"]').should('have.value', '').and('have.attr', 'placeholder', '••••••••••••••••••••')
      cy.get('[data-test="meta-ads-token"]').should('have.value', '')

      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { settings_access: true, communication_config: true } })
      const email = `tokens-${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Tokens Test' }).then(() => {
        cy.task<{ rows: number }>('db:readAsStaff', { email, password: PASSWORD, table: 'account_secrets', columns: 'value' }).its('rows').should('eq', 0)
      })
    })
  })

  it('sends WhatsApp with the stored secret when the old column is empty', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setAutomaticMessages', { accountId: account.accountId })
      cy.task('db:setAccountSecret', { accountId: account.accountId, name: 'whatsapp_access_token', value: 'secret-token' })
      cy.task('db:settingsWriteAsStaff', {
        email: account.email,
        password: account.password,
        table: 'accounts',
        op: 'update',
        values: { whatsapp_access_token: null },
        match: { id: account.accountId },
      })
      cy.task('db:startMetaGraphStub', { templates: [{ name: 'confirmacion_cita', language: 'es', status: 'APPROVED', body: 'Hola {{1}}.' }] })
      const phone = `+346${Math.floor(10000000 + Math.random() * 89999999)}`
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', phone }).then((p) =>
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), source: 'online' }).then((appt) =>
          cy.task<{ slug: string }[]>('db:selectRows', { table: 'accounts', columns: 'slug', match: { id: account.accountId } }).then((rows) => {
            cy.request({ method: 'POST', url: '/api/public-booking/send-confirmation', body: { accountSlug: rows[0]!.slug, appointmentId: appt.id } })
            cy.task<any[]>('db:metaGraphStubSends').then((all) => expect(all.filter((m) => m?.to === phone.replace(/\D/g, ''))).to.have.length(1))
          }),
        ),
      )
      cy.task('db:stopMetaGraphStub')
    })
  })
})
