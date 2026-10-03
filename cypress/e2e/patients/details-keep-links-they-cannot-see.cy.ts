import type { StaffAccount } from '../../support/commands'

// Saving a patient's details wrote the tutor and the referring patient from
// whatever the dialog had managed to look up. A practitioner who sees only
// their own patients cannot look up a tutor who is not one of them, so the
// lookup came back empty, the dialog believed there was no tutor, and Save --
// to fix a typo in an occupation -- unlinked a minor from the person their
// messages go to. The same happened to "referred by". Those two columns are
// now written only when someone actually changes them.

describe('Saving patient details', { scrollBehavior: 'center' }, () => {
  it('keeps a tutor and a referrer the person saving cannot see', () => {
    cy.seedStaffAccount().then((account: StaffAccount) => {
      const email = `prac-details-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email,
        password: 'Test1234!',
        fullName: 'Pra Ctitioner',
      }).then((prac) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Madre', lastName: 'Ajena' }).then((tutor) => {
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Amiga', lastName: 'Ajena' }).then((referrer) => {
            cy.task<{ id: string }>('db:createPatient', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              firstName: 'Hija',
              lastName: 'Propia',
              defaultPractitionerId: prac.teamMemberId,
            }).then((minor) => {
              cy.task('db:setPatientContactFlags', { patientId: minor.id, isMinor: true })
              cy.task('db:setPatientTutor', { patientId: minor.id, tutorPatientId: tutor.id })
              cy.task('db:updateRows', { table: 'patients', values: { referral_source: 'Patient', referred_by_patient_id: referrer.id }, match: { id: minor.id } })

              cy.login(email, 'Test1234!')
              cy.visit(`/patients/${minor.id}`)
              cy.contains('button', 'Edit all details', { timeout: 15000 }).click()
              cy.contains('label', 'Occupation').parent().find('input').clear().type('Estudiante')
              cy.contains('button', /^Save$/).click()
              cy.contains('Patient saved').should('be.visible')

              cy.task<{ tutor_patient_id: string | null; referred_by_patient_id: string | null }>('db:patientMergeFields', { patientId: minor.id }).then((row) => {
                expect(row.tutor_patient_id, 'tutor kept').to.eq(tutor.id)
                expect(row.referred_by_patient_id, 'referrer kept').to.eq(referrer.id)
              })
              cy.task<{ occupation: string }[]>('db:selectRows', { table: 'patients', columns: 'occupation', match: { id: minor.id } }).its('0.occupation').should('eq', 'Estudiante')
            })
          })
        })
      })
    })
  })

  it('still lets someone who can see the tutor remove them', () => {
    cy.seedStaffAccount().then((account: StaffAccount) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Padre', lastName: 'Visible' }).then((tutor) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Hijo', lastName: 'Visible' }).then((minor) => {
          cy.task('db:setPatientContactFlags', { patientId: minor.id, isMinor: true })
          cy.task('db:setPatientTutor', { patientId: minor.id, tutorPatientId: tutor.id })

          // The tutor's name is looked up when the editor opens. Held back
          // here, so Remove is clicked before it arrives: a slow lookup used
          // to land afterwards and put the tutor back (CI found it).
          cy.intercept({ method: 'GET', url: `**/rest/v1/patients*id=eq.${tutor.id}*` }, (req) => {
            req.on('response', (res) => {
              res.setDelay(1500)
            })
          })
          cy.login(account.email, account.password)
          cy.visit(`/patients/${minor.id}`)
          cy.contains('button', 'Edit all details', { timeout: 15000 }).click()
          cy.get('[data-cy=tutor-remove]').scrollIntoView().should('be.visible').click()
          cy.wait(2000)
          cy.contains('button', /^Save$/).click()
          cy.contains('Patient saved').should('be.visible')

          cy.task<{ tutor_patient_id: string | null }>('db:patientMergeFields', { patientId: minor.id }).its('tutor_patient_id').should('eq', null)
        })
      })
    })
  })
})
