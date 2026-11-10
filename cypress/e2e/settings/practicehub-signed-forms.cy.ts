// A form imported from PracticeHub arrives without its signature: the API
// hands a signature over as the widget's id and nothing else. The signed
// original exists only as a PDF PracticeHub's website renders for a signed-in
// member of staff, so Settings > Import > Signed forms signs in as the clinic
// and the server brings each one across.
//
// Run against a stub of that website: the sign-in its login page posts to
// (asking for an emailed code first, as PracticeHub does for a new device),
// the patient list, one patient's forms, and the PDF.
describe('Bringing signed form originals from PracticeHub', () => {
  // Test values for the stub; nothing real signs in with them.
  const web = {
    email: 'recepcion@clinica-demo.test',
    password: 'stub-password-1',
    code: '482913',
    patients: [
      { webId: 'abCDe1fgHi23jKL4', responseIds: [228, 999] },
      { webId: 'zzCDe1fgHi23jKL9', responseIds: [] },
    ],
    forms: [
      {
        id: '7',
        name: 'Consentimiento informado',
        sections: [
          [
            { type: 'paragraph', label: 'Autorizo el tratamiento.' },
            { type: 'radio-group', required: true, label: '¿Aceptas?', name: 'radio-group-1', values: [{ label: 'Sí', value: 'Sí' }, { label: 'No', value: 'No' }] },
            { type: 'drawableimage', label: '¿Dónde te duele?', name: 'drawableimage-1', form_image_id: 0 },
            { type: 'signature', required: true, label: 'Firmado', name: 'signature-1' },
          ],
        ],
      },
      { id: '8', name: 'Formulario retirado', active: false, sections: [[{ type: 'text', label: 'Nombre', name: 'text-1' }]] },
    ],
  }

  afterEach(() => {
    cy.task('db:stopPracticeHubStub')
  })

  it('signs in with the code PracticeHub asks for, then files each original with its form', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Ferrer' }).then((patient) => {
        cy.task<{ id: string }[]>('db:insertRows', {
          table: 'patient_docs',
          rows: [{ account_id: account.accountId, patient_id: patient.id, title: 'Consentimiento informado', fields: [], completed_at: '2026-03-05T09:15:00Z', external_reference: 'PH-form-228' }],
        }).then(([doc]) => {
          // What the Form responses step left: a template guessed from an answer.
          cy.task('db:insertRows', {
            table: 'doc_templates',
            rows: [{ account_id: account.accountId, title: 'Consentimiento informado', fields: [{ id: 'a', type: 'text', label: 'Firmado: guessed', value: null }], external_reference: 'PH-form-template-7' }],
          })
          cy.task<{ baseUrl: string }>('db:startPracticeHubStub', { web }).then(({ baseUrl }) => {
            cy.task('db:setPracticeHubConnection', { accountId: account.accountId, baseUrl })
            cy.login(account.email, account.password)

            cy.visit('/settings/import?source=practicehub&step=signed_forms&type=signed_forms')
            cy.get('[data-cy=import-settings][data-ready=true]')

            // A wrong password is refused and not kept.
            cy.get('[data-cy=ph-web-email]').type(web.email)
            cy.get('[data-cy=ph-web-password]').type('not-the-password')
            cy.get('[data-cy=ph-web-connect-submit]').click()
            cy.get('[data-cy=ph-web-error]').should('contain', 'Invalid email or password')

            cy.get('[data-cy=ph-web-password]').clear().type(web.password)
            cy.get('[data-cy=ph-web-connect-submit]').click()

            // PracticeHub wants the code it emailed before it signs anyone in.
            cy.get('[data-cy=ph-web-code]').should('be.visible')
            cy.get('[data-cy=ph-forms-start]').should('be.disabled')
            cy.get('[data-cy=ph-web-code-input]').type(web.code)
            cy.contains('[data-cy=ph-web-code] button', /Confirm code|Confirmar código/).click()
            cy.get('[data-cy=ph-web-code]').should('not.exist')
            cy.get('[data-cy=ph-web-connected]').should('contain', web.email)

            cy.get('[data-cy=ph-forms-total]').should('have.text', '1')
            cy.get('[data-cy=ph-forms-originals]').should('have.text', '0')
            cy.get('[data-cy=ph-forms-start]').click()
            // The work happens on the server; the page only asks how far it got.
            cy.get('[data-cy=ph-forms-done]', { timeout: 60000 }).should('be.visible')
            cy.get('[data-cy=ph-forms-originals]').should('have.text', '1')

            cy.task<{ external_reference: string; patient_id: string; file_type: string; storage_path: string | null }[]>('db:selectRows', {
              table: 'patient_files',
              columns: 'external_reference, patient_id, file_type, storage_path',
              match: { account_id: account.accountId },
            }).then((files) => {
              // Response 999 is not imported here, so there was nothing to file it with.
              expect(files).to.have.length(1)
              expect(files[0].external_reference).to.eq('PH-form-pdf-228')
              expect(files[0].patient_id).to.eq(patient.id)
              expect(files[0].file_type).to.eq('application/pdf')
              expect(files[0].storage_path).to.match(/ph-form-228-/)
            })

            // The password went to the server's secrets and nowhere a member of staff can read.
            cy.task<Record<string, unknown>[]>('db:selectRows', { table: 'accounts', columns: '*', match: { id: account.accountId } }).then(([row]) => {
              expect(JSON.stringify(row)).not.to.contain(web.password)
            })

            // The template the import guessed from one patient's answers is
            // rebuilt as PracticeHub's editor has the form: a signature and a
            // drawable image are those blocks, not a line of text.
            cy.get('[data-cy=ph-templates-sync]').click()
            cy.get('[data-cy=ph-templates-done]', { timeout: 30000 }).should('contain', '1')
            cy.task<{ title: string; external_reference: string; fields: { type: string; label: string; required?: boolean; options?: string[] }[] }[]>('db:selectRows', {
              table: 'doc_templates',
              columns: 'title, external_reference, fields',
              match: { account_id: account.accountId },
            }).then((templates) => {
              // The inactive form had no template here, so it is not given one.
              expect(templates).to.have.length(1)
              expect(templates[0].external_reference).to.eq('PH-form-template-7')
              expect(templates[0].fields.map((f) => f.type)).to.deep.eq(['text', 'choice', 'drawable_image', 'signature'])
              expect(templates[0].fields[1].options).to.deep.eq(['Sí', 'No'])
              expect(templates[0].fields[3].required).to.eq(true)
              // The guessed line of text is gone.
              expect(JSON.stringify(templates[0].fields)).not.to.contain('guessed')
            })

            // And from the form itself, the way to its signed original.
            cy.visit(`/patients/docs/${doc.id}`)
            cy.get('[data-cy=doc-signed-original]').should('be.visible')
          })
        })
      })
    })
  })
})
