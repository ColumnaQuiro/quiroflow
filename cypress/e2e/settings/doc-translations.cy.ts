// A form in other languages (utils/docTranslations.ts): one form, its words
// per language on a tab of their own. The model behind "Translate with AI"
// is stubbed -- CI has no Anthropic key -- so what is tested is what the page
// does with a translation: lays it into the tab, keeps it only on Save, and
// counts a question added later as still to translate.
const HEADING = '11111111-1111-4111-8111-111111111111'
const PAIN = '22222222-2222-4222-8222-222222222222'
const FIELDS = [
  { id: HEADING, type: 'heading', label: 'Tus datos', value: null },
  { id: PAIN, type: 'choice', label: '¿Tienes dolor?', options: ['Sí', 'No'], value: null },
]

describe('Translating a form', () => {
  it('adds English, fills it with AI, and keeps it on Save', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createDocTemplate', { accountId: account.accountId, title: 'Anamnesis', fields: FIELDS })
      cy.intercept('POST', '/api/docs/translate-form', (req) => {
        expect(req.body.language).to.eq('en')
        expect(req.body.title).to.eq('Anamnesis')
        expect(req.body.blocks.map((b: { id: string }) => b.id)).to.deep.eq([HEADING, PAIN])
        req.reply({
          available: true,
          translation: {
            title: 'Intake',
            fields: { [HEADING]: { label: 'Your details' }, [PAIN]: { label: 'Are you in pain?', options: ['Yes', 'No'] } },
          },
        })
      }).as('translate')
      cy.login(account.email, account.password)
      cy.visit('/settings/docs')
      cy.get('[data-cy="docs-settings"][data-ready="true"]')
      cy.contains('[data-cy=doc-title]', 'Anamnesis').click()

      cy.get('[data-cy=doc-add-language]').click()
      cy.get('[data-cy=doc-add-language-en]').click()
      cy.get('[data-cy=doc-translation]').should('have.attr', 'data-language', 'en')
      cy.get('[data-cy=doc-translation-block]').should('have.length', 2)
      cy.get('[data-cy=doc-translate-ai]').click()
      cy.wait('@translate')
      cy.get('[data-cy=doc-translation-title]').should('have.value', 'Intake')
      cy.get('[data-cy=doc-translation-label]').first().should('have.value', 'Your details')
      cy.get('[data-cy=doc-translation-option]').then(($o) => expect([...$o].map((el) => (el as HTMLInputElement).value)).to.deep.eq(['Yes', 'No']))
      // A hand edit on top of the AI's.
      cy.get('[data-cy=doc-translation-label]').eq(1).clear().type('Do you have any pain?')
      // Waited on by its request: the "Saved" toast also matches Settings ›
      // Saved Replies in the side menu.
      cy.intercept('PATCH', '**/rest/v1/doc_templates*').as('saveTemplate')
      cy.contains('button', 'Save').click()
      cy.wait('@saveTemplate').its('response.statusCode').should('be.oneOf', [200, 204])

      // Reopened from the database.
      cy.reload()
      cy.get('[data-cy="docs-settings"][data-ready="true"]')
      cy.contains('[data-cy=doc-row]', 'Anamnesis').find('[data-cy=doc-language]').should('have.text', 'English')
      cy.contains('[data-cy=doc-title]', 'Anamnesis').click()
      cy.get('[data-cy=doc-language-tab-en]').click()
      cy.get('[data-cy=doc-translation-label]').eq(1).should('have.value', 'Do you have any pain?')
      cy.contains('All of it is in English.').should('be.visible')

      // A question added to the original is in English too -- as one to translate.
      cy.get('[data-cy=doc-language-tab-es]').click()
      cy.contains('button', 'Add block').click()
      cy.contains('button', 'Short answer').click()
      cy.get('input[placeholder="Question / label…"]').last().type('¿Desde cuándo?')
      cy.get('[data-cy=doc-language-tab-en]').should('contain', '1').click()
      cy.get('[data-cy=doc-translation-missing]').should('have.text', '1')
      cy.contains('button', 'Translate what is missing with AI').should('be.visible')
    })
  })

  it('sends a form from the record in the patient’s language, and says when it has none', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createDocTemplate', {
        accountId: account.accountId,
        title: 'Anamnesis',
        fields: FIELDS,
        translations: { en: { title: 'Intake', fields: { [HEADING]: { label: 'Your details' }, [PAIN]: { label: 'Are you in pain?', options: ['Yes', 'No'] } } } },
      })
      cy.task('db:createDocTemplate', { accountId: account.accountId, title: 'Consentimiento', fields: [{ id: HEADING, type: 'text', label: 'Acepto', value: null }] })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ellis', lastName: 'Example', preferredLanguage: 'en' }).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=attachments`)
        cy.contains('button', 'Send a form').click()
        // English is preselected: it is the patient's language, and a form has it.
        cy.get('[data-cy=doc-send-language-en]').should('have.attr', 'aria-pressed', 'true')
        cy.contains('[data-cy=doc-send-template]', 'Consentimiento').should('contain', 'Not translated: goes in Spanish')
        cy.contains('[data-cy=doc-send-template]', 'Anamnesis').should('not.contain', 'Not translated').click()

        cy.task<{ language: string | null; title: string; fields: { label: string; options?: string[] }[] }[]>('auto:docsFor', { patientId: patient.id }).then((docs) => {
          expect(docs).to.have.length(1)
          expect(docs[0]!.language).to.eq('en')
          expect(docs[0]!.title).to.eq('Intake')
          expect(docs[0]!.fields.map((f) => f.label)).to.deep.eq(['Your details', 'Are you in pain?'])
          expect(docs[0]!.fields[1]!.options).to.deep.eq(['Yes', 'No'])
        })
      })
    })
  })
})
