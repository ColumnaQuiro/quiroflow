// Messages from people who are not patients, in a clinic without Growth.
//
// Every WhatsApp sender who matches no patient becomes a lead, and so does
// every Instagram DM. The Inbox's list and badge leave lead messages out,
// because Growth draws those threads itself from /api/growth/conversations --
// which a clinic without Growth cannot call. So for that clinic a stranger's
// WhatsApp and every Instagram DM were stored, pushed to their phones, and
// then shown nowhere: no row, no badge, nothing to reply to.
//
// Without Growth they are what they were before leads existed: a
// conversation with a number (or an Instagram account) that is not on any
// patient, which the Inbox already knows how to show, answer and link.

let phoneNumberId = ''
let igUserId = ''
let appSecret = ''

const APP_SECRET_LENGTH = 32

interface Account {
  email: string
  password: string
  accountId: string
}

function signedPost(payload: unknown) {
  const body = JSON.stringify(payload)
  return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) =>
    cy.request({
      method: 'POST',
      url: '/api/whatsapp/webhook',
      body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
    }),
  )
}

function whatsappFrom(from: string, text: string) {
  return signedPost({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: from, profile: { name: 'Marta Sin Ficha' } }],
              messages: [{ id: `wamid.${Date.now()}${Math.random()}`, from, type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  })
}

function instagramFrom(senderId: string, text: string) {
  return signedPost({
    object: 'instagram',
    entry: [{ id: igUserId, messaging: [{ sender: { id: senderId }, recipient: { id: igUserId }, timestamp: Date.now(), message: { mid: `ig.${Date.now()}.${Math.random()}`, text } }] }],
  })
}

function connect(account: Account) {
  phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  igUserId = `1784${Date.now()}${Math.floor(Math.random() * 1e6)}`
  appSecret = Array.from({ length: APP_SECRET_LENGTH }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId })
  cy.task('db:setInstagramAccount', { accountId: account.accountId, instagramUserId: igUserId })
  cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
}

/** A paying clinic on the base plan: active, no add-on, not the Clinic plan. */
function withoutGrowth(account: Account) {
  cy.task('db:setSubscriptionStatus', { accountId: account.accountId, status: 'active' })
  cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: false })
}

const randomNumber = () => `346${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

describe('The Inbox for a clinic without Growth', () => {
  let account: Account

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as Account
      connect(account)
    })
  })

  it('shows, counts and answers a WhatsApp from somebody who is not a patient', () => {
    withoutGrowth(account)
    const from = randomNumber()
    whatsappFrom(from, '¿Atendéis a domicilio?')

    // The badge and the list agree, and both see it.
    cy.task('db:inboxUnreadCounts', { email: account.email, password: account.password }).should('deep.equal', { view: 1, badge: 1 })

    cy.login(account.email, account.password)
    cy.visit('/inbox')
    cy.contains('[data-cy=inbox-row]', from).click()
    cy.contains('¿Atendéis a domicilio?').should('be.visible')
    cy.get('[data-cy=thread-name]').should('contain', from)

    // Answered as the number it is. The Meta send itself is out of reach
    // here; what matters is that the composer is open and addressed.
    cy.intercept('POST', '/api/whatsapp/inbox-send', { statusCode: 200, body: { ok: true } }).as('send')
    cy.get('textarea').last().type('Sí, en toda la ciudad')
    cy.get('[data-cy=thread-send]').click()
    cy.wait('@send').its('request.body').should((body: any) => {
      expect(body.phoneNumber).to.eq(from)
      expect(body.leadId).to.be.undefined
    })
  })

  it('shows and counts an Instagram DM', () => {
    withoutGrowth(account)
    instagramFrom('igsid-no-growth', 'Hola, ¿precio de la primera sesión?')

    cy.task('db:inboxUnreadCounts', { email: account.email, password: account.password }).should('deep.equal', { view: 1, badge: 1 })

    cy.login(account.email, account.password)
    cy.visit('/inbox')
    cy.contains('[data-cy=inbox-row]', 'Hola, ¿precio de la primera sesión?').click()
    cy.get('[data-cy=thread-name]').should('contain', 'Instagram')

    cy.intercept('POST', '/api/instagram/send', { statusCode: 200, body: { ok: true, messageId: 'ig.stub' } }).as('igSend')
    cy.get('textarea').last().type('Son 40 euros')
    cy.get('[data-cy=thread-send]').click()
    cy.wait('@igSend').its('request.body').should((body: any) => expect(body.recipientId).to.eq('igsid-no-growth'))
  })

  it('leaves a Growth clinic exactly as it was: the lead is drawn by Growth, not twice', () => {
    // seedStaffAccount is trialing, and a trial includes Growth.
    whatsappFrom(randomNumber(), 'Quería pedir información')
    cy.task('db:inboxUnreadCounts', { email: account.email, password: account.password }).should('deep.equal', { view: 0, badge: 0 })
  })
})
