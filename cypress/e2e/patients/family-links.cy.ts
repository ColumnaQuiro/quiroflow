// "Familia" on the patient's record (components/patients/FamilyCard.vue,
// patient_relations): a family member who is a patient too, linked both ways
// -- the mother's record says "Hijo", the son's says "Madre" -- and removed
// from either side.
describe('Family on the patient record', () => {
  it('links a family member both ways and unlinks them', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marta', lastName: 'Familia' }).then((mother) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pablo', lastName: 'Familia' }).then((son) => {
          cy.task('db:updateRows', { table: 'patients', values: { gender: 'female' }, match: { id: mother.id } })
          cy.task('db:updateRows', { table: 'patients', values: { gender: 'male' }, match: { id: son.id } })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${mother.id}`)
          cy.get('[data-cy=patient-family]').should('contain', 'No family members linked')
          cy.get('[data-cy=family-add]').click({ scrollBehavior: 'center' })
          cy.get('[data-cy=family-search]').type('Pablo')
          cy.contains('[data-cy=family-result]', 'Pablo Familia').click()
          cy.get('[data-cy=family-relation]').select('child')
          cy.get('[data-cy=family-save]').click({ scrollBehavior: 'center' })
          cy.get('[data-cy=family-link]').should('have.length', 1).and('contain', 'Son').and('contain', 'Pablo Familia')

          cy.task<any[]>('db:selectRows', { table: 'patient_relations', columns: 'patient_id, related_patient_id, relation', match: { account_id: account.accountId } }).then((rows) => {
            expect(rows).to.have.length(2)
            expect(rows).to.deep.include({ patient_id: mother.id, related_patient_id: son.id, relation: 'child' })
            expect(rows).to.deep.include({ patient_id: son.id, related_patient_id: mother.id, relation: 'parent' })
          })

          // The son's record says who she is to him, and unlinks both rows.
          cy.contains('[data-cy=family-link] a', 'Pablo Familia').click()
          cy.location('pathname').should('eq', `/patients/${son.id}`)
          cy.get('[data-cy=family-link]').should('contain', 'Mother').and('contain', 'Marta Familia')
          cy.get('[data-cy=family-remove]').click({ scrollBehavior: 'center' })
          cy.get('[data-cy=family-link]').should('not.exist')
          cy.task<any[]>('db:selectRows', { table: 'patient_relations', columns: 'id', match: { account_id: account.accountId } }).should('have.length', 0)
        })
      })
    })
  })

  it('a merge keeps the duplicate’s family on the survivor, and drops a link between the two', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (first: string) => cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Fusion' })
      mk('Superviviente').then((survivor) =>
        mk('Duplicada').then((duplicate) =>
          mk('Hija').then((daughter) => {
            const link = (a: string, b: string, relation: string) => ({ account_id: account.accountId, patient_id: a, related_patient_id: b, relation })
            cy.task('db:insertRows', {
              table: 'patient_relations',
              rows: [
                link(duplicate.id, daughter.id, 'child'),
                link(daughter.id, duplicate.id, 'parent'),
                link(duplicate.id, survivor.id, 'sibling'),
                link(survivor.id, duplicate.id, 'sibling'),
              ],
            })
            cy.task('auto:mergeAsStaff', { email: account.email, password: account.password, survivorId: survivor.id, duplicateId: duplicate.id })
            cy.task<any[]>('db:selectRows', { table: 'patient_relations', columns: 'patient_id, related_patient_id, relation', match: { account_id: account.accountId } }).then((rows) => {
              expect(rows).to.have.length(2)
              expect(rows).to.deep.include({ patient_id: survivor.id, related_patient_id: daughter.id, relation: 'child' })
              expect(rows).to.deep.include({ patient_id: daughter.id, related_patient_id: survivor.id, relation: 'parent' })
            })
          }),
        ),
      )
    })
  })
})
