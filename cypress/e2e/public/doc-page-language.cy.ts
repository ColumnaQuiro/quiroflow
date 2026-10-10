// The page around a form speaks the patient's language, as the form does.
//
// The blocks were already translated (DocBlocks uses useT), but the page's
// own words -- Submit, Thank you, the expired-link notice -- were English
// literals, so a Spanish patient filled in a Spanish form and pressed
// "Submit". A patient is not signed in, so their language is their browser's
// (Accept-Language), or a choice saved on the device.

function seedDoc() {
  return cy.seedStaffAccount().then((account) =>
    cy
      .task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Idioma', lastName: 'Formulario' })
      .then((p) =>
        cy.task<{ docId: string; publicToken: string }>('db:createPatientDoc', {
          accountId: account.accountId,
          patientId: p.id,
          title: 'Revisión quiropráctica',
          fields: [{ id: 'q-how', type: 'short_text', label: '¿Cómo te encuentras?', value: null }],
        }),
      ),
  )
}

describe('The public form page', () => {
  it('is in Spanish for a Spanish browser, through to the thank-you', () => {
    seedDoc().then(({ publicToken }) => {
      cy.visit(`/doc/${publicToken}`, { headers: { 'Accept-Language': 'es-ES,es;q=0.9' } })
      cy.contains('button', 'Enviar').should('be.visible')
      cy.contains('Submit').should('not.exist')
      cy.contains('button', 'Enviar').click()
      cy.contains('h2', 'Gracias').should('be.visible')
      cy.contains('Este documento se ha completado.').should('be.visible')
    })
  })

  it('stays in English for an English browser', () => {
    seedDoc().then(({ publicToken }) => {
      cy.visit(`/doc/${publicToken}`, { headers: { 'Accept-Language': 'en-GB,en;q=0.9' } })
      cy.contains('button', 'Submit').should('be.visible')
    })
  })

  it('says an unknown link is no longer valid, in Spanish', () => {
    cy.visit('/doc/00000000-0000-4000-8000-000000000000', { headers: { 'Accept-Language': 'es-ES,es;q=0.9' } })
    cy.contains('Este enlace ya no es válido.').should('be.visible')
  })
})
