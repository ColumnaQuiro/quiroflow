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
    cy.contains('Phone Number ID').should('be.visible')
    cy.contains('WhatsApp Business Account ID').should('be.visible')
    cy.contains('Access token').should('be.visible')
    cy.contains('Meta App Secret').should('be.visible')
  })

  it('says the manual fields are the alternative, not the instructions', () => {
    // The page's opening paragraph used to be the only instruction on it, and
    // left unchanged it contradicted the card above ("nothing to copy
    // across"). Worth a test because it is the kind of copy that silently
    // rots back.
    cy.contains('Already have your own Meta app?').should('be.visible')
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
    })
  })
})
