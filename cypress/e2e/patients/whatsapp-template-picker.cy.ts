// The Send WhatsApp dialog's template picker: every template's text is
// readable before choosing it, with the patient's name already in it, and the
// list opens on the patient's language. Meta's template list and the send are
// stubbed: what is asserted is what the staff member sees and what QuiroFlow
// asks Meta to send, which must be exactly what the old <select> sent.
const template = (name: string, language: string, bodyText: string) => ({
  name,
  language,
  category: 'MARKETING',
  status: 'APPROVED',
  bodyText,
  headerText: null,
  variableCount: 1,
  urlButtonCount: 0,
  mediaHeaderFormat: null,
  buttons: [],
})

describe('Choosing a WhatsApp template by its text', () => {
  it('shows each template’s text before it is chosen, filtered by language and searchable', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marta', lastName: 'Ejemplo', phone: '600000004' }).then((patient) => {
        cy.task('db:updateRows', { table: 'patients', values: { preferred_language: 'en' }, match: { id: patient.id } })
        cy.intercept('GET', '/api/whatsapp/templates*', {
          templates: [
            template('cita_confirmada', 'es', 'Hola {{1}}, tu cita queda confirmada.'),
            template('cita_confirmada', 'en', 'Hi {{1}}, your visit is confirmed.'),
            template('recall_sin_proxima_cita', 'es', 'Hola {{1}}, no tienes próxima cita reservada.'),
            template('descarga_app', 'en', 'Hi {{1}}, you can now carry your visits on your phone.'),
          ],
        }).as('templates')
        cy.intercept('POST', '/api/whatsapp/send', { ok: true }).as('send')

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)
        cy.contains('button', 'Message').first().click()
        cy.wait('@templates')

        // Opens on the patient's language, with their name in the previews.
        cy.get('[data-cy=whatsapp-template-lang-en]').should('have.attr', 'aria-pressed', 'true')
        cy.get('[data-cy=whatsapp-template-card]').should('have.length', 2)
        cy.contains('[data-cy=whatsapp-template-card]', 'Cita confirmada').should('contain', 'Hi Marta, your visit is confirmed.')

        // The same template in another language is a filter away, not a second row.
        cy.get('[data-cy=whatsapp-template-lang-es]').click()
        cy.get('[data-cy=whatsapp-template-card]').should('have.length', 2)
        cy.contains('[data-cy=whatsapp-template-card]', 'Recall sin proxima cita').should('contain', 'Hola Marta, no tienes próxima cita reservada.')

        // Search reads the text as well as the name, accents or not.
        cy.get('[data-cy=whatsapp-template-search]').type('proxima cita reservada')
        cy.get('[data-cy=whatsapp-template-card]').should('have.length', 1)
        // A match in another language is offered rather than silently hidden.
        cy.get('[data-cy=whatsapp-template-search]').clear().type('carry')
        cy.get('[data-cy=whatsapp-template-card]').should('not.exist')
        cy.contains('button', 'See 1 in other languages').click()
        cy.get('[data-cy=whatsapp-template-card]').should('have.length', 1).click()

        // Chosen: the full message and its fields, as before; the send is unchanged.
        cy.get('[data-cy=whatsapp-template-selected]').should('contain', 'Descarga app').and('contain', 'English')
        cy.contains('Hi {{1}}, you can now carry your visits on your phone.').should('be.visible')
        cy.contains('button', 'Send').click()
        cy.wait('@send').its('request.body').should('deep.include', { patientId: patient.id, templateName: 'descarga_app', templateLanguage: 'en', variables: ['Marta'] })
      })
    })
  })
})
