// An invite that brings an imported name's appointments with it.
//
// Settings -> Team can invite an imported PracticeHub name as a new colleague,
// who then "gets the imported appointments of <name>". accept_invite used to
// link all of them in the one call, an amount of work with no ceiling; had it
// ever outlasted the 8 s statement timeout, the rollback would have taken the
// whole join with it and the colleague could not have joined at all.
//
// Now accept_invite links the first 2,000 and the app links the rest in
// batches straight after. 4,500 here is more than two batches, so nothing below
// passes unless the batches really run.

const COUNT = 4500
const NAME = 'Dra. Ejemplo Importada'

describe('Accepting an invite that brings imported appointments', () => {
  function setup() {
    return cy.seedStaffAccount().then((account) => {
      const email = `invitee-${Date.now()}@example.test`
      return cy
        .task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Imp', lastName: 'Orted' })
        .then((patient) => cy.task('db:createImportedAppointments', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerName: NAME, count: COUNT }))
        .then(() => cy.task<{ token: string }>('db:createInvite', { accountId: account.accountId, email, linkPractitionerName: NAME }))
        .then(({ token }) => cy.task('db:createLoneUser', { email, password: 'Test1234!' }).then(() => ({ account, email, token })))
    })
  }

  function links(accountId: string) {
    return cy.task<(string | null)[]>('db:importedAppointmentsLinks', { accountId, practitionerName: NAME })
  }

  // The middleware does not wait for the batches, so neither can the spec.
  function waitUntilAllLinked(accountId: string, tries = 40): Cypress.Chainable<(string | null)[]> {
    return links(accountId).then((ids) => {
      if (ids.every((id) => id !== null) || tries <= 0) return cy.wrap(ids)
      return cy.wait(500).then(() => waitUntilAllLinked(accountId, tries - 1))
    })
  }

  function expectAllLinkedToOneNewMember(ids: (string | null)[], ownerId: string) {
    expect(ids).to.have.length(COUNT)
    expect(ids.filter((id) => id === null), 'unlinked').to.have.length(0)
    const owners = [...new Set(ids)]
    expect(owners).to.have.length(1)
    expect(owners[0]).not.to.eq(ownerId)
  }

  it('links only the first batch inside accept_invite itself', () => {
    setup().then(({ account, email, token }) => {
      cy.task<any>('db:acceptInviteAs', { email, password: 'Test1234!', token }).then((member) => {
        links(account.accountId).then((ids) => {
          expect(ids.filter((id) => id === member.id)).to.have.length(2000)
          expect(ids.filter((id) => id === null)).to.have.length(COUNT - 2000)
        })
      })
    })
  })

  it('joins from the invite link and brings every appointment over', () => {
    setup().then(({ account, email, token }) => {
      cy.login(email, 'Test1234!')
      cy.visit(`/join?token=${token}`)
      cy.location('pathname', { timeout: 30000 }).should('eq', '/dashboard')
      links(account.accountId).then((ids) => expectAllLinkedToOneNewMember(ids, account.teamMemberId))
    })
  })

  it('joins after confirming their email, and the rest are linked in the background', () => {
    setup().then(({ account, email, token }) => {
      cy.login(email, 'Test1234!')
      // Where the confirmation link leaves them: signed in, token pending. One
      // page load only -- a second visit while the first is still accepting
      // would find the token not yet cleared and try to accept it again.
      cy.visit('/dashboard', {
        onBeforeLoad(win) {
          win.localStorage.setItem('pending_invite_token', token)
        },
      })
      cy.location('pathname', { timeout: 30000 }).should('eq', '/dashboard')
      waitUntilAllLinked(account.accountId).then((ids) => expectAllLinkedToOneNewMember(ids, account.teamMemberId))
    })
  })
})
