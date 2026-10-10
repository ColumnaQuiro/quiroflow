// Snoozing a conversation (inbox_snoozes): out of my list until the time
// comes, then back at the top as a follow-up -- unread and marked -- until I
// open it. Just for me, like archiving; a reply brings it back sooner.

function openInbox() {
  cy.visit('/inbox')
  cy.get('[data-cy=inbox-list]').should('have.attr', 'data-ready', 'true')
}
function row(key: string) {
  return cy.get(`[data-cy=inbox-row][data-key="${key}"]`)
}
function minutesAgo(n: number) {
  return new Date(Date.now() - n * 60000).toISOString()
}

describe('Inbox, snoozing a conversation', () => {
  it('hides it until the time comes, and lists it under snoozed', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Nieto' }).then((nora) => {
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: nora.id, phoneNumber: '+34600333444', direction: 'inbound', bodyPreview: 'Te digo algo la semana que viene', createdAt: minutesAgo(30) })

        cy.login(account.email, account.password)
        openInbox()
        row(nora.id).click()
        cy.get('[data-cy=thread-snooze]').click()
        cy.get('[data-cy=thread-snooze-menu]').should('be.visible')
        cy.get('[data-cy=thread-snooze-tomorrow]').click()

        cy.get('[data-cy=inbox-snooze-notice]').should('contain.text', 'Snoozed until')
        cy.get(`[data-cy=inbox-row][data-key="${nora.id}"]`).should('not.exist')

        cy.get('[data-cy=inbox-snoozed-toggle]').click()
        row(nora.id).find('[data-cy=inbox-row-snoozed]').should('contain.text', 'Back')

        // Taken back by hand: in the list again.
        row(nora.id).click()
        cy.get('[data-cy=thread-snooze]').click()
        cy.get('[data-cy=thread-unsnooze]').click()
        cy.get(`[data-cy=inbox-row][data-key="${nora.id}"]`).should('not.exist')
        cy.get('[data-cy=inbox-snoozed-toggle]').click()
        row(nora.id).should('exist')
        cy.task<unknown[]>('db:selectRows', { table: 'inbox_snoozes', columns: 'conversation_key', match: { conversation_key: nora.id } }).should('have.length', 0)
      })
    })
  })

  it('brings it back at the top as an unread follow-up when it comes due, until opened', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Ortiz' }).then((olga) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pablo', lastName: 'Prieto' }).then((pablo) => {
          // Olga's conversation is old and answered; Pablo wrote more recently.
          cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: olga.id, phoneNumber: '+34600555666', direction: 'outbound', bodyPreview: 'Te escribimos en unos días', createdAt: minutesAgo(600) })
          cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: pablo.id, phoneNumber: '+34600777888', direction: 'inbound', bodyPreview: 'Gracias', createdAt: minutesAgo(60) })
          // Snoozed by the owner yesterday, due ten minutes ago.
          cy.task('db:insertRows', {
            table: 'inbox_snoozes',
            rows: [{ account_id: account.accountId, team_member_id: account.teamMemberId, conversation_key: olga.id, snoozed_until: minutesAgo(10), created_at: minutesAgo(500) }],
          })

          cy.login(account.email, account.password)
          openInbox()
          cy.get('[data-cy=inbox-row]').first().should('have.attr', 'data-key', olga.id)
          row(olga.id).find('[data-cy=inbox-row-follow-up]').should('contain.text', 'Follow up')
          row(olga.id).find('[data-cy=inbox-row-unread]').should('exist')

          // Opened: no longer a follow-up, back in date order.
          row(olga.id).click()
          row(olga.id).find('[data-cy=inbox-row-unread]').should('not.exist')
          cy.reload()
          cy.get('[data-cy=inbox-list]').should('have.attr', 'data-ready', 'true')
          row(olga.id).find('[data-cy=inbox-row-follow-up]').should('not.exist')
          cy.get('[data-cy=inbox-row]').first().should('have.attr', 'data-key', pablo.id)
        })
      })
    })
  })
})
