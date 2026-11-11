// Settings > WhatsApp now leads with Connect -- Meta's Embedded Signup -- and
// keeps the four manual credential fields below it for a clinic that already
// runs its own Meta app.
//
// What these hold is the arrangement, not the popup: the Meta dialog is a
// cross-origin window on facebook.com that Cypress cannot drive, and the only
// honest end-to-end proof of it is onboarding a real clinic (which is also
// what App Review wants on video). So: the card is offered, the manual route
// is still reachable, and the page does not claim to be connected when it is
// not.
describe('Connecting WhatsApp from Settings', () => {
  beforeEach(() => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
    })
  })

  it('offers Connect, and does not claim a connection that does not exist', () => {
    cy.get('[data-test="whatsapp-connect-card"]').should('be.visible')
    cy.get('[data-test="whatsapp-connect-button"]').should('be.visible').and('contain.text', 'Connect')
    cy.get('[data-test="whatsapp-connected-state"]').should('not.exist')
  })

  it('keeps the manual fields available underneath', () => {
    // A clinic already set up by hand -- Columnaquiro -- must not find its
    // route gone. Adding Connect is an addition, not a replacement, for as
    // long as the direct model is still in use.
    // Folded at the bottom of the page now, open until something is
    // connected; scrolled to because the page scrolls inside its own panel.
    cy.get('[data-cy="whatsapp-manual"]').should('have.attr', 'open')
    cy.contains('label', 'Phone Number ID').scrollIntoView().should('be.visible')
    cy.contains('label', 'WhatsApp Business Account ID').scrollIntoView().should('be.visible')
    cy.contains('label', 'Access token').scrollIntoView().should('be.visible')
    cy.contains('label', 'Meta App Secret').scrollIntoView().should('be.visible')
  })

  it('says the manual fields are the alternative, not the instructions', () => {
    // The page's opening paragraph used to be the only instruction on it, and
    // left unchanged it contradicted the card above ("nothing to copy
    // across"). Worth a test because it is the kind of copy that silently
    // rots back.
    cy.contains('summary', 'Already have your own Meta app?').scrollIntoView().should('be.visible')
  })

  it('asks which number before opening Meta, keeping the app by default', () => {
    // Meta will not move a number between the two afterwards without
    // disconnecting it, so the choice is made up front -- and the default is
    // what nearly every clinic has: the number already on the receptionist's
    // WhatsApp Business app, which they are not about to give up.
    cy.get('[data-test="whatsapp-connect-mode-app"]').should('be.checked')
    cy.get('[data-test="whatsapp-connect-mode-api"]').should('not.be.checked').check()
    cy.get('[data-test="whatsapp-connect-mode-app"]').should('not.be.checked')
  })

  it('says the phone still works when the number is shared with the app', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setWhatsappBusinessAccount', { accountId: account.accountId, businessAccountId: '102290129340399' })
      cy.task('db:updateRows', { table: 'accounts', values: { whatsapp_business_app_since: new Date().toISOString() }, match: { id: account.accountId } })
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-test="whatsapp-connected-state"]').should('be.visible')
      cy.get('[data-test="whatsapp-business-app-state"]').should('be.visible')
    })
  })

  it('shows the connected state once an account carries a WABA id', () => {
    cy.get('[data-test="whatsapp-connect-card"]').should('be.visible')
    // Written the way the connect callback writes it, then reloaded -- this
    // is the state every clinic lands in after a successful Embedded Signup.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setWhatsappBusinessAccount', { accountId: account.accountId, businessAccountId: '102290129340398' })
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-test="whatsapp-connected-state"]').should('be.visible')
      cy.get('[data-test="whatsapp-connect-button"]').should('contain.text', 'Reconnect')
      // An API-only number: nothing to say about the phone.
      cy.get('[data-test="whatsapp-business-app-state"]').should('not.exist')
    })
  })
})
