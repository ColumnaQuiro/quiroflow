// The build-mode half of a drawable-image block: a clinic picking the diagram
// its patients will mark. Worth its own spec because the upload lands in a
// bucket (`doc-images`) whose RLS policy is what decides whether it works at
// all, and because the stored value is a path rather than a URL -- so the
// thing to assert is that reopening the template resolves it back into an
// image that actually loads.
describe('Putting a diagram on a document template', () => {
  it('uploads a diagram, keeps it on the block, and still resolves it after a reload', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/docs')

      // New Template inserts as the signed-in account, which the page only
      // knows once the account store has loaded -- clicking before that
      // returns silently and leaves the list exactly as it was.
      cy.contains('No templates yet.', { timeout: 15000 }).should('be.visible')
      cy.contains('button', 'New Template').click()
      cy.get('input[placeholder="Untitled template"]', { timeout: 15000 }).clear().type('Mapa del dolor')

      cy.contains('button', 'Add block').click()
      cy.contains('button', 'Drawable image').click()
      cy.get('input[placeholder="Question / label…"]').type('Mark where it hurts')

      cy.contains('button', 'Upload diagram').should('be.visible')
      cy.get('input[type="file"]').selectFile('cypress/fixtures/pain-diagram.svg', { force: true })

      // The button flipping to Replace is the block having taken a path; the
      // thumbnail is that path having resolved to something the bucket
      // actually serves back.
      cy.contains('button', 'Replace diagram', { timeout: 15000 }).should('be.visible')
      cy.get('img[alt="Diagram"]')
        .should('be.visible')
        .and(($img) => {
          expect(($img[0] as HTMLImageElement).naturalWidth, 'the uploaded diagram loads from the bucket').to.be.greaterThan(0)
          expect(($img[0] as HTMLImageElement).src, 'served from the doc-images bucket').to.contain('/doc-images/')
        })

      cy.contains('button', 'Save').click()

      // Reopening is the part that proves a path was stored rather than a
      // blob URL that only existed in that one page's memory.
      cy.reload()
      cy.contains('button', 'Mapa del dolor', { timeout: 15000 }).click()
      cy.contains('button', 'Replace diagram').should('be.visible')
      cy.get('img[alt="Diagram"]')
        .should('be.visible')
        .and(($img) => expect(($img[0] as HTMLImageElement).naturalWidth, 'the diagram survived the round trip').to.be.greaterThan(0))
    })
  })
})
