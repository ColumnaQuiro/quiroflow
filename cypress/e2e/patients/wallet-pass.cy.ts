// A bono in Apple Wallet (20261018062028_wallet_passes.sql): the PassKit web
// service a device talks to once the pass is added -- register, "what
// changed since", unregister, each authenticated by the pass's own token --
// and what marks a pass changed: the bono's sessions, the patient's visits.
//
// No pass certificate is configured here, so building the .pkpass itself is
// covered by tests/unit/wallet-pass.test.ts (signature verified by OpenSSL),
// and the add-to-Wallet link answers that Wallet is not set up.
const BASE = '/api/wallet/v1'
const TYPE = 'pass.com.quiroflow.bono'
type Pass = { package_purchase_id: string; auth_token: string; updated_at: string }

describe('Apple Wallet pass', () => {
  function bonoWithPass() {
    return cy.seedStaffAccount().then((account) =>
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Cartera' }).then((patient) =>
        cy.task<{ id: string }>('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, packageName: 'Bono 10', sessionsTotal: 10, sessionsUsed: 4 }).then((purchase) =>
          cy
            .task<Pass[]>('db:insertRows', { table: 'wallet_passes', rows: [{ package_purchase_id: purchase.id, account_id: account.accountId }] })
            .then(([pass]) => cy.wrap({ account, patient, purchase, pass: pass! })),
        ),
      ),
    )
  }
  const auth = (token: string) => ({ Authorization: `ApplePass ${token}` })

  it('registers a device, says what changed since, and unregisters it -- only with the pass’s token', () => {
    bonoWithPass().then(({ purchase, pass }) => {
      const reg = `${BASE}/devices/device-1/registrations/${TYPE}/${purchase.id}`
      cy.request({ method: 'POST', url: reg, headers: auth('wrong'), body: { pushToken: 'ab'.repeat(32) }, failOnStatusCode: false }).its('status').should('eq', 401)
      cy.request({ method: 'POST', url: reg, headers: auth(pass.auth_token), body: { pushToken: 'ab'.repeat(32) } }).its('status').should('eq', 201)
      cy.request({ method: 'POST', url: reg, headers: auth(pass.auth_token), body: { pushToken: 'ab'.repeat(32) } }).its('status').should('eq', 200)
      cy.task('db:selectRows', { table: 'wallet_registrations', columns: 'device_library_id', match: { package_purchase_id: purchase.id } }).should('have.length', 1)

      // Everything since the beginning: this pass.
      cy.request(`${BASE}/devices/device-1/registrations/${TYPE}`).then((r) => {
        expect(r.status).to.eq(200)
        expect(r.body.serialNumbers).to.deep.eq([purchase.id])
        // Nothing since then...
        cy.request(`${BASE}/devices/device-1/registrations/${TYPE}?passesUpdatedSince=${encodeURIComponent(r.body.lastUpdated)}`).its('status').should('eq', 204)
        // ...until a session is used.
        cy.task('db:updateRows', { table: 'package_purchases', values: { sessions_used: 5 }, match: { id: purchase.id } })
        cy.request(`${BASE}/devices/device-1/registrations/${TYPE}?passesUpdatedSince=${encodeURIComponent(r.body.lastUpdated)}`).its('body.serialNumbers').should('deep.eq', [purchase.id])
      })
      // A device that never registered hears about nothing.
      cy.request({ url: `${BASE}/devices/someone-else/registrations/${TYPE}`, failOnStatusCode: false }).its('status').should('eq', 204)

      cy.request({ method: 'DELETE', url: reg, headers: auth(pass.auth_token) }).its('status').should('eq', 200)
      cy.task('db:selectRows', { table: 'wallet_registrations', columns: 'device_library_id', match: { package_purchase_id: purchase.id } }).should('have.length', 0)
    })
  })

  it('marks the pass changed when the patient books a visit (it shows the next one)', () => {
    bonoWithPass().then(({ account, patient, purchase, pass }) => {
      cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: new Date(Date.now() + 2 * 86400_000).toISOString() })
      cy.task<Pass[]>('db:selectRows', { table: 'wallet_passes', columns: 'updated_at', match: { package_purchase_id: purchase.id } }).then(([after]) => {
        expect(Date.parse(after!.updated_at)).to.be.greaterThan(Date.parse(pass.updated_at))
      })
    })
  })

  it('refuses the pass with the wrong token, and the add link while Wallet is not set up', () => {
    bonoWithPass().then(({ account, purchase }) => {
      cy.request({ url: `${BASE}/passes/${TYPE}/${purchase.id}`, headers: auth('nope'), failOnStatusCode: false }).its('status').should('eq', 401)
      cy.request({ url: `${BASE}/passes/pass.other.type/${purchase.id}`, headers: auth('nope'), failOnStatusCode: false }).its('status').should('eq', 401)
      cy.request('/api/wallet/status').its('body').should('deep.eq', { apple: false })
      cy.task<string>('db:accessTokenFor', { email: account.email, password: account.password }).then((token) => {
        cy.request({ method: 'POST', url: `/api/wallet/bono/${purchase.id}/link`, headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false }).its('status').should('eq', 503)
      })
      cy.request({ url: `/api/wallet/bono/${purchase.id}/pass?e=${Date.now() + 60_000}&t=forged`, failOnStatusCode: false }).its('status').should('eq', 403)
    })
  })
})
