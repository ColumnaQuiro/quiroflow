// Waiting for an auto-saved editor (useAutoSave / UiAutoSaveStatus) to have
// written everything on screen.
//
// Not just "the status says saved": right after a change, it still does. Vue
// marks the status pending, and re-renders it, on the microtask after the
// change -- and Cypress can run the next assertion before that. A select
// changed straight after an earlier save landed therefore read "saved" from
// that earlier save, and the spec went on to read the database before the
// change had even been sent (a wait stored as 2 days, not 2 hours). One
// macrotask in the app's own window lets the page catch up first, so "saved"
// is the state after this change, not before it.
export function autoSaved(timeout = 15000) {
  cy.window({ log: false }).then((win) => new Cypress.Promise<void>((resolve) => win.setTimeout(resolve, 0)))
  return cy.get('[data-test="save-status"]', { timeout }).should('have.attr', 'data-state', 'saved')
}
