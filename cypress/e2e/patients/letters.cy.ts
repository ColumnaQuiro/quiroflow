// Letters (20261023064438_letters.sql): a template in Settings > Letters with
// merge fields, a letter started from it on the patient's record -- filled
// in with their details, edited, saved there -- and the PDF on the clinic's
// letterhead, logged in the patient's access log as an export.

const PASSWORD = 'Test1234!'
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function seedPatient(account: { accountId: string; clinicId: string; teamMemberId: string }) {
  cy.task('db:updateRows', { table: 'clinics', values: { tax_id: 'B12345678', address: 'Calle Mayor 1, Madrid' }, match: { id: account.clinicId } })
  return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Carta' }).then((p) => {
    cy.task('db:updateRows', { table: 'patients', values: { national_id: '12345678Z', chief_complaint: 'Lumbalgia', diagnosis: 'Lumbalgia mecánica' }, match: { id: p.id } })
    for (const n of [10, 3]) {
      cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: daysAgo(n), status: 'completed' })
    }
    return cy.wrap(p)
  })
}

describe('Letters', () => {
  it('writes a letter from a template, keeps it on the record and prints it on the letterhead', () => {
    cy.seedStaffAccount().then((account) => {
      seedPatient(account).then((patient) => {
        cy.login(account.email, account.password)

        // The template.
        cy.visit('/settings/letters')
        cy.get('[data-cy=letters-settings][data-ready=true]').should('exist')
        // Every account starts with the two Spanish defaults.
        cy.contains('[data-cy=letter-template-row]', 'Informe para su médico').should('exist')
        cy.contains('[data-cy=letter-template-row]', 'Certificado de asistencia a tratamiento').should('exist')
        cy.get('[data-cy=letter-template-new]').click()
        cy.get('[data-cy=letter-template-name-input]').clear().type('Informe de prueba')
        cy.get('[data-cy=letter-body]').click().type('Paciente: ')
        cy.get('[data-cy=letter-field-picker]').select('full_name')
        cy.get('[data-cy=letter-body]').type(' con DNI ')
        cy.get('[data-cy=letter-field-picker]').select('national_id')
        cy.get('[data-cy=letter-body]').type('{enter}Motivo: ')
        cy.get('[data-cy=letter-field-picker]').select('chief_complaint')
        cy.get('[data-cy=letter-body]').type('{enter}Visitas: ')
        cy.get('[data-cy=letter-field-picker]').select('visit_count')
        cy.intercept('PATCH', '**/rest/v1/letter_templates*').as('saveTemplate')
        cy.get('[data-cy=letter-template-save]').click()
        cy.wait('@saveTemplate').its('response.statusCode').should('eq', 200)
        cy.task<{ body: string }[]>('db:selectRows', { table: 'letter_templates', columns: 'body', match: { account_id: account.accountId, name: 'Informe de prueba' } })
          .its('0.body')
          .should('contain', 'Paciente: {{full_name}} con DNI {{national_id}}')
          .and('contain', '{{chief_complaint}}')
          .and('contain', '{{visit_count}}')

        // The letter, on the record.
        cy.visit(`/patients/${patient.id}?tab=attachments`)
        cy.get('[data-cy=patient-letters][data-ready=true]').should('exist')
        cy.get('[data-cy=letter-new]').click()
        cy.intercept('POST', `/api/patients/${patient.id}/letters/draft`).as('draft')
        cy.get('[data-cy=letter-new-menu]').contains('button', 'Informe de prueba').click()
        cy.wait('@draft').its('response.statusCode').should('eq', 200)
        cy.get('[data-cy=letter-body]')
          .should('contain.text', 'Paciente: Ana Carta con DNI 12345678Z')
          .and('contain.text', 'Motivo: Lumbalgia')
          .and('contain.text', 'Visitas: 2')
          .and('not.contain.text', '{{')
        cy.get('[data-cy=letter-clinical-omitted]').should('not.exist')
        cy.get('[data-cy=letter-body]').type('{moveToEnd}{enter}Un saludo cordial.')
        cy.get('[data-cy=letter-save]').click()
        cy.contains('Letter saved').should('be.visible')
        cy.contains('[data-cy=letter-row]', 'Informe de prueba').should('be.visible')

        cy.task<{ id: string; body: string; clinic_id: string }[]>('db:selectRows', { table: 'patient_letters', columns: 'id, body, clinic_id', match: { patient_id: patient.id } }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]!.body).to.contain('Ana Carta').and.contain('12345678Z').and.contain('Un saludo cordial.').and.not.contain('{{')
          expect(rows[0]!.clinic_id).to.eq(account.clinicId)

          // The PDF: downloaded from the row, and its text.
          cy.intercept('GET', `/api/patient-letters/${rows[0]!.id}/pdf`).as('pdf')
          cy.get('[data-cy=letter-download]').click()
          cy.wait('@pdf').then(({ response }) => {
            expect(response?.statusCode).to.eq(200)
            expect(response?.headers['content-type']).to.contain('application/pdf')
            expect(response?.headers['content-disposition']).to.contain('informe-de-prueba-')
          })
          cy.request({ url: `/api/patient-letters/${rows[0]!.id}/pdf`, encoding: 'binary' }).then((res) => {
            expect(res.body.slice(0, 5)).to.eq('%PDF-')
            cy.task<string[]>('pdf:text', { binary: res.body }).then((texts) => {
              const text = texts.join(' ')
              expect(text).to.contain('Main Location').and.contain('B12345678').and.contain('Calle Mayor 1, Madrid')
              expect(text).to.contain('Ana Carta').and.contain('12345678Z').and.contain('Un saludo cordial.')
            })
          })
          cy.task<{ detail: { document: string; letter_id: string } }[]>('db:selectRows', { table: 'patient_access_log', columns: 'detail', match: { patient_id: patient.id, kind: 'export' } }).then((logs) => {
            expect(logs.some((l) => l.detail.document === 'letter' && l.detail.letter_id === rows[0]!.id)).to.eq(true)
          })
        })
      })
    })
  })

  it('leaves the clinical fields blank for someone who may not see clinical notes', () => {
    cy.seedStaffAccount().then((account) => {
      seedPatient(account).then((patient) => {
        const email = `letters-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
        cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { patients_scope: 'all', docs_files_scope: 'all', patients_edit: true, visit_notes_access: false } })
        cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Recepción' })
        cy.task<{ id: string }[]>('db:selectRows', { table: 'letter_templates', columns: 'id', match: { account_id: account.accountId, name: 'Informe para su médico' } }).then(([template]) => {
          cy.login(email, PASSWORD)
          cy.visit('/dashboard')
          cy.request('POST', `/api/patients/${patient.id}/letters/draft`, { templateId: template!.id }).then((res) => {
            expect(res.body.clinicalOmitted).to.eq(true)
            expect(res.body.body).to.contain('Ana Carta').and.not.contain('Lumbalgia')
          })
        })
      })
    })
  })

  // merge_patients ends by deleting the duplicate, and patient_letters
  // cascades: a merge that did not move them would delete them, report
  // success and show nothing on screen. Driven through the modal, as
  // merge-keeps-the-money is, and checked in the database afterwards.
  it('moves the duplicate’s letters onto the record that is kept', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (lastName: string) => cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paloma', lastName })
      mk('Superviviente').then((survivor) =>
        mk('Duplicada').then((duplicate) => {
          cy.task('db:insertRows', {
            table: 'patient_letters',
            rows: [
              { account_id: account.accountId, patient_id: survivor.id, title: 'Carta del superviviente', body: '<p>a</p>' },
              { account_id: account.accountId, patient_id: duplicate.id, title: 'Carta del duplicado', body: '<p>b</p>' },
            ],
          })
          cy.login(account.email, account.password)
          cy.visit(`/patients/${survivor.id}`)
          cy.get('button[aria-label="More actions"]').click()
          cy.contains('button', 'Merge with another record').click()
          cy.get('#merge-search').type('Duplicada')
          cy.contains('button', 'Paloma Duplicada').click()
          cy.contains('button', 'Merge').click()
          cy.contains('Patients merged').should('be.visible')
          cy.task('db:patientByName', { accountId: account.accountId, firstName: 'Paloma', lastName: 'Duplicada' }).should('eq', null)
          cy.task<{ title: string }[]>('db:selectRows', { table: 'patient_letters', columns: 'title', match: { patient_id: survivor.id } }).then((rows) => {
            expect(rows.map((r) => r.title).sort()).to.deep.eq(['Carta del duplicado', 'Carta del superviviente'])
          })
        }),
      )
    })
  })
})
