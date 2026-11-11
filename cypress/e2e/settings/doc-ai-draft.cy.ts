// Settings > Docs > "Create with AI". The model itself is stubbed: CI has no
// Anthropic key, and what matters here is what the page does with a draft --
// opens it in the editor unsaved, saves it only on Save, and leaves nothing
// behind when the person walks away from it.
const DRAFT = {
  available: true,
  draft: {
    title: 'Anamnesis inicial',
    category: 'consent',
    fields: [
      { id: '11111111-1111-4111-8111-111111111111', type: 'heading', label: 'Tus datos', required: false, value: null },
      { id: '22222222-2222-4222-8222-222222222222', type: 'short_text', label: 'Nombre', required: true, value: null, patientField: 'first_name' },
      { id: '33333333-3333-4333-8333-333333333333', type: 'choice', label: '¿Dónde te duele?', required: false, value: [], options: ['Cuello', 'Espalda'], multiple: true, allowOther: false },
      { id: '44444444-4444-4444-8444-444444444444', type: 'signature', label: 'Firma', required: true, value: null },
    ],
  },
}

describe('Drafting a form with AI', () => {
  it('opens the draft unsaved, and creates the template only on Save', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.intercept('POST', '/api/docs/draft-form', { statusCode: 200, body: DRAFT }).as('draft')
      cy.visit('/settings/docs')
      cy.contains('No templates yet.', { timeout: 15000 }).should('be.visible')

      cy.get('[data-cy=doc-ai-new]').click()
      cy.get('[data-cy=confirm-dialog-confirm]').should('be.disabled')
      cy.get('[data-cy=doc-ai-description]').type('Primera visita para dolor de espalda')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.wait('@draft').its('request.body').should('deep.include', { description: 'Primera visita para dolor de espalda', source: '' })

      cy.get('[data-cy=doc-editor]').should('be.visible')
      cy.get('[data-cy=doc-ai-banner]').should('contain', 'not saved yet')
      cy.get('input[placeholder="Untitled template"]').should('have.value', 'Anamnesis inicial')
      cy.get('#doc-category').should('have.value', 'consent')
      cy.get('input[placeholder="Heading text…"]').should('have.value', 'Tus datos')
      cy.get('input[placeholder="Question / label…"]').first().should('have.value', 'Nombre')
      // A version points at a saved original; there is none yet.
      cy.get('[data-cy=doc-versions]').should('not.exist')

      cy.contains('button', 'Save').click()
      // The banner changing is the insert having come back. (Not the toast:
      // "Saved" also matches Settings › Saved Replies in the side menu.)
      cy.get('[data-cy=doc-ai-banner]').should('not.contain', 'not saved yet')
      cy.get('[data-cy=doc-versions]').should('be.visible')

      // Reopened from the database: what was saved is the draft, blocks and all.
      cy.reload()
      cy.get('[data-cy=doc-row]', { timeout: 15000 }).should('have.length', 1)
      cy.get('[data-cy=doc-title]').should('have.text', 'Anamnesis inicial')
      cy.contains('4 blocks').should('be.visible')
      cy.get('[data-cy=doc-title]').click()
      cy.get('input[placeholder="Question / label…"]').eq(1).should('have.value', '¿Dónde te duele?')
    })
  })

  it('leaves no template behind when the draft is not saved', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.intercept('POST', '/api/docs/draft-form', { statusCode: 200, body: DRAFT }).as('draft')
      cy.visit('/settings/docs')
      cy.contains('No templates yet.', { timeout: 15000 }).should('be.visible')

      cy.get('[data-cy=doc-ai-new]').click()
      cy.contains('button', 'Informed consent').click()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.wait('@draft')

      // Leaving an unsaved draft asks first, like any unsaved edit.
      cy.contains('button', 'Templates').click()
      cy.contains('Leave without saving?').should('be.visible')
      cy.contains('button', 'Leave without saving').click()
      cy.contains('No templates yet.').should('be.visible')
      cy.reload()
      cy.contains('No templates yet.', { timeout: 15000 }).should('be.visible')
    })
  })

  it('says so when drafting is unavailable, and keeps what was written', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      // Not stubbed: the real route, which without an Anthropic key (as in
      // CI) answers that it is not available rather than failing.
      cy.visit('/settings/docs')
      cy.contains('No templates yet.', { timeout: 15000 }).should('be.visible')

      cy.get('[data-cy=doc-ai-new]').click()
      cy.get('[data-cy=doc-ai-paste-toggle]').click()
      cy.get('[data-cy=doc-ai-source]').type('Nombre: ____  Teléfono: ____')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-cy=doc-ai-error]').should('contain', 'not available')
      cy.get('[data-cy=doc-ai-source]').should('have.value', 'Nombre: ____  Teléfono: ____')
      cy.get('[data-cy=doc-editor]').should('not.exist')
    })
  })
})
