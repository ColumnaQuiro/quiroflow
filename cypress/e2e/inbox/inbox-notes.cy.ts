import type { StaffAccount } from '../../support/commands'

// Internal notes in an Inbox conversation (inbox_notes): written by the team,
// for the team, in the thread between the messages, never sent. A mention
// turns the conversation unread for the colleague it names.

function openInbox() {
  cy.visit('/inbox')
  cy.get('[data-cy=inbox-list]').should('have.attr', 'data-ready', 'true')
}
function row(key: string) {
  return cy.get(`[data-cy=inbox-row][data-key="${key}"]`)
}
// cy.task runs once and never retries; this re-runs it until it agrees.
function taskEventually<T>(name: string, args: object, ok: (v: T) => boolean, tries = 20): Cypress.Chainable<T> {
  return cy.task<T>(name, args).then((v) => {
    if (ok(v) || tries <= 0) return cy.wrap(v)
    cy.wait(250)
    return taskEventually(name, args, ok, tries - 1)
  })
}
function minutesAgo(n: number) {
  return new Date(Date.now() - n * 60000).toISOString()
}
function withColleague(account: StaffAccount) {
  cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { inbox_access: true } })
  const email = `rosa-${Date.now()}@example.test`
  return cy
    .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
      accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: 'Test1234!', fullName: 'Rosa Recepción',
    })
    .then((m) => ({ email, password: 'Test1234!', teamMemberId: m.teamMemberId }))
}

describe('Inbox, internal notes', () => {
  it('keeps a note in the thread for the team, sends nothing, and reaches whoever it mentions', () => {
    cy.seedStaffAccount().then((account) => {
      withColleague(account).then((rosa) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Teo', lastName: 'Torres' }).then((teo) => {
          cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: teo.id, phoneNumber: '+34600999000', direction: 'inbound', bodyPreview: '¿Me podéis mandar la factura?', createdAt: minutesAgo(20) })
          // Rosa has read it already.
          cy.task('db:insertRows', { table: 'inbox_reads', rows: [{ account_id: account.accountId, team_member_id: rosa.teamMemberId, conversation_key: teo.id, last_read_at: new Date().toISOString() }] })

          cy.login(account.email, account.password)
          openInbox()
          row(teo.id).click()
          cy.get('[data-cy=thread-message]').should('have.length', 1)

          cy.get('[data-cy=thread-note-open]').click()
          cy.get('[data-cy=note-text]').type('Hay que revisar el importe, @Ro')
          cy.get('[data-cy=note-mention-option]').contains('Rosa Recepción').click()
          cy.get('[data-cy=note-text]').type('lo miras tú?')
          cy.get('[data-cy=note-save]').click()

          cy.get('[data-cy=thread-note]').should('have.length', 1)
          cy.get('[data-cy=thread-note-body]').should('contain.text', 'Hay que revisar el importe, @Rosa Recepción lo miras tú?')
          // A note, not a message: nothing was sent.
          cy.get('[data-cy=thread-message]').should('have.length', 1)
          cy.task<unknown[]>('db:selectRows', { table: 'whatsapp_messages', columns: 'id', match: { patient_id: teo.id } }).should('have.length', 1)
          cy.task<{ mentions: string[] }[]>('db:selectRows', { table: 'inbox_notes', columns: 'mentions', match: { conversation_key: teo.id } }).then((rows) => {
            expect(rows).to.have.length(1)
            expect(rows[0]!.mentions).to.deep.equal([rosa.teamMemberId])
          })

          // Still there after a reload.
          cy.reload()
          cy.get('[data-cy=inbox-list]').should('have.attr', 'data-ready', 'true')
          row(teo.id).click()
          cy.get('[data-cy=thread-note]').should('have.length', 1)

          // Rosa: mentioned, so unread for her again; she reads the note but
          // cannot delete someone else's.
          cy.login(rosa.email, rosa.password)
          openInbox()
          row(teo.id).find('[data-cy=inbox-row-unread]').should('exist')
          row(teo.id).click()
          cy.get('[data-cy=thread-note-body]').should('contain.text', '@Rosa Recepción')
          cy.get('[data-cy=thread-note-delete]').should('not.exist')
        })
      })
    })
  })

  it('lets the author delete their own note', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Uxue', lastName: 'Urrutia' }).then((uxue) => {
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: uxue.id, phoneNumber: '+34600999111', direction: 'inbound', bodyPreview: 'Hola', createdAt: minutesAgo(5) })
        cy.task('db:insertRows', { table: 'inbox_notes', rows: [{ account_id: account.accountId, conversation_key: uxue.id, author_id: account.teamMemberId, body: 'Ya la he llamado' }] })

        cy.login(account.email, account.password)
        openInbox()
        row(uxue.id).click()
        cy.get('[data-cy=thread-note-body]').should('have.text', 'Ya la he llamado')
        cy.get('[data-cy=thread-note-delete]').click()
        cy.get('[data-cy=thread-note-delete-confirm]').click()
        cy.get('[data-cy=thread-note]').should('not.exist')
        // Deleted in the database, not only taken off the screen (a delete
        // RLS refuses is not an error, it just removes nothing).
        taskEventually<unknown[]>('db:selectRows', { table: 'inbox_notes', columns: 'id', match: { conversation_key: uxue.id } }, (v) => v.length === 0).should('have.length', 0)
        cy.reload()
        cy.get('[data-cy=inbox-list]').should('have.attr', 'data-ready', 'true')
        row(uxue.id).click()
        cy.get('[data-cy=thread-message]').should('have.length', 1)
        cy.get('[data-cy=thread-note]').should('not.exist')
      })
    })
  })
})
