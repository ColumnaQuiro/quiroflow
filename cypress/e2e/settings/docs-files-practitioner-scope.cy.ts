// docs_files_scope: documents and files scoped by WHO CREATED them, on top of
// the patient scope. Distinct from patients_scope = 'own', which hides the
// whole patient -- this narrows the paperwork alone, for a clinic whose
// practitioners cover for each other and so need the full patient list.
describe('Documents & files scoped to the practitioner who created them', () => {
  it('shows a scoped practitioner their own and unattributed documents, but not a colleague’s', () => {
    cy.seedStaffAccount().then((account) => {
      // A fresh account is on Solo -- one practitioner seat, already taken by
      // the owner -- so seeding a second practitioner trips
      // enforce_practitioner_seats (0150) with PT402 before the spec even
      // starts. Same bypass practitioner-seat-cap.cy.ts uses.
      cy.setExtraProfessionals(account.accountId, 1)

      cy.task('db:setRolePermissions', {
        accountId: account.accountId,
        roleName: 'Practitioner',
        patch: { docs_files_scope: 'own', patients_scope: 'all' },
      })

      const email = `practitioner-${Date.now()}@example.test`
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email,
        password: 'Test1234!',
        fullName: 'Paula Practitioner',
        isPractitioner: true,
      }).then((member) => {
        cy.task<{ id: string }>('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Shared',
          lastName: 'Patient',
        }).then((patient) => {
          const docs = [
            { title: 'Paula own consent', createdBy: member.teamMemberId },
            { title: 'Colleague private note', createdBy: account.teamMemberId },
            // No author: the shape every imported document has.
            { title: 'Imported legacy form', createdBy: undefined },
          ]
          cy.wrap(docs).each((doc: { title: string; createdBy?: string }) => {
            cy.task('db:createPatientDoc', {
              accountId: account.accountId,
              patientId: patient.id,
              title: doc.title,
              createdBy: doc.createdBy,
            })
          })

          cy.login(email, 'Test1234!')
          cy.visit(`/patients/${patient.id}?tab=attachments`)

          cy.contains('Paula own consent', { timeout: 15000 }).should('be.visible')
          // The decisive assertion: 98% of this clinic's history has no
          // author, and hiding it would make the permission unusable.
          cy.contains('Imported legacy form').should('be.visible')
          cy.contains('Colleague private note').should('not.exist')
        })
      })
    })
  })

  it('leaves every document visible while the role is set to all practitioners', () => {
    cy.seedStaffAccount().then((account) => {
      cy.setExtraProfessionals(account.accountId, 1)

      cy.task('db:setRolePermissions', {
        accountId: account.accountId,
        roleName: 'Practitioner',
        patch: { docs_files_scope: 'all', patients_scope: 'all' },
      })

      const email = `practitioner-all-${Date.now()}@example.test`
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email,
        password: 'Test1234!',
        fullName: 'Pedro Practitioner',
        isPractitioner: true,
      }).then(() => {
        cy.task<{ id: string }>('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Shared',
          lastName: 'Patient',
        }).then((patient) => {
          cy.task('db:createPatientDoc', {
            accountId: account.accountId,
            patientId: patient.id,
            title: 'Colleague private note',
            createdBy: account.teamMemberId,
          })

          cy.login(email, 'Test1234!')
          cy.visit(`/patients/${patient.id}?tab=attachments`)
          cy.contains('Colleague private note', { timeout: 15000 }).should('be.visible')
        })
      })
    })
  })
})
