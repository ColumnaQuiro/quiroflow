import type { StaffAccount } from '../../support/commands'

// Messages between colleagues, and the "I need help" alert
// (20261020074859_team_messages.sql). A practitioner's role has no Inbox by
// default, and they are who most needs this, so Team is its own page that
// every team member reaches; Inbox users also get it as a switch.

function colleague(account: StaffAccount, name: string) {
  const email = `${name.toLowerCase()}-${Date.now()}@example.test`
  return cy.task<{ email: string; password: string; teamMemberId: string }>('db:createTeamMemberWithRole', {
    accountId: account.accountId,
    clinicId: account.clinicId,
    roleName: 'Practitioner',
    email,
    password: 'Password123!',
    fullName: `${name} Quiro`,
  })
}

describe('Team messages', () => {
  it('lets a practitioner with no Inbox message a colleague, privately', () => {
    cy.seedStaffAccount().then((account) => {
      colleague(account, 'Pablo').then((pablo) => {
        colleague(account, 'Quique').then((quique) => {
          cy.login(pablo.email, pablo.password)
          cy.visit('/dashboard')
          cy.get('a[href="/team-chat"]').first().click()
          cy.location('pathname').should('eq', '/team-chat')
          cy.get('[data-cy=inbox-team-switch]').should('not.exist')

          cy.contains('[data-cy=team-thread-member]', 'Test Owner').click()
          cy.get('[data-cy=team-composer]').type('Can you bring my 11:00 in?{enter}')
          cy.contains('[data-cy=team-message]', 'Can you bring my 11:00 in?').should('be.visible')

          // A third colleague cannot read a message between two others.
          cy.task<string[]>('db:teamMessagesVisibleTo', { email: quique.email, password: quique.password }).should('not.include', 'Can you bring my 11:00 in?')

          // The owner has the Inbox, and finds it one switch away, unread.
          cy.logout()
          cy.login(account.email, account.password)
          cy.visit('/inbox')
          cy.get('[data-cy=switch-to-team]', { timeout: 15000 }).should('contain.text', '1').click()
          cy.contains('[data-cy=team-thread-member]', 'Pablo Quiro').find('[data-cy=team-thread-unread]').should('have.text', '1')
          cy.contains('[data-cy=team-thread-member]', 'Pablo Quiro').click()
          cy.contains('[data-cy=team-message]', 'Can you bring my 11:00 in?').should('be.visible')
          cy.get('[data-cy=nav-badge-team]').should('not.exist')
        })
      })
    })
  })

  it('puts an alert on every screen until someone answers it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 2' })
      colleague(account, 'Pablo').then((pablo) => {
        cy.login(pablo.email, pablo.password)
        cy.visit('/dashboard')
        cy.get('[data-cy=team-alert-open]').click()
        cy.get('[data-cy=team-alert-room]').select('Sala 2')
        cy.get('[data-cy=team-alert-note]').type('Patient is aggressive')
        cy.get('[data-cy=team-alert-send]').click()
        cy.get('[data-cy=team-alert-banner]').should('contain.text', 'Your alert is out')
        // The confirmation toast sits over the account menu until it fades.
        cy.contains('The team has been alerted.', { timeout: 10000 }).should('not.exist')

        cy.logout()
        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.get('[data-cy=team-alert-banner]', { timeout: 15000 }).should('contain.text', 'Pablo Quiro needs help').and('contain.text', 'Sala 2').and('contain.text', 'Patient is aggressive')
        cy.get('[data-cy=team-alert-answer]').click()
        cy.get('[data-cy=team-alert-banner]').should('not.exist')

        // Answered for everyone, the sender included.
        cy.logout()
        cy.login(pablo.email, pablo.password)
        cy.visit('/dashboard')
        cy.get('[data-cy=team-alert-open]').should('be.visible')
        cy.get('[data-cy=team-alert-banner]').should('not.exist')
      })
    })
  })
})
