// Converting a lead as someone who sees only their own patients.
//
// The endpoint inserted the patient and read its id back in the same
// statement. RLS checks that returned row against the SELECT policy, which
// for an 'own'-scope user asks my_own_patient_ids() -- and a patient with no
// default practitioner is nobody's, so the insert came back as a
// row-level-security error and the conversion failed with a 403. The same
// pattern the Patients page's "New patient" had. Now the id is made up front,
// the row is not read back, and the patient is the converter's own -- or it
// would be a record they had just created and could not open.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

describe('Converting a lead with own-patients scope', () => {
  it('creates the patient as the converter\'s own, with the phone filed', () => {
    cy.seedStaffAccount().then((seeded) => {
      const account = seeded as SeededAccount
      cy.task('db:setRolePermissions', {
        accountId: account.accountId,
        roleName: 'Front Desk',
        patch: { communication_config: true, patients_scope: 'own' },
      })
      const email = `own-convert-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Front Desk',
        email,
        password: 'Test1234!',
        fullName: 'Own Scope',
      }).then((member) => {
        cy.task<{ id: string }>('db:createLead', {
          accountId: account.accountId,
          fullName: 'Itziar Propia Lead',
          stage: 'showed',
          source: 'Meta Ads · Own scope',
          phone: '+34600444977',
        }).then((lead) => {
          cy.login(email, 'Test1234!')
          cy.request({ method: 'POST', url: `/api/growth/leads/${lead.id}/convert`, failOnStatusCode: false }).then((res) => {
            expect(res.status, JSON.stringify(res.body)).to.eq(200)
            expect(res.body.created).to.eq(true)
            const patientId = res.body.patientId as string
            expect(patientId).to.be.a('string')

            cy.task<{ patient: { first_name: string; has_phone: boolean }; numbers: { number: string }[] }>('db:patientWithContacts', { id: patientId }).then(
              ({ patient, numbers }) => {
                expect(patient.first_name).to.eq('Itziar')
                expect(numbers).to.have.length(1)
                expect(patient.has_phone).to.eq(true)
              },
            )
            cy.task<{ default_practitioner_id: string | null }[]>('db:selectRows', {
              table: 'patients',
              columns: 'default_practitioner_id',
              match: { id: patientId },
            }).then((rows) => {
              expect(rows[0]!.default_practitioner_id, 'the converter can see the patient they created').to.eq(member.teamMemberId)
            })
            cy.task('db:leadById', { id: lead.id }).its('stage').should('eq', 'converted')
          })
        })
      })
    })
  })
})
