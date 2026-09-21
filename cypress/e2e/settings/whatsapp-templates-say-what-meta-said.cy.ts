// Settings > WhatsApp lists the clinic's approved message templates by asking
// Meta for them. When that call fails, what the page says is the whole of what
// anyone has to work with.
//
// It used to say, for every possible cause: "Could not reach WhatsApp. Check
// your access token and Business Account ID." Two causes named, neither
// distinguished. On 21 Sep that cost an hour -- an expired token and a wrong
// Business Account ID present identically, and the only way to tell them apart
// was to change one and see. Meta had answered the question both times, in an
// error body the handler threw away.
//
// whatsapp/inbox-send.post.ts already surfaced Meta's message for the send
// path. This is the same thing for the read path.
describe('When Meta refuses to list templates', () => {
  const connect = (accountId: string) =>
    cy.task('db:setWhatsappBusinessAccount', { accountId, businessAccountId: '232335383285622' })

  afterEach(() => cy.task('db:stopMetaGraphStub'))

  it("repeats Meta's own reason instead of guessing at two", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:startMetaGraphStub', { failAt: 'templates' })
      connect(account.accountId)
      cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'EAAT-stub-token' })
      cy.login(account.email, account.password)
      cy.visit('/dashboard')

      cy.request({ method: 'GET', url: '/api/whatsapp/templates', failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(502)
        const said = JSON.stringify(res.body)
        // The actual cause, in Meta's words.
        expect(said, 'Meta said the session expired, so the page should too').to.contain('Session has expired')
        // And not the old catch-all, which is what made this undiagnosable.
        expect(said, 'the guess should be gone when a real reason exists').not.to.contain('Check your access token and Business Account ID')
      })
    })
  })

  it('still says something useful when Meta says nothing at all', () => {
    cy.seedStaffAccount().then((account) => {
      // No stub running: the request fails at the transport, so there is no
      // Meta error body to quote. The old message is exactly right here --
      // it is a guess, but it is the only honest thing left to say.
      connect(account.accountId)
      cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'EAAT-stub-token' })
      cy.login(account.email, account.password)
      cy.visit('/dashboard')

      cy.request({ method: 'GET', url: '/api/whatsapp/templates', failOnStatusCode: false }).then((res) => {
        expect(res.status).to.eq(502)
        expect(JSON.stringify(res.body)).to.contain('Could not reach WhatsApp')
      })
    })
  })

  it('lists the approved templates when Meta answers', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:startMetaGraphStub', {})
      connect(account.accountId)
      cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'EAAT-stub-token' })
      cy.login(account.email, account.password)
      cy.visit('/dashboard')

      cy.request({ method: 'GET', url: '/api/whatsapp/templates' }).then((res) => {
        expect(res.status).to.eq(200)
        expect(res.body.templates).to.have.length(1)
        expect(res.body.templates[0].name).to.eq('recordatorio_cita')
      })
    })
  })
})
