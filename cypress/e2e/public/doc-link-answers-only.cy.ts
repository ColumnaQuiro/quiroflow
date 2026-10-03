// A document link carries the patient's ANSWERS, never the document.
//
// /doc/<token> is reached with no sign-in, and save_public_patient_doc and
// get_public_patient_doc are security definer functions the anon key can call
// directly. Whoever holds the link -- the patient, or anybody the WhatsApp
// was forwarded to -- could:
//
//   - rewrite the consent wording (the label of a text block) and store it as
//     signed, because the function saved the caller's whole `fields` array;
//   - add patientField: 'email' to any answer and overwrite patients.email,
//     the key the patient app claims a record by and online booking matches
//     on, because the column to write was read from the caller's JSON;
//   - read the DNI, signature and health answers back, for ever, because the
//     read returned `fields` whether or not the form had been completed.
//
// These call the functions with the anon key, as anything that is not the
// page would.
const CONSENT = 'Autorizo a la clínica a realizar el tratamiento de quiropráctica descrito.'

function seedDoc(patient: { email?: string; firstName?: string } = {}, extraFields: unknown[] = []) {
  return cy.seedStaffAccount().then((account) =>
    cy
      .task<{ id: string }>('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: patient.firstName ?? 'Consentimiento',
        lastName: 'Firmado',
        ...(patient.email ? { email: patient.email } : {}),
      })
      .then((p) =>
        cy
          .task<{ docId: string; publicToken: string }>('db:createPatientDoc', {
            accountId: account.accountId,
            patientId: p.id,
            title: 'Consentimiento informado',
            fields: [
              { id: 'consent-text', type: 'text', label: CONSENT },
              { id: 'q-pain', type: 'short_text', label: '¿Dónde le duele?', value: null },
              { id: 'q-dni', type: 'short_text', label: 'DNI', value: null, patientField: 'national_id' },
              { id: 'q-agree', type: 'checkbox', label: 'Acepto', value: false, required: true },
              ...extraFields,
            ],
          })
          .then((doc) => ({ account, patientId: p.id, ...doc })),
      ),
  )
}

const save = (token: string, fields: unknown[], complete = true) =>
  cy.task<{ error: string | null; data: unknown }>('db:callRpcAsAnon', {
    fn: 'save_public_patient_doc',
    args: { p_token: token, p_fields: fields, p_complete: complete },
  })

const read = (token: string) =>
  cy.task<{ error: string | null; data: any }>('db:callRpcAsAnon', { fn: 'get_public_patient_doc', args: { p_token: token } })

const patientRow = (id: string) =>
  cy
    .task<any[]>('db:selectRows', { table: 'patients', columns: 'email, national_id, date_of_birth, first_name', match: { id } })
    .then((rows) => rows[0])

