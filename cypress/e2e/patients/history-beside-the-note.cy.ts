// An assessment is written from the patient's intake history, so the history
// has to be readable while the note is being typed. Two ways: "View answers"
// opens the completed form in a browser tab of its own, and the note dialog
// can show it in a column beside the note.
//
// "View answers" used to open the PATIENT's link, which for a completed form
// says only "Thank you" -- so the new tab it opened never had the answers in.
describe('The history beside the visit note', () => {
  const FIELDS = [
    { id: 'h1', type: 'heading', label: 'Antecedentes' },
    { id: 't1', type: 'text', label: 'Rellene este formulario antes de su primera visita.' },
    { id: 'q1', type: 'long_text', label: 'Cirugías previas', value: 'Menisco rodilla derecha, 2019' },
    { id: 'q2', type: 'checkbox', label: '¿Toma medicación?', value: true },
    { id: 'q3', type: 'choice', label: 'Zona de dolor', options: ['Cuello', 'Lumbar'], multiple: true, value: ['Lumbar', 'Cadera'] },
    { id: 'q4', type: 'scale', label: 'Intensidad del dolor', value: 7 },
    { id: 'q5', type: 'short_text', label: 'Alergias', value: '' },
  ]

  function seed(account: any, firstName: string) {
    return cy
      .task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Historial' })
      .then((patient: any) =>
        cy
          .task('db:createPatientDoc', { accountId: account.accountId, patientId: patient.id, title: 'Historia clínica', completed: true, fields: FIELDS })
          .then((doc: any) => ({ patient, doc })),
      )
  }

  it('opens the answers in a new tab, read-only', () => {
    cy.seedStaffAccount().then((account) => {
      seed(account, 'Pestaña').then(({ patient, doc }: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=attachments`)
        // The tab is a lazy component; wait for the row, not the first frame.
        cy.contains('Historia clínica', { timeout: 15000 }).should('be.visible')

        cy.get('[data-cy=doc-view-answers]')
          .should('have.attr', 'target', '_blank')
          .and('have.attr', 'href', `/patients/docs/${doc.docId}`)

        // Cypress cannot follow a second tab, so visit what it points at.
        cy.visit(`/patients/docs/${doc.docId}`)
        cy.contains('h1', 'Historia clínica').should('be.visible')
        cy.contains('Pestaña Historial').should('be.visible')
        cy.title().should('contain', 'Historia clínica').and('contain', 'Pestaña Historial')

        cy.get('[data-cy=doc-answers]').within(() => {
          cy.contains('Menisco rodilla derecha, 2019').should('be.visible')
          cy.contains('dt', '¿Toma medicación?').next().should('contain', 'Yes')
          // The "Other" answer is stored among the options and reads as one.
          cy.contains('Lumbar, Cadera').should('be.visible')
          cy.contains('7 / 10').should('be.visible')
          cy.contains('dt', 'Alergias').next().should('contain', '—')
          // Instructions are the same on every copy; only answers are shown.
          cy.contains('Rellene este formulario').should('not.exist')
          // Nothing to brush against and change.
          cy.get('input, textarea').should('not.exist')
        })

        cy.contains('a', 'Patient record').should('have.attr', 'href', `/patients/${patient.id}?tab=attachments`)
      })
    })
  })

  it('still opens the form to edit on a plain click of its title', () => {
    cy.seedStaffAccount().then((account) => {
      seed(account, 'Editar').then(({ patient }: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=attachments`)

        cy.contains('a', 'Historia clínica', { timeout: 15000 }).click()
        cy.location('pathname').should('eq', `/patients/${patient.id}`)
        cy.contains('button', 'Save').should('be.visible')
        cy.get('textarea').should('have.value', 'Menisco rodilla derecha, 2019')
      })
    })
  })

  it('shows the completed forms beside the note, and remembers it', () => {
    cy.seedStaffAccount().then((account) => {
      seed(account, 'Dialogo').then(({ patient }: any) => {
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: new Date(Date.now() - 3600000).toISOString(),
          status: 'completed',
        })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)

        cy.contains('button', 'Add note').click()
        cy.get('[data-cy=notes-dialog]').within(() => {
          cy.get('[data-cy=doc-history]').should('not.exist')
          cy.get('[data-cy=notes-dialog-history]').click()
          cy.get('[data-cy=doc-history]').within(() => {
            cy.contains('button', 'Historia clínica').should('have.attr', 'aria-pressed', 'true')
            cy.contains('Menisco rodilla derecha, 2019').should('be.visible')
            cy.contains('a', 'New tab').should('have.attr', 'target', '_blank')
          })
          // The note is still there to write in, beside it.
          cy.get('textarea[placeholder="Add a note…"]').should('be.visible').type('Refiere cirugía de menisco en 2019.')
          cy.contains('button', 'Add note').click()
          cy.contains('Refiere cirugía de menisco en 2019.').should('be.visible')
        })

        cy.get('body').type('{esc}')
        cy.get('[data-cy=notes-dialog]').should('not.exist')
        cy.contains('button', 'Add note').click()
        cy.get('[data-cy=doc-history]').should('be.visible')
      })
    })
  })
})
