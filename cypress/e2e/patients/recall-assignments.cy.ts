import type { StaffAccount } from '../../support/commands'

// Recalls with an owner (recall_assignments, 20261022185125): assigned from a
// row or a selection, filtered by who has them, opening on "Mine" for someone
// who has any, and -- for a recall nobody has assigned -- the clinic's
// default from Settings > Recalls, applied when the list is read.

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

interface Seeded {
  account: StaffAccount
  colleagueId: string
  ids: Record<string, string>
}

const PASSWORD = 'Password123!'

function seed(): Cypress.Chainable<Seeded> {
  return cy.seedStaffAccount().then((account) => {
    const ids: Record<string, string> = {}
    const lapsed = (key: string, first: string, last: string, visits: string[]) =>
      cy
        .task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: last, defaultPractitionerId: account.teamMemberId, phone: '612345678' })
        .then((p) => {
          ids[key] = p.id
          for (const at of visits) {
            cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: at, status: 'completed' })
          }
        })
    lapsed('laura', 'Laura', 'Gómez', [daysAgo(70)])
    lapsed('pablo', 'Pablo', 'Ferrer', [daysAgo(56)])
    lapsed('elena', 'Elena', 'Castro', [daysAgo(30)])
    return cy
      .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Front Desk',
        email: `recepcion-${Date.now()}@example.com`,
        password: PASSWORD,
        fullName: 'Recepción Demo',
      })
      .then((colleague) => cy.wrap({ account, colleagueId: colleague.teamMemberId, ids }))
  })
}

function openRecalls(account: StaffAccount) {
  cy.intercept('POST', '/api/recalls/assign').as('assign')
  cy.login(account.email, account.password)
  cy.visit('/recalls')
  cy.get('[data-cy=recalls-page]').should('have.attr', 'data-ready', 'true')
}
const row = (id: string) => cy.get(`[data-cy=recall-row][data-patient-id="${id}"]`)
const noRow = (id: string) => cy.get(`[data-cy=recall-row][data-patient-id="${id}"]`).should('not.exist')
const filter = () => cy.get('[data-cy=recalls-assignee-filter]')

