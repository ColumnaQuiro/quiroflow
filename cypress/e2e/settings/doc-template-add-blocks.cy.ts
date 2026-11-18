// The "Add block" menu of the form/document template builder. It used to
// float (`absolute`) under its button, and the button is the last thing in an
// `overflow-hidden` card, so the menu was clipped down to its top edge: on an
// empty template the first type ("Heading") peeked out above the card's
// bottom, and once that block existed nothing else could be added -- on a
// desktop and on a tablet alike.
//
// Neither `be.visible` nor a scroll-then-hit-test catches that. Cypress only
// calls an element hidden by an ancestor's overflow when it is ENTIRELY
// outside it, and the menu was mostly, not entirely, cut off. And Cypress's
// scrollIntoView (also run by every .click()) scrolls an `overflow: hidden`
// box from the inside -- which a person cannot do -- so an item "scrolled
// into view" that way looks reachable when it is not. That is how the
// drawable-image spec kept passing through the bug.
//
// So the check is geometric: put every clipping ancestor back where a person
// would see it (scrolled to 0; they have no way to scroll it), and require the
// item to sit wholly inside each one.

const ALL_TYPES = [
  'Heading', 'Text', 'Short answer', 'Long answer', 'Checkbox', 'Options',
  'Number scale', 'Rating', 'Date', 'Signature', 'Drawable image',
]

function expectReachable(label: string) {
  cy.get('[data-cy="doc-add-block-menu"]')
    .contains('button', label)
    .should(($btn) => {
      const item = $btn[0]
      for (let box = item.parentElement; box; box = box.parentElement) {
        const style = getComputedStyle(box)
        if (![style.overflowX, style.overflowY].some((v) => v === 'hidden' || v === 'clip')) continue
        box.scrollTop = 0
        box.scrollLeft = 0
        const r = item.getBoundingClientRect()
        const b = box.getBoundingClientRect()
        const inside = r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5 && r.left >= b.left - 0.5 && r.right <= b.right + 0.5
        expect(inside, `"${label}" is not clipped by <${box.tagName.toLowerCase()} class="${box.className}">`).to.equal(true)
      }
    })
}

function addBlock(label: string) {
  cy.get('[data-cy="doc-add-block"]').scrollIntoView().click()
  expectReachable(label)
  cy.get('[data-cy="doc-add-block-menu"]').contains('button', label).click()
  cy.get('[data-cy="doc-add-block-menu"]').should('not.exist')
}

const SIZES: Array<{ name: string; width: number; height: number }> = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
]

describe('Adding blocks to a document template', () => {
  SIZES.forEach(({ name, width, height }) => {
    it(`offers every block type and shows each block added (${name})`, () => {
      cy.viewport(width, height)
      cy.seedStaffAccount().then((account) => {
        cy.login(account.email, account.password)
        cy.visit('/settings/docs')

        // New Template inserts as the signed-in account, which the page only
        // knows once the account store has loaded.
        cy.contains('No templates yet.', { timeout: 15000 }).should('be.visible')
        cy.contains('button', 'New Template').click()
        cy.get('input[placeholder="Untitled template"]', { timeout: 15000 }).clear().type('Data protection')

        // The case the clinic hit: one block already there, then the menu.
        addBlock('Heading')
        cy.get('input[placeholder="Heading text…"]').should('have.length', 1).type('DATA PROTECTION')

        cy.get('[data-cy="doc-add-block"]').scrollIntoView().click()
        ALL_TYPES.forEach(expectReachable)
        cy.get('[data-cy="doc-add-block"]').click()

        addBlock('Text')
        addBlock('Signature')

        cy.get('textarea[placeholder="Text content…"]').scrollIntoView().should('be.visible')
        cy.contains('Signature').scrollIntoView().should('be.visible')
        cy.get('input[placeholder="Heading text…"]').should('have.value', 'DATA PROTECTION')
      })
    })
  })
})
