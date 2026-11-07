// The Inbox when something fails, and when a message is too long to go.
//
// A failed list used to fall through to "Nobody is waiting for a reply" --
// the one sentence the front desk acts on by doing nothing. An assignment was
// drawn before it was written, and stayed drawn after the write was refused:
// a conversation that looked in hand while nobody had it. And a reply longer
// than WhatsApp takes was only refused by Meta, after it had been sent.

function openInbox() {
  cy.visit('/inbox')
  cy.get('[data-cy=inbox-list]').should('have.attr', 'data-ready', 'true')
}
function minutesAgo(n: number) {
  return new Date(Date.now() - n * 60_000).toISOString()
}

describe('The Inbox when something fails', () => {
  it('says the list failed instead of saying nobody is waiting, and recovers on retry', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lista', lastName: 'Caida' }).then((p) => {
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: p.id, phoneNumber: '+34600333001', direction: 'inbound', bodyPreview: '¿Hay hueco mañana?', createdAt: minutesAgo(30) })
        let failing = true
        cy.intercept({ method: 'POST', url: /\/rest\/v1\/rpc\/inbox_page/ }, (req) => {
          if (failing) req.reply({ statusCode: 500, body: { message: 'failed' } })
        })
        cy.login(account.email, account.password)
        cy.visit('/inbox')
        cy.get('[data-cy=inbox-list-failed]', { timeout: 20000 }).should('contain', "Couldn't load your conversations")
        cy.get('[data-cy=inbox-empty]').should('not.exist')

        cy.then(() => {
          failing = false
        })
        cy.get('[data-cy=inbox-list-retry]').click()
        cy.get(`[data-cy=inbox-row][data-key="${p.id}"]`).should('be.visible')
        cy.get('[data-cy=inbox-list-failed]').should('not.exist')
      })
    })
  })

  it('puts an assignment back when it was not saved', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Asignada', lastName: 'Nadie' }).then((p) => {
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: p.id, phoneNumber: '+34600333002', direction: 'inbound', bodyPreview: 'Hola', createdAt: minutesAgo(30) })
        cy.intercept({ method: 'POST', url: /\/rest\/v1\/inbox_assignments/ }, { statusCode: 500, body: { message: 'failed' } })
        cy.login(account.email, account.password)
        openInbox()
        cy.get(`[data-cy=inbox-row][data-key="${p.id}"]`).click()
        cy.get('[data-cy=thread-assign]').should('contain', 'Unassigned').click()
        cy.contains('[data-assign-menu] button', '(you)').click()

        cy.contains("Couldn't assign it. Nobody has it yet.", { timeout: 20000 }).should('be.visible')
        cy.get('[data-cy=thread-assign]').should('contain', 'Unassigned')
        cy.task('db:inboxAssignment', { accountId: account.accountId, conversationKey: p.id }).should('eq', null)
      })
    })
  })

  it('holds back a reply longer than WhatsApp takes, and says by how much', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Mensaje', lastName: 'Largo' }).then((p) => {
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: p.id, phoneNumber: '+34600333003', direction: 'inbound', bodyPreview: '¿Me explicáis el tratamiento?', createdAt: minutesAgo(30) })
        cy.login(account.email, account.password)
        openInbox()
        cy.get(`[data-cy=inbox-row][data-key="${p.id}"]`).click()

        const box = () => cy.get('textarea[aria-label="Message"]')
        // Typing 4100 characters key by key is slow; the value is set and
        // the input announced, as a paste would be.
        box().invoke('val', 'a'.repeat(4100)).trigger('input')
        cy.get('[data-cy=composer-count]').should('contain', 'remove 4 characters').and('contain', '4100 / 4096')
        cy.get('[data-cy=thread-send]').should('be.disabled')

        box().invoke('val', 'a'.repeat(4096)).trigger('input')
        cy.get('[data-cy=composer-count]').should('contain', '4096 / 4096').and('not.contain', 'remove')
        cy.get('[data-cy=thread-send]').should('not.be.disabled')
      })
    })
  })
})
