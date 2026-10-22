// Custom patient fields (Settings > Custom fields; patient_attributes and
// patient_attribute_values, 20261022185051_custom_patient_fields.sql): the
// clinic defines its own fields, fills them in on a patient, and reads them
// back -- the clinical ones only with clinical access, enforced by the
// database rather than by the screen, and kept through a merge.

const PASSWORD = 'Test1234!'

function frontDesk(account: { accountId: string; clinicId: string }) {
  const email = `cf-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  cy.task('db:setRolePermissions', {
    accountId: account.accountId,
    roleName: 'Front Desk',
    patch: { patients_scope: 'all', patients_edit: true, visit_notes_access: false },
  })
  return cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Recepción Prueba' }).then(() => email)
}

describe('Custom patient fields', () => {
  it('defines a clinical and an admin field, fills them on a patient, and hides the clinical one from a role without clinical access', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Campos' }).then((patient) => {
        cy.login(account.email, account.password)

        // Define: one clinical, one admin with options.
        cy.visit('/settings/custom-fields')
        cy.get('[data-cy=attr-settings][data-ready=true]').should('exist')
        cy.clickUntil('[data-cy=attr-add]', '[data-cy=attr-form]')
        cy.get('[data-cy=attr-form-label]').type('Deporte que practica')
        cy.get('[data-cy=attr-form-section]').select('clinical')
        cy.get('[data-cy=attr-form-kind]').select('text')
        cy.get('[data-cy=attr-form-save]').click()
        cy.get('[data-cy=attr-form]').should('not.exist')
        cy.contains('[data-cy=attr-row]', 'Deporte que practica').should('contain', '{{attr_deporte_que_practica}}')

        cy.get('[data-cy=attr-add]').click()
        cy.get('[data-cy=attr-form-label]').type('Mutua')
        cy.get('[data-cy=attr-form-section]').select('admin')
        cy.get('[data-cy=attr-form-kind]').select('choice')
        cy.get('[data-cy=attr-form-options]').type('Sanitas{enter}Adeslas')
        cy.get('[data-cy=attr-form-save]').click()
        cy.get('[data-cy=attr-section-admin]').should('have.attr', 'aria-selected', 'true')
        cy.contains('[data-cy=attr-row]', 'Mutua').should('contain', 'Sanitas · Adeslas')

        // Fill the clinical one where the clinical summary is.
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy=custom-fields-clinical][data-ready=true]').should('contain', 'Deporte que practica').and('contain', 'Not recorded')
        cy.clickUntil('[data-cy=custom-fields-clinical] [data-cy=custom-fields-edit]', '[data-cy=custom-fields-form]')
        cy.get('[data-cy=custom-field-input][data-key=deporte_que_practica]').type('Pádel')
        cy.get('[data-cy=custom-fields-save]').click()
        cy.get('[data-cy=custom-fields-clinical] [data-cy=custom-field][data-key=deporte_que_practica]').should('contain', 'Pádel')

        // And the admin one in Patient details.
        cy.visit(`/patients/${patient.id}`)
        cy.contains('button', 'Edit all details', { timeout: 15000 }).click()
        cy.get('[data-cy=custom-fields-admin][data-ready=true] [data-cy=custom-fields-edit]', { timeout: 15000 }).click()
        cy.get('[data-cy=custom-field-input][data-key=mutua]').select('Sanitas')
        cy.get('[data-cy=custom-fields-save]').click()
        cy.get('[data-cy=custom-fields-admin] [data-cy=custom-field][data-key=mutua]').should('contain', 'Sanitas')

        cy.task<any[]>('db:selectRows', { table: 'patient_attribute_values', columns: 'value', match: { patient_id: patient.id } }).then((rows) => {
          expect(rows.map((r) => r.value).sort()).to.deep.equal(['Pádel', 'Sanitas'])
        })

        // A role without clinical access: the database hands back the admin
        // answer only, and the record shows no clinical card at all.
        frontDesk(account).then((email) => {
          cy.task<{ rows: any[]; error: string | null }>('db:selectAsStaff', {
            email,
            password: PASSWORD,
            table: 'patient_attribute_values',
            columns: 'value',
            inColumn: 'patient_id',
            inValues: [patient.id],
          }).then(({ rows, error }) => {
            expect(error).to.be.null
            expect(rows.map((r) => r.value)).to.deep.equal(['Sanitas'])
          })

          cy.login(email, PASSWORD)
          cy.visit(`/patients/${patient.id}?tab=clinical`)
          cy.contains('Visit notes').should('be.visible')
          cy.get('[data-cy=custom-fields-clinical]').should('not.exist')
          cy.contains('Pádel').should('not.exist')
          cy.visit(`/patients/${patient.id}`)
          cy.contains('button', 'Edit all details', { timeout: 15000 }).click()
          cy.get('[data-cy=custom-fields-admin] [data-cy=custom-field][data-key=mutua]', { timeout: 15000 }).should('contain', 'Sanitas')
        })
      })
    })
  })

  it('asks for a field when adding a patient once New Patient Fields shows it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'patient_attributes',
        rows: [{ account_id: account.accountId, label: 'Lateralidad', key: 'lateralidad', section: 'admin', kind: 'choice', options: ['Diestro', 'Zurdo'] }],
      })
      cy.login(account.email, account.password)

      cy.visit('/settings/new-patient-fields')
      cy.get('[data-cy=fields-settings][data-ready=true]').should('exist')
      cy.contains('[data-cy=field-row]', 'Lateralidad').within(() => {
        // A new field starts hidden.
        cy.get('[data-cy=field-hidden]').should('have.attr', 'aria-checked', 'true')
        cy.get('[data-cy=field-required]').click()
      })
      cy.get('[data-cy=fields-preview]').should('contain', 'Lateralidad *')
      cy.get('[data-cy=fields-save]').click()
      cy.get('[data-cy=fields-save]').should('be.disabled')

      cy.visit('/patients')
      cy.clickUntil('button:contains("New patient")', '#first-name')
      cy.get('#first-name').type('Iker')
      cy.get('#last-name').type('Nuevo')
      cy.get('[data-cy=new-patient-custom-field][data-key=lateralidad] select').select('Zurdo')
      cy.contains('button', 'Add Patient').click()
      cy.location('pathname', { timeout: 15000 }).should('match', /^\/patients\/[0-9a-f-]+$/)
      cy.location('pathname').then((path) => {
        cy.task<any[]>('db:selectRows', { table: 'patient_attribute_values', columns: 'value', match: { patient_id: path.split('/').pop() } }).then((rows) => {
          expect(rows.map((r) => r.value)).to.deep.equal(['Zurdo'])
        })
      })
    })
  })

  it('a merge keeps the duplicate’s answers on the survivor without overwriting the survivor’s own', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (first: string) => cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Fusion' })
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'patient_attributes',
        rows: [
          { account_id: account.accountId, label: 'Deporte', key: 'deporte', section: 'clinical', kind: 'text' },
          { account_id: account.accountId, label: 'Talla de calzado', key: 'talla', section: 'admin', kind: 'number' },
        ],
      })
      cy.task<any[]>('db:selectRows', { table: 'patient_attributes', columns: 'id, key', match: { account_id: account.accountId } }).then((attrs) => {
        const id = (key: string) => attrs.find((a) => a.key === key).id
        mk('Superviviente').then((survivor) =>
          mk('Duplicada').then((duplicate) => {
            const answer = (patientId: string, key: string, value: string) => ({ account_id: account.accountId, patient_id: patientId, attribute_id: id(key), value })
            cy.task('db:insertRows', {
              table: 'patient_attribute_values',
              rows: [answer(survivor.id, 'deporte', 'Pádel'), answer(duplicate.id, 'deporte', 'Tenis'), answer(duplicate.id, 'talla', '42')],
            })
            cy.task('auto:mergeAsStaff', { email: account.email, password: account.password, survivorId: survivor.id, duplicateId: duplicate.id })
            cy.task<any[]>('db:selectRows', { table: 'patient_attribute_values', columns: 'patient_id, attribute_id, value', match: { account_id: account.accountId } }).then((rows) => {
              expect(rows).to.have.length(2)
              expect(rows).to.deep.include({ patient_id: survivor.id, attribute_id: id('deporte'), value: 'Pádel' })
              expect(rows).to.deep.include({ patient_id: survivor.id, attribute_id: id('talla'), value: '42' })
            })
          }),
        )
      })
    })
  })
})
