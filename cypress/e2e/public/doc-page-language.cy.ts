// The page around a form speaks the patient's language, as the form does.
//
// The blocks were already translated (DocBlocks uses useT), but the page's
// own words -- Submit, Thank you, the expired-link notice -- were English
// literals, so a Spanish patient filled in a Spanish form and pressed
// "Submit". A patient is not signed in, so their language is their browser's,
// or a choice saved on the device.

function seedLanguageDoc() {
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

// A browser says its language twice: in Accept-Language, which the server
// renders by, and in navigator.languages, which the client settles on
// (plugins/lang.client.ts). A real browser builds both from one list, so a
// test sets both, or the page hydrates into the CI browser's English.
const browserIn = (tags: string[]) => ({
  headers: { 'Accept-Language': tags.join(',') },
  onBeforeLoad: (win: Window) => Object.defineProperty(win.navigator, 'languages', { value: tags }),
})
const inSpanish = browserIn(['es-ES', 'es'])
const inEnglish = browserIn(['en-GB', 'en'])

describe('The public form page', () => {
  it('is in Spanish for a Spanish browser, through to the thank-you', () => {
    seedLanguageDoc().then(({ publicToken }) => {
      cy.visit(`/doc/${publicToken}`, inSpanish)
      cy.contains('button', 'Enviar').should('be.visible')
      cy.contains('Submit').should('not.exist')
      cy.contains('button', 'Enviar').click()
      cy.contains('h2', 'Gracias').should('be.visible')
      cy.contains('Este documento se ha completado.').should('be.visible')
    })
  })

  it('stays in English for an English browser', () => {
    seedLanguageDoc().then(({ publicToken }) => {
      cy.visit(`/doc/${publicToken}`, inEnglish)
      cy.contains('button', 'Submit').should('be.visible')
    })
  })

  it('says an unknown link is no longer valid, in Spanish', () => {
    cy.visit('/doc/00000000-0000-4000-8000-000000000000', inSpanish)
    cy.contains('Este enlace ya no es válido.').should('be.visible')
  })
})
