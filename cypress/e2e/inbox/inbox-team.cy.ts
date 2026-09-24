import type { StaffAccount } from '../../support/commands'

// The Inbox as a team uses it (20260924190000_inbox_per_person_and_assignment):
// read status, archive and labels are each person's own, who a conversation
// is assigned to is the team's, nothing can be deleted, the list pages
// through every conversation the database has, and a number no patient has
// can be attached to one.

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

function withColleague(account: StaffAccount) {
  cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { inbox_access: true } })
  const email = `frida-${Date.now()}@example.test`
  return cy
    .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
      accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: 'Test1234!', fullName: 'Frida Front',
    })
    .then((m) => ({ email, password: 'Test1234!', teamMemberId: m.teamMemberId }))
}

describe('Inbox, as a team', () => {
  it('keeps read status and archive per person, and assignment for everyone', () => {
    cy.seedStaffAccount().then((account) => {
      withColleague(account).then((frida) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Aguirre' }).then((ana) => {
          cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: ana.id, phoneNumber: '+34600111222', direction: 'inbound', bodyPreview: '¿Puedo cambiar la cita?' })

          cy.login(account.email, account.password)
          openInbox()
          row(ana.id).find('[data-cy=inbox-row-unread]').should('exist')
          row(ana.id).click()
          cy.get('[data-cy=thread-name]').should('have.text', 'Ana Aguirre')
          row(ana.id).find('[data-cy=inbox-row-unread]').should('not.exist')

          // Assign it to Frida: the whole team sees that.
          cy.get('[data-cy=thread-assign]').click()
          cy.get('[data-cy=thread-assign-menu]').contains('button', 'Frida Front').click()
          cy.task('db:inboxAssignment', { accountId: account.accountId, conversationKey: ana.id }).should('equal', frida.teamMemberId)
          row(ana.id).find('[data-cy=inbox-row-owner]').should('have.text', 'FF')

          // Archive it: gone from my list, still in my archive.
          cy.get('[data-cy=thread-archive]').click()
          cy.get(`[data-cy=inbox-row][data-key="${ana.id}"]`).should('not.exist')
          cy.get('[data-cy=inbox-archived-toggle]').click()
          row(ana.id).should('exist')

          // Nothing deletes a conversation any more.
          cy.contains('button', /delete/i).should('not.exist')

          // Frida: still unread for her, not archived for her, and hers.
          cy.login(frida.email, frida.password)
          openInbox()
          row(ana.id).find('[data-cy=inbox-row-unread]').should('exist')
          cy.get('[data-cy=nav-badge-inbox]').should('have.text', '1')
          cy.get('[data-cy=inbox-tab-mine]').should('contain.text', '1').click()
          row(ana.id).should('exist')
          cy.get('[data-cy=inbox-tab-unassigned]').click()
          cy.get(`[data-cy=inbox-row][data-key="${ana.id}"]`).should('not.exist')
        })
      })
    })
  })

  it('pages through every conversation, and finds one by something said in it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<string[]>('db:seedInboxConversations', { accountId: account.accountId, clinicId: account.clinicId, count: 55 }).then((keys) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Tomás', lastName: 'Tobillo' }).then((tom) => {
          // The match is in the older message, not the one shown in the list.
          cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: tom.id, phoneNumber: '+34600999888', direction: 'inbound', bodyPreview: 'Me torcí el tobillo jugando', createdAt: minutesAgo(600) })
          cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: tom.id, phoneNumber: '+34600999888', direction: 'outbound', bodyPreview: 'Te esperamos el lunes', createdAt: minutesAgo(590) })

          cy.login(account.email, account.password)
          openInbox()
          cy.get('[data-cy=inbox-row]').should('have.length', 50)
          cy.get('[data-cy=inbox-load-more]').click()
          cy.get('[data-cy=inbox-row]').should('have.length', 56)
          cy.get('[data-cy=inbox-load-more]').should('not.exist')
          row(keys[keys.length - 1]).should('exist')

          cy.get('[data-cy=inbox-search]').type('tobillo')
          cy.get('[data-cy=inbox-row]').should('have.length', 1)
          row(tom.id).should('contain.text', 'Te esperamos el lunes')
        })
      })
    })
  })

  it('links an unknown number to the patient it belongs to, or to a new one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pablo', lastName: 'Ferrer', phone: '699887766' }).then((pablo) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: pablo.id, practitionerId: account.teamMemberId, startsAt: new Date(Date.now() + 3 * 86400000).toISOString(), status: 'booked' })
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, phoneNumber: '+34699887766', direction: 'inbound', bodyPreview: '¿Tenéis hueco esta semana?' })
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, phoneNumber: '+34611222333', direction: 'inbound', bodyPreview: 'Hola, soy nueva' })

        cy.login(account.email, account.password)
        openInbox()
        row('+34699887766').click()
        cy.get('[data-cy=inbox-unknown-panel]').should('be.visible')
        cy.get('[data-cy=unknown-suggestion]').should('contain.text', 'Pablo Ferrer').click()

        // The number's messages are now on Pablo, and it is his thread.
        cy.get('[data-cy=thread-name]').should('have.text', 'Pablo Ferrer')
        cy.task<{ patient_id: string | null }[]>('db:messagesFromNumber', { accountId: account.accountId, phoneNumber: '+34699887766' }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0].patient_id).to.equal(pablo.id)
        })
        cy.get('[data-cy=inbox-patient-panel]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=inbox-panel-next]').should('not.contain.text', 'Nothing booked')

        row('+34611222333').click()
        cy.get('[data-cy=unknown-create]').click()
        cy.get('[data-cy=unknown-first-name]').type('Nerea')
        cy.get('[data-cy=unknown-last-name]').type('Nueva')
        cy.get('[data-cy=unknown-create-submit]').click()
        cy.get('[data-cy=thread-name]').should('have.text', 'Nerea Nueva')
        cy.task<{ patient_id: string | null }[]>('db:messagesFromNumber', { accountId: account.accountId, phoneNumber: '+34611222333' }).then((rows) => {
          expect(rows[0].patient_id).to.not.equal(null)
        })
      })
    })
  })

  it('names the channel a thread is on, Instagram included', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createWhatsappMessage', { accountId: account.accountId, direction: 'inbound', bodyPreview: 'Hola desde Instagram', channel: 'instagram', externalContactId: '17841400000000001' })
      cy.login(account.email, account.password)
      openInbox()
      row('17841400000000001').click()
      // It used to say "In-app" for anything that was not WhatsApp.
      cy.get('[data-cy=thread-channel]').should('have.text', 'Instagram')
    })
  })

  it('marks several unread, and assigns them, in one go', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<string[]>('db:seedInboxConversations', { accountId: account.accountId, clinicId: account.clinicId, count: 3, prefix: 'Bulk' }).then((keys) => {
        cy.login(account.email, account.password)
        openInbox()
        cy.get('[data-cy=inbox-row-unread]').should('have.length', 3)
        row(keys[0]).click()
        cy.get('[data-cy=inbox-row-unread]').should('have.length', 2)

        cy.get('[data-cy=inbox-select]').click()
        keys.forEach((k) => row(k).click())
        cy.get('[data-cy=inbox-bulk]').should('contain.text', '3 selected')
        cy.get('[data-cy=inbox-bulk-assign]').click()
        cy.get('[data-cy=inbox-bulk]').contains('button', '(you)').click()
        cy.get('[data-cy=inbox-tab-mine]').should('contain.text', '3')

        cy.get('[data-cy=inbox-select]').click()
        keys.forEach((k) => row(k).click())
        cy.get('[data-cy=inbox-bulk-unread]').click()
        cy.get('[data-cy=inbox-row-unread]').should('have.length', 3)
      })
    })
  })
})
