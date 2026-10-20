// "Enviar la app por WhatsApp", from a patient's "More actions" menu: the
// Send WhatsApp dialog, fixed on the descarga_app template (utils/appLinks.ts)
// in the patient's own language, with their first name filled in. A clinic
// whose WhatsApp has no such template is told how to make one rather than
// pointed at Settings. Meta's template list and the send are stubbed: what is
// asserted is what QuiroFlow asks Meta to send.
const template = (language: string, bodyText: string) => ({
  name: 'descarga_app',
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

describe('Sending the app on WhatsApp', () => {
  function patientWithPhone(language: string) {
    return cy.seedStaffAccount().then((account) =>
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marta', lastName: 'Ejemplo', phone: '600000003' }).then((patient) => {
        cy.task('db:updateRows', { table: 'patients', values: { preferred_language: language }, match: { id: patient.id } })
        return cy.wrap({ account, patient })
      }),
    )
  }

  it('sends descarga_app in the patient’s language with their name', () => {
    patientWithPhone('en').then(({ account, patient }) => {
      cy.intercept('GET', '/api/whatsapp/templates*', {
        templates: [template('es', 'Hola {{1}}, ya puedes llevar…'), template('en', 'Hi {{1}}, you can now carry…'), { ...template('fr', 'Bonjour {{1}}'), name: 'cita_confirmada' }],
      }).as('templates')
      cy.intercept('POST', '/api/whatsapp/send', { ok: true }).as('send')

      cy.login(account.email, account.password)
      cy.visit(`/patients/${patient.id}`)
      cy.get('[aria-label="More actions"]').click()
      cy.get('[data-cy=patient-send-app]').click()
      cy.wait('@templates')
      cy.contains('Hi {{1}}, you can now carry').should('be.visible')
      cy.contains('button', 'Send').click()
      cy.wait('@send').its('request.body').should('deep.include', { patientId: patient.id, templateName: 'descarga_app', templateLanguage: 'en', variables: ['Marta'] })
      cy.contains('App link sent on WhatsApp.').should('be.visible')
    })
  })

  it('says how to create the template when the clinic has none', () => {
    patientWithPhone('es').then(({ account, patient }) => {
      cy.intercept('GET', '/api/whatsapp/templates*', { templates: [{ ...template('es', 'Hola {{1}}'), name: 'cita_confirmada' }] }).as('templates')
      cy.login(account.email, account.password)
      cy.visit(`/patients/${patient.id}`)
      cy.get('[aria-label="More actions"]').click()
      cy.get('[data-cy=patient-send-app]').click()
      cy.wait('@templates')
      cy.get('[data-cy=whatsapp-template-missing]').should('contain', 'descarga_app').and('contain', 'WhatsApp Manager')
    })
  })
})
