// The commonest pair of duplicates is one record the front desk created in
// QuiroFlow and one the PracticeHub import created for the same person. Only
// the imported one carries `external_reference`, and that column is unique
// per account (patients_external_reference_uniq, 0109).
//
// merge_patients fills the survivor's blanks from the duplicate WHILE the
// duplicate still exists -- it is only deleted at the very end -- so keeping
// the QuiroFlow record copied the import's reference onto it and hit the
// unique index against the duplicate's own copy:
//
//   duplicate key value violates unique constraint "patients_external_reference_uniq"
//
// The merge refused outright for exactly the pair it most exists for.
//
// The same field merge never carried the flags that decide who may be
// contacted: a child flagged minor on the imported record lost that flag
// (and their tutor) when the QuiroFlow record was kept, and became
// contactable directly.
describe('Merging a QuiroFlow record with its PracticeHub import', () => {
  function mergeFromOpenRecord(survivorId: string, duplicateSearch: string, duplicateLabel: string) {
    cy.visit(`/patients/${survivorId}`)
    cy.get('button[aria-label="More actions"]').click()
    cy.contains('button', 'Merge with another record').click()
    cy.get('#merge-search').type(duplicateSearch)
    cy.contains('button', duplicateLabel).click()
    // The record opened is the one kept, which is the default.
    cy.contains('Keeps everything').should('be.visible')
    cy.contains('button', 'Merge').click()
    cy.contains('Patients merged').should('be.visible')
  }

  it('keeps the QuiroFlow record, takes the import reference, and keeps the child a minor', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Carmen',
        lastName: 'Tutora',
      }).then((tutor: any) => {
        cy.task('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Lucia',
          lastName: 'Recepcion',
        }).then((quiroflow: any) => {
          cy.task('db:createPatient', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            firstName: 'Lucia',
            lastName: 'Importada',
            externalReference: 'PH-40117',
          }).then((imported: any) => {
            cy.task('db:setPatientContactFlags', { patientId: imported.id, isMinor: true, appPushOptedOut: true })
            cy.task('db:setPatientTutor', { patientId: imported.id, tutorPatientId: tutor.id })

            cy.login(account.email, account.password)
            mergeFromOpenRecord(quiroflow.id, 'Importada', 'Lucia Importada')

            cy.task('db:patientByName', {
              accountId: account.accountId,
              firstName: 'Lucia',
              lastName: 'Importada',
            }).should('eq', null)

            cy.task('db:patientMergeFields', { patientId: quiroflow.id }).then((kept: any) => {
              // The re-run importer matches on this, so losing it would make
              // the next import create the duplicate all over again.
              expect(kept.external_reference).to.eq('PH-40117')
              expect(kept.is_minor).to.eq(true)
              expect(kept.tutor_patient_id).to.eq(tutor.id)
              expect(kept.app_push_opted_out).to.eq(true)
            })
          })
        })
      })
    })
  })

  it('keeps the import, and its reference, when the import is the record kept', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Mario',
        lastName: 'Recepcion',
      }).then((quiroflow: any) => {
        cy.task('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Mario',
          lastName: 'Importado',
          externalReference: 'PH-40118',
        }).then((imported: any) => {
          // The QuiroFlow record points its minor flag at its tutor -- the
          // import -- which after the merge would be the survivor itself.
          cy.task('db:setPatientContactFlags', { patientId: quiroflow.id, isMinor: true })
          cy.task('db:setPatientTutor', { patientId: quiroflow.id, tutorPatientId: imported.id })

          cy.login(account.email, account.password)
          mergeFromOpenRecord(imported.id, 'Recepcion', 'Mario Recepcion')

          cy.task('db:patientByName', {
            accountId: account.accountId,
            firstName: 'Mario',
            lastName: 'Recepcion',
          }).should('eq', null)

          cy.task('db:patientMergeFields', { patientId: imported.id }).then((kept: any) => {
            expect(kept.external_reference).to.eq('PH-40118')
            expect(kept.is_minor).to.eq(true)
            // Never its own tutor.
            expect(kept.tutor_patient_id).to.eq(null)
          })
        })
      })
    })
  })
})
