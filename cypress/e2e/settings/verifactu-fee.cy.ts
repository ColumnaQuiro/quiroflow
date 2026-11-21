// VeriFactu is free. It used to cost 7,50 EUR a month per clinic location
// from the live date (20260928184512_verifactu_fee.sql); since
// 20261120203755_verifactu_free.sql nothing is due for any account, live or
// not. The billing machinery stays, so this pins that it bills nothing -- and
// that a subscription still carrying the item is picked up to have it removed.
// Stripe is not reachable from CI; the item change itself is unit-tested
// (tests/unit/verifactu-fee.test.ts).
describe('VeriFactu fee', () => {
  it('says VeriFactu is included at no extra cost, with no price', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:addClinic', { accountId: account.accountId, name: 'Segundo centro' })
      cy.login(account.email, account.password)
      cy.visit('/settings/verifactu')
      cy.get('[data-cy="verifactu-fee"]')
        .should('contain', 'no extra cost')
        .and('not.contain', '€')
    })
  })

  it('is never due, even once live, and a leftover item is picked up for removal', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:addClinic', { accountId: account.accountId, name: 'Segundo centro' })
      cy.task('db:setSubscriptionStripeIds', { accountId: account.accountId, stripeCustomerId: 'cus_test_stub', stripeSubscriptionId: 'sub_test_stub' })
      cy.task('db:setSubscriptionStatus', { accountId: account.accountId, status: 'active' })

      // Live, date already come, two locations: still nothing due.
      cy.task('db:setVerifactuLiveSince', { accountId: account.accountId, since: new Date(Date.now() - 60_000).toISOString() })
      cy.task<{ due: number; outOfSync: unknown }>('db:verifactuFeeState', { accountId: account.accountId }).then((state) => {
        expect(state.due).to.eq(0)
        expect(state.outOfSync).to.eq(null)
      })

      // A subscription billed for it from before: the cron takes it off.
      cy.task('db:setVerifactuBilledLocations', { accountId: account.accountId, locations: 2 })
      cy.task<{ outOfSync: { billed: number; due: number } | null }>('db:verifactuFeeState', { accountId: account.accountId })
        .its('outOfSync')
        .should('include', { billed: 2, due: 0 })
    })
  })
})
