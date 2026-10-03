// Deleting a form needs patient_docs_delete and editing the patient note
// needs patients_edit -- the database refuses both otherwise. The Docs tab
// offered Delete to everyone and the note offered Edit to everyone, and
// neither looked at what the database answered: the form vanished, the note
// read as saved, and both were back on the next load.

const PASSWORD = 'Test1234!'

function frontDesk(account: { accountId: string; clinicId: string }, patch: Record<string, unknown>) {
  const email = `perm-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch })
  return cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Recepción' }).then(() => email)
}

describe('Patient forms and note, by permission', () => {
  it('offers neither Delete on a form nor Edit on the note to a role without them', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p) => {
        cy.task('db:createPatientDoc', { accountId: account.accountId, patientId: p.id, title: 'Consentimiento informado' })
        cy.task('db:setStickyNote', { patientId: p.id, note: 'Alergia al látex.' })
        frontDesk(account, { patients_scope: 'all', docs_files_scope: 'all', patient_docs_delete: false, patients_edit: false }).then((email) => {
          cy.login(email, PASSWORD)
          cy.visit(`/patients/${p.id}?tab=attachments`)
          cy.contains('Consentimiento informado').should('be.visible')
          cy.get('[data-cy=doc-delete]').should('not.exist')

          cy.visit(`/patients/${p.id}?tab=clinical`)
          cy.contains('[data-cy=sticky-note]', 'Alergia al látex.').should('be.visible')
          cy.get('[data-cy=sticky-note-edit]').should('not.exist')
        })
      })
    })
  })

  it('keeps the form and says so when the delete is refused', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p) => {
        cy.task('db:createPatientDoc', { accountId: account.accountId, patientId: p.id, title: 'Consentimiento informado' })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${p.id}?tab=attachments`)
        cy.contains('Consentimiento informado').should('be.visible')
        // What RLS answers a delete it does not allow: success, no rows.
        cy.intercept({ method: 'DELETE', url: '**/rest/v1/patient_docs*' }, { statusCode: 200, body: [] }).as('refused')
        cy.on('window:confirm', () => true)
        cy.get('[data-cy=doc-delete]').click()
        cy.wait('@refused')
        cy.get('[data-cy=docs-error]').should('contain.text', 'not deleted')
        cy.contains('Consentimiento informado').should('be.visible')
      })
    })
  })

  it('deletes a form for a role that may', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p) => {
        cy.task('db:createPatientDoc', { accountId: account.accountId, patientId: p.id, title: 'Consentimiento informado' })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${p.id}?tab=attachments`)
        cy.on('window:confirm', () => true)
        cy.get('[data-cy=doc-delete]').click()
        cy.contains('Consentimiento informado').should('not.exist')
        cy.reload()
        cy.get('[data-cy=docs-count]').should('have.text', '0')
        cy.contains('Consentimiento informado').should('not.exist')
      })
    })
  })

  it('says when the note was not saved', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${p.id}?tab=clinical`)
        cy.intercept({ method: 'PATCH', url: '**/rest/v1/patients*' }, { statusCode: 200, body: [] }).as('refused')
        cy.get('[data-cy=sticky-note-edit]').click()
        cy.get('[data-cy=sticky-note] textarea').type('Alergia al látex.').blur()
        cy.wait('@refused')
        cy.get('[data-cy=sticky-note-error]').should('contain.text', 'not saved')
      })
    })
  })
})
