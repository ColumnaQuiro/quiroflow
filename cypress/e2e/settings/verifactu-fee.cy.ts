// The VeriFactu fee: 7,50 EUR a month per clinic location, from the day the
// clinic goes live. Said before the owner picks the date, billed from that
// day, and following the number of active locations. Stripe is not reachable
// from CI, so this pins what decides the charge -- the cron's selection and
// the numbers on the page -- and the Stripe call itself is unit-tested
// (tests/unit/verifactu-fee.test.ts).
describe('VeriFactu fee', () => {
  it('says what going live will cost before the date is picked', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:addClinic', { accountId: account.accountId, name: 'Segundo centro' })
      cy.login(account.email, account.password)
      cy.visit('/settings/verifactu')
      cy.get('[data-cy="verifactu-fee"]')
        .should('contain', '7,50')
        .and('contain', '2 locations')
        .and('contain', '15,00')
    })
  })

  it('is due from the live date, per active location, and picked up for billing', () => {
    cy.seedStaffAccount().then((account) => {
      // The second location first, while the trial waives the location cap.
      cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Segundo centro' }).then((second) => {
        cy.task('db:setSubscriptionStripeIds', { accountId: account.accountId, stripeCustomerId: 'cus_test_stub', stripeSubscriptionId: 'sub_test_stub' })
        cy.task('db:setSubscriptionStatus', { accountId: account.accountId, status: 'active' })

        // Live from tomorrow: nothing due yet.
        cy.task('db:setVerifactuLiveSince', { accountId: account.accountId, since: new Date(Date.now() + 86_400_000).toISOString() })
        cy.task<{ due: number; outOfSync: unknown }>('db:verifactuFeeState', { accountId: account.accountId }).then((state) => {
          expect(state.due).to.eq(0)
          expect(state.outOfSync).to.eq(null)
        })

        // The date has come: both locations due, and the cron would bill them.
        cy.task('db:setVerifactuLiveSince', { accountId: account.accountId, since: new Date(Date.now() - 60_000).toISOString() })
        cy.task<{ due: number; outOfSync: { billed: number; due: number } | null }>('db:verifactuFeeState', { accountId: account.accountId }).then((state) => {
          expect(state.due).to.eq(2)
          expect(state.outOfSync).to.include({ billed: 0, due: 2 })
        })

        // An archived location stops being billed.
        cy.task('db:archiveClinic', { clinicId: second.id })
        cy.task<{ due: number }>('db:verifactuFeeState', { accountId: account.accountId }).its('due').should('eq', 1)

        // Once Stripe bills what is due, there is nothing left to change.
        cy.task('db:setVerifactuBilledLocations', { accountId: account.accountId, locations: 1 })
        cy.task<{ outOfSync: unknown }>('db:verifactuFeeState', { accountId: account.accountId }).its('outOfSync').should('eq', null)
      })
    })
  })

  it('shows on the subscription as its own line', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setSubscriptionStatus', { accountId: account.accountId, status: 'active' })
      cy.task('db:setVerifactuBilledLocations', { accountId: account.accountId, locations: 2 })
      cy.login(account.email, account.password)
      cy.visit('/subscription')
      cy.contains('VeriFactu · 2 locations').should('be.visible')
    })
  })
})