describe('Recall assignments', () => {
  it('assigns from a row and in bulk, filters by who has them, and opens on Mine', () => {
    seed().then(({ account, colleagueId, ids }) => {
      // The clinic's default is nobody: nothing is anyone's yet, so the list
      // opens on everyone's and the sidebar counts all three as to do.
      openRecalls(account)
      filter().should('have.value', '')
      cy.get('[data-cy=recall-row]').should('have.length', 3)
      row(ids.laura).find('[data-cy=recall-assignee]').should('have.value', '')
      cy.get('[data-cy=nav-item][data-to="/recalls"] [data-cy=nav-badge-recalls]').should('have.text', '3')

      // One row, to me.
      row(ids.laura).find('[data-cy=recall-assignee]').select(account.teamMemberId)
      cy.wait('@assign')
      cy.task<{ team_member_id: string | null; assigned_by: string | null } | null>('db:recallAssignment', { patientId: ids.laura }).should((a) => {
        expect(a?.team_member_id).to.equal(account.teamMemberId)
        expect(a?.assigned_by).to.equal(account.teamMemberId)
      })

      filter().select('mine')
      row(ids.laura).should('exist')
      cy.get('[data-cy=recall-row]').should('have.length', 1)

      // The rest, together, to a colleague -- from Unassigned, which they
      // then leave.
      filter().select('unassigned')
      noRow(ids.laura)
      cy.get('[data-cy=recall-row]').should('have.length', 2)
      cy.get('[data-cy=recalls-page] [data-cy=recall-row] input[type=checkbox]').check({ force: true })
      cy.get('[data-cy=recalls-bulk-assign]').click()
      cy.get('[data-cy=recalls-bulk-assign-menu]').contains('button', 'Recepción Demo').click()
      cy.wait('@assign')
      cy.get('[data-cy=recall-row]').should('not.exist')
      for (const key of ['pablo', 'elena']) {
        cy.task<{ team_member_id: string | null } | null>('db:recallAssignment', { patientId: ids[key] }).its('team_member_id').should('equal', colleagueId)
      }

      filter().select(colleagueId)
      row(ids.pablo).find('[data-cy=recall-assignee]').should('have.value', colleagueId)
      row(ids.elena).should('exist')
      noRow(ids.laura)

      // Mine plus nobody's: Laura alone, now that the others are the colleague's.
      cy.get('[data-cy=nav-item][data-to="/recalls"] [data-cy=nav-badge-recalls]').should('have.text', '1')

      // Back later: the list opens on the one that is mine.
      cy.visit('/recalls')
      cy.get('[data-cy=recalls-page]').should('have.attr', 'data-ready', 'true')
      filter().should('have.value', 'mine')
      row(ids.laura).should('exist')
      cy.get('[data-cy=recall-row]').should('have.length', 1)

      // Handing it back to nobody is a choice too.
      row(ids.laura).find('[data-cy=recall-assignee]').select('')
      cy.wait('@assign')
      noRow(ids.laura)
      cy.task<{ team_member_id: string | null } | null>('db:recallAssignment', { patientId: ids.laura }).should((a) => {
        expect(a).to.not.equal(null)
        expect(a!.team_member_id).to.equal(null)
      })
    })
  })

  it("gives a recall nobody has assigned to the clinic's default, without writing it", () => {
    seed().then(({ account, colleagueId, ids }) => {
      // Laura was assigned to the colleague during an earlier lapse; she came
      // back since (her last visit is after it), so that choice is spent.
      cy.task('db:setRecallAssignment', { accountId: account.accountId, patientId: ids.laura, teamMemberId: colleagueId, assignedAt: daysAgo(100) })
      // Pablo's was made in this lapse, and stands.
      cy.task('db:setRecallAssignment', { accountId: account.accountId, patientId: ids.pablo, teamMemberId: colleagueId })
      cy.task('db:setRecallAssigneeDefault', { accountId: account.accountId, mode: 'practitioner' })

      // Their practitioner (the owner, for every seeded patient) -- so the
      // owner has recalls of their own and the list opens on them.
      openRecalls(account)
      filter().should('have.value', 'mine')
      row(ids.laura).find('[data-cy=recall-assignee]').should('have.value', account.teamMemberId)
      row(ids.elena).find('[data-cy=recall-assignee]').should('have.value', account.teamMemberId)
      noRow(ids.pablo)
      cy.task('db:recallAssignment', { patientId: ids.elena }).should('equal', null)

      // Settings > Recalls: one person, the colleague, for every new recall.
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveSetting')
      cy.visit('/settings/recalls')
      cy.get('[data-cy=recall-assignee-settings]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=recall-assignee-default-practitioner]').should('be.checked')
      cy.get('[data-cy=recall-assignee-member]').should('not.exist')
      // "One person" saves nothing until there is a person.
      cy.get('[data-cy=recall-assignee-default-member]').check()
      cy.get('[data-cy=recall-assignee-member]').select(colleagueId)
      cy.wait('@saveSetting')
      cy.task<{ recall_assignee_default: string; recall_assignee_member_id: string | null }>('db:accountRecallAssignee', { accountId: account.accountId }).should((a) => {
        expect(a.recall_assignee_default).to.equal('member')
        expect(a.recall_assignee_member_id).to.equal(colleagueId)
      })

      // Now nothing is the owner's: everyone's, each with the colleague.
      cy.visit('/recalls')
      cy.get('[data-cy=recalls-page]').should('have.attr', 'data-ready', 'true')
      filter().should('have.value', '')
      for (const key of ['laura', 'pablo', 'elena']) row(ids[key]).find('[data-cy=recall-assignee]').should('have.value', colleagueId)
    })
  })
})
