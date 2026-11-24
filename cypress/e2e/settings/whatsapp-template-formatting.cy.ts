// Formatting a WhatsApp template's message: the toolbar over the body puts
// WhatsApp's markers around the selection (and takes them off again), the
// preview draws them the way the phone will, and the emoji picker inserts at
// the cursor. The footer takes emoji only; the heading nothing at all. The
// staff UI runs in English here; the template is written in Spanish.

interface Account {
  email: string
  password: string
  accountId: string
}

const select = (start: number, end: number) =>
  cy.get('[data-cy="template-body"]').then(($t) => {
    const el = $t[0] as HTMLTextAreaElement
    el.focus()
    el.setSelectionRange(start, end)
  })

describe('Formatting a WhatsApp template', () => {
  afterEach(() => cy.task('db:stopMetaGraphStub'))

  it('wraps the selection, shows it as WhatsApp does, and inserts emoji', () => {
    cy.seedStaffAccount().then((account: Account) => {
      cy.task('db:startMetaGraphStub', {})
      cy.task('db:setWhatsappBusinessAccount', { accountId: account.accountId, businessAccountId: '232335383285622' })
      cy.task('db:setAccountWhatsappToken', { accountId: account.accountId, token: 'EAAT-stub-token' })
      cy.login(account.email, account.password)
      cy.visit('/settings/whatsapp')
      cy.get('[data-cy="whatsapp-template-create"]').should('not.be.disabled').click()

      cy.get('[data-cy="template-dialog"]').within(() => {
        cy.get('[data-cy="template-body"]').type('Hola Ana, trae ropa cómoda')

        // Bold on "Ana", drawn bold in the preview with the markers gone.
        select(5, 8)
        cy.get('[data-cy="wa-format-bold"]').click()
        cy.get('[data-cy="template-body"]').should('have.value', 'Hola *Ana*, trae ropa cómoda')
        cy.get('[data-cy="template-preview-body"]').should('contain', 'Hola Ana, trae').contains('span', 'Ana').should('have.css', 'font-weight', '700')

        // The selection stays on "Ana", so a second press takes it off.
        cy.get('[data-cy="wa-format-bold"]').click()
        cy.get('[data-cy="template-body"]').should('have.value', 'Hola Ana, trae ropa cómoda')

        // Ctrl+I in the box, as in any editor.
        select(15, 26)
        cy.get('[data-cy="template-body"]').trigger('keydown', { key: 'i', ctrlKey: true })
        cy.get('[data-cy="template-body"]').should('have.value', 'Hola Ana, trae _ropa cómoda_')
        cy.get('[data-cy="template-preview-body"]').contains('span', 'ropa cómoda').should('have.css', 'font-style', 'italic')

        // A list, on the lines the selection touches.
        cy.get('[data-cy="template-body"]').clear().type('Trae:{enter}toalla{enter}agua')
        select(6, 17)
        cy.get('[data-cy="wa-format-bullet"]').click()
        cy.get('[data-cy="template-body"]').should('have.value', 'Trae:\n- toalla\n- agua')
        cy.get('[data-cy="wa-preview-bullet"]').should('have.length', 2).first().should('contain', '•').and('contain', 'toalla')

        // An emoji goes in at the cursor; Escape closes the picker, not the dialog.
        select(5, 5)
        cy.get('[data-cy="wa-format-emoji"]').first().click()
        cy.get('[data-cy="wa-format-emoji-picker"]').first().should('be.visible')
        // An emoji's button, not the skin-tone one beside the search (also button.emoji).
        cy.get('emoji-picker').first().shadow().find('button[id^="emo-"]', { timeout: 20000 }).first().click()
        cy.get('[data-cy="template-body"]').invoke('val').should('match', /^Trae:\p{Extended_Pictographic}/u)
        // Inserting hands focus back to the box with the picker still open (and
        // over it, hence force), so Escape comes from there.
        cy.get('[data-cy="template-body"]').should('have.focus').type('{esc}', { force: true })
        cy.get('[data-cy="wa-format-emoji-picker"]').first().should('not.be.visible')
        cy.get('[data-cy="template-body"]').should('have.focus')

        // The footer offers emoji, and nothing else.
        cy.get('[data-cy="template-footer"]').parent().within(() => {
          cy.get('[data-cy="wa-format-emoji"]').should('exist')
          cy.get('[data-cy="wa-format-bold"]').should('not.exist')
        })
      })
      cy.get('[data-cy="template-dialog"]').should('exist')
    })
  })
})
