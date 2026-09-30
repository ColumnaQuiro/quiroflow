// A patient file's row and its content go together, or not at all. The Files
// tab removed the content first and ignored whether the row delete was
// allowed, so a role without patient_files_delete destroyed the file and kept
// a row that opens to nothing -- four in production by 30 Sep 2026.

const PASSWORD = 'Test1234!'

function member(account: { accountId: string; clinicId: string }, patch: Record<string, unknown>) {
  const email = `files-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch })
  return cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Files Test' }).then(() => email)
}

describe('Deleting a patient file', () => {
  it('cannot destroy the content of a file its row may not lose', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p) => {
        cy.task<{ id: string; path: string }>('db:storePatientFile', { accountId: account.accountId, patientId: p.id, fileName: 'radiografia.pdf' }).then((file) => {
          member(account, { patients_scope: 'all', docs_files_scope: 'all', patient_files_delete: false }).then((email) => {
            cy.task<{ removed: number }>('db:removePatientFileAsStaff', { email, password: PASSWORD, path: file.path }).its('removed').should('eq', 0)
            cy.task('db:patientFileStored', { path: file.path }).should('eq', true)

            cy.login(email, PASSWORD)
            cy.visit(`/patients/${p.id}?tab=attachments`)
            cy.contains('radiografia.pdf').should('be.visible')
            // No delete button at all, by its label: the old one had no data-cy.
            cy.get('button[aria-label="Delete"]').should('not.exist')
          })
        })
      })
    })
  })

  it('removes the row and the content together, after asking', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p) => {
        cy.task<{ id: string; path: string }>('db:storePatientFile', { accountId: account.accountId, patientId: p.id, fileName: 'informe.pdf' }).then((file) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${p.id}?tab=attachments`)
          cy.contains('informe.pdf').should('be.visible')
          cy.get('[data-cy="file-delete"]').click()
          cy.get('[data-cy="confirm-dialog"]').contains('button', 'Delete file').click()
          cy.contains('informe.pdf').should('not.exist')
          cy.task('db:patientFileStored', { path: file.path }).should('eq', false)
          cy.reload()
          cy.contains('informe.pdf').should('not.exist')
        })
      })
    })
  })
})