describe('A public document link', () => {
  it('stores the answers but keeps the clinic\'s own wording', () => {
    seedDoc({ email: 'paciente.real@example.test' }).then(({ patientId, docId, publicToken }) => {
      save(publicToken, [
        // The wording of the consent, changed by whoever holds the link.
        { id: 'consent-text', type: 'text', label: 'No autorizo nada y la clínica asume toda responsabilidad.' },
        // A real answer, with a column link and a new question text added.
        { id: 'q-pain', type: 'short_text', label: 'Pregunta cambiada', value: 'Lumbar', patientField: 'email' },
        { id: 'q-dni', type: 'short_text', label: 'DNI', value: '12345678Z', patientField: 'national_id' },
        { id: 'q-agree', type: 'heading', label: 'Ya no es una casilla', value: true },
        // A block the clinic never wrote.
        { id: 'invented', type: 'text', label: 'Cláusula añadida por el paciente' },
      ]).then((r) => {
        expect(r.error, 'the submission itself is accepted').to.eq(null)
      })

      cy.task<{ fields: any[]; completedAt: string | null }>('db:patientDocFields', { docId }).then(({ fields, completedAt }) => {
        expect(completedAt, 'completed').to.not.eq(null)
        expect(fields.map((f) => f.id), 'exactly the blocks the clinic sent, in order').to.deep.eq(['consent-text', 'q-pain', 'q-dni', 'q-agree'])
        expect(fields[0].label, 'the consent wording is the clinic\'s').to.eq(CONSENT)
        expect(fields[1].label, 'question text unchanged').to.eq('¿Dónde le duele?')
        expect(fields[1].value, 'the answer was stored').to.eq('Lumbar')
        expect(fields[1].patientField, 'no column link the clinic did not make').to.eq(undefined)
        expect(fields[3].type, 'the checkbox is still a checkbox').to.eq('checkbox')
        expect(fields[3].value, 'and it was ticked').to.eq(true)
      })

      patientRow(patientId).then((p) => {
        expect(p.email, 'an answer cannot re-key the patient\'s email').to.eq('paciente.real@example.test')
        expect(p.national_id, 'a field the clinic linked still reaches the record').to.eq('12345678Z')
      })
    })
  })

  it('never overwrites an email on file, and only fills a blank one with a real address', () => {
    const emailField = { id: 'q-email', type: 'short_text', label: 'Email', value: null, patientField: 'email' }
    const dobField = { id: 'q-dob', type: 'date', label: 'Fecha de nacimiento', value: null, patientField: 'date_of_birth' }

    // Sent the way the page sends them: every block, whole, with its answer.
    //
    // On file already: the answer stays in the document and the record keeps
    // its address. The patient app claims a record by this column.
    seedDoc({ email: 'en.ficha@example.test' }, [emailField]).then(({ patientId, publicToken }) => {
      save(publicToken, [{ ...emailField, value: 'otra.direccion@example.test' }]).then((r) => expect(r.error).to.eq(null))
      patientRow(patientId).its('email').should('eq', 'en.ficha@example.test')
    })

    // Blank on file, and not an address: nothing written.
    seedDoc({}, [emailField, dobField]).then(({ patientId, publicToken }) => {
      save(publicToken, [
        { ...emailField, value: 'esto no es un correo' },
        { ...dobField, value: '2999-01-01' },
      ]).then((r) => expect(r.error).to.eq(null))
      patientRow(patientId).then((p) => {
        expect(p.email, 'not an email address').to.eq(null)
        expect(p.date_of_birth, 'a birth date in the future').to.eq(null)
      })
    })

    // Blank on file and a real address: this is what an intake form is for.
    seedDoc({}, [emailField, dobField]).then(({ patientId, publicToken }) => {
      save(publicToken, [
        { ...emailField, value: '  Nueva.Paciente@Example.test ' },
        { ...dobField, value: '1985-04-12' },
      ]).then((r) => expect(r.error).to.eq(null))
      patientRow(patientId).then((p) => {
        expect(p.email).to.eq('nueva.paciente@example.test')
        expect(p.date_of_birth).to.eq('1985-04-12')
      })
    })
  })

  it('stops handing the answers out once the form is completed', () => {
    seedDoc().then(({ publicToken }) => {
      read(publicToken).then((r) => {
        expect(r.error).to.eq(null)
        expect(r.data.fields, 'an open form shows its questions').to.have.length(4)
      })

      save(publicToken, [
        { id: 'q-dni', value: '12345678Z' },
        { id: 'q-agree', value: true },
      ])

      read(publicToken).then((r) => {
        expect(r.error).to.eq(null)
        expect(r.data.completed_at, 'still says it is done').to.not.eq(null)
        expect(r.data.fields, 'but no DNI, signature or health answers').to.deep.eq([])
        expect(JSON.stringify(r.data), 'nothing the patient typed').to.not.contain('12345678Z')
      })
    })
  })

  it('still fills, submits and thanks the patient in the page', () => {
    seedDoc().then(({ docId, publicToken }) => {
      cy.visit(`/doc/${publicToken}`)
      cy.contains(CONSENT).should('be.visible')
      cy.contains('¿Dónde le duele?').parent().find('input').type('Cervical')
      cy.contains('button', 'Submit').click()
      cy.contains('This document has been completed.').should('be.visible')

      cy.task<{ fields: any[] }>('db:patientDocFields', { docId }).then(({ fields }) => {
        expect(fields.find((f) => f.id === 'q-pain').value).to.eq('Cervical')
      })

      // And a completed link opens straight on the thank-you, as it did.
      cy.visit(`/doc/${publicToken}`)
      cy.contains('This document has been completed.').should('be.visible')
      cy.contains(CONSENT).should('not.exist')
    })
  })
})
