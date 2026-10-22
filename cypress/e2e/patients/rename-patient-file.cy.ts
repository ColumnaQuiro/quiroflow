// Renaming a patient's file from the Files tab (utils/renameFile.ts): only
// the name changes -- the extension is kept when the new name has none, and
// the object in storage keeps its path. Escape leaves it as it was.
describe('Renaming a patient file', () => {
  it('renames it in place, keeping the extension and the stored file', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rita' }).then((p) => {
        cy.task<{ id: string; path: string }>('db:storePatientFile', { accountId: account.accountId, patientId: p.id, fileName: 'scan_0042.pdf' }).then((file) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${p.id}?tab=attachments`)
          cy.contains('[data-cy=file-name]', 'scan_0042.pdf').should('be.visible')

          // Escape: nothing changes.
          cy.get('[data-cy=file-rename]').click()
          cy.get('[data-cy=file-rename-input]').should('have.value', 'scan_0042').type('{selectall}Otro{esc}')
          cy.contains('[data-cy=file-name]', 'scan_0042.pdf').should('be.visible')

          cy.get('[data-cy=file-rename]').click()
          cy.get('[data-cy=file-rename-input]').type('{selectall}Informe RX{enter}')
          cy.contains('[data-cy=file-name]', 'Informe RX.pdf').should('be.visible')

          cy.task<any[]>('db:selectRows', { table: 'patient_files', columns: 'file_name, storage_path', match: { patient_id: p.id } })
            .its(0)
            .should('deep.equal', { file_name: 'Informe RX.pdf', storage_path: file.path })
          cy.reload()
          cy.contains('[data-cy=file-name]', 'Informe RX.pdf').should('be.visible')
        })
      })
    })
  })
})
