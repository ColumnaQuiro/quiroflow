// An exercise assignment, and a programme item, can only point at the writing
// clinic's own patient, exercise and programme
// (20261018054902_patient_exercises_same_clinic.sql). account_id is whatever
// the writer sends, so the policy used to accept another clinic's patient by
// its id -- who then saw the exercise in their app.
//
// Written as the signed-in owner with the browser's own key, so what is
// tested is the policy, not whatever the record page happens to offer.
type Write = { changed: number; error: string | null }

describe('Exercises stay in their clinic', () => {
  it('refuses an assignment to another clinic’s patient, or of another clinic’s exercise', () => {
    cy.seedStaffAccount().then((other) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: other.accountId, clinicId: other.clinicId, firstName: 'Ajena', lastName: 'Paciente' }).then((stranger) => {
        cy.task<{ id: string }[]>('db:insertRows', { table: 'exercises', rows: [{ account_id: other.accountId, name: 'Ajeno' }] }).then(([theirs]) => {
          cy.seedStaffAccount().then((account) => {
            cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Propia', lastName: 'Paciente' }).then((patient) => {
              cy.task<{ id: string }[]>('db:insertRows', { table: 'exercises', rows: [{ account_id: account.accountId, name: 'Propio' }] }).then(([ours]) => {
                const assign = (values: Record<string, unknown>) =>
                  cy.task<Write>('db:settingsWriteAsStaff', { email: account.email, password: account.password, table: 'patient_exercises', op: 'insert', values: { account_id: account.accountId, ...values } })

                // Another clinic's patient, with the clinic's own exercise.
                assign({ patient_id: stranger.id, exercise_id: ours!.id }).then((r) => {
                  expect(r.changed).to.eq(0)
                  expect(r.error).to.match(/row-level security/)
                })
                // The clinic's own patient, with another clinic's exercise.
                assign({ patient_id: patient.id, exercise_id: theirs!.id }).then((r) => {
                  expect(r.changed).to.eq(0)
                  expect(r.error).to.match(/row-level security/)
                })
                cy.task<unknown[]>('db:selectRows', { table: 'patient_exercises', columns: 'id', match: { patient_id: stranger.id } }).should('have.length', 0)

                // Its own patient and exercise still go through -- the check
                // reads exercises, whose patient policy reads patient_exercises,
                // so this is also what would fail if the policies recursed.
                assign({ patient_id: patient.id, exercise_id: ours!.id }).then((r) => {
                  expect(r.error).to.eq(null)
                  expect(r.changed).to.eq(1)
                })

                // Nor can an existing assignment be moved onto the other clinic's patient.
                cy.task<Write>('db:settingsWriteAsStaff', {
                  email: account.email,
                  password: account.password,
                  table: 'patient_exercises',
                  op: 'update',
                  values: { patient_id: stranger.id },
                  match: { patient_id: patient.id },
                }).then((r) => {
                  expect(r.changed).to.eq(0)
                  expect(r.error).to.match(/row-level security/)
                })
                cy.task<unknown[]>('db:selectRows', { table: 'patient_exercises', columns: 'id', match: { patient_id: patient.id } }).should('have.length', 1)
              })
            })
          })
        })
      })
    })
  })

  it('refuses a programme item that mixes in another clinic’s exercise or programme', () => {
    cy.seedStaffAccount().then((other) => {
      cy.task<{ id: string }[]>('db:insertRows', { table: 'exercises', rows: [{ account_id: other.accountId, name: 'Ajeno' }] }).then(([theirExercise]) => {
        cy.task<{ id: string }[]>('db:insertRows', { table: 'exercise_programs', rows: [{ account_id: other.accountId, name: 'Ajeno' }] }).then(([theirProgram]) => {
          cy.seedStaffAccount().then((account) => {
            cy.task<{ id: string }[]>('db:insertRows', { table: 'exercises', rows: [{ account_id: account.accountId, name: 'Propio' }] }).then(([ourExercise]) => {
              cy.task<{ id: string }[]>('db:insertRows', { table: 'exercise_programs', rows: [{ account_id: account.accountId, name: 'Propio' }] }).then(([ourProgram]) => {
                const addItem = (values: Record<string, unknown>) =>
                  cy.task<Write>('db:settingsWriteAsStaff', { email: account.email, password: account.password, table: 'exercise_program_items', op: 'insert', values: { account_id: account.accountId, ...values } })

                addItem({ program_id: ourProgram!.id, exercise_id: theirExercise!.id }).then((r) => {
                  expect(r.changed).to.eq(0)
                  expect(r.error).to.match(/row-level security/)
                })
                addItem({ program_id: theirProgram!.id, exercise_id: ourExercise!.id }).then((r) => {
                  expect(r.changed).to.eq(0)
                  expect(r.error).to.match(/row-level security/)
                })
                cy.task<unknown[]>('db:selectRows', { table: 'exercise_program_items', columns: 'id', match: { program_id: theirProgram!.id } }).should('have.length', 0)

                addItem({ program_id: ourProgram!.id, exercise_id: ourExercise!.id }).then((r) => {
                  expect(r.error).to.eq(null)
                  expect(r.changed).to.eq(1)
                })
              })
            })
          })
        })
      })
    })
  })

  it('still shows a patient the exercises assigned to them, and no others', () => {
    const email = `exercises-own-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Vidal' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task<{ id: string }[]>('db:insertRows', {
          table: 'exercises',
          rows: [
            { account_id: account.accountId, name: 'Asignado' },
            { account_id: account.accountId, name: 'No asignado' },
          ],
        }).then(([assigned, unassigned]) => {
          cy.task('db:insertRows', { table: 'patient_exercises', rows: [{ account_id: account.accountId, patient_id: patient.id, exercise_id: assigned!.id }] })
          cy.task<{ rows: { id: string }[]; error: string | null }>('db:selectAsStaff', {
            email,
            password,
            table: 'exercises',
            columns: 'id',
            inColumn: 'id',
            inValues: [assigned!.id, unassigned!.id],
          }).then((r) => {
            expect(r.error).to.eq(null)
            expect(r.rows.map((x) => x.id)).to.deep.eq([assigned!.id])
          })
        })
      })
    })
  })
})
