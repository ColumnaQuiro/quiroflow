// The two states of the signup form that are easy to break and impossible to
// see in a happy-path run: a taken email, and the wait while the account is
// being created.
//
// Both are driven by stubbing GoTrue rather than by creating real accounts --
// the duplicate-email case would otherwise need a permanent fixture account,
// and the loading case needs a request that never finishes.
describe('Signup form states', () => {
  const SIGNUP = '**/auth/v1/signup*'

  it('keeps the typed email and offers a way out when the address is taken', () => {
    cy.intercept('POST', SIGNUP, {
      statusCode: 400,
      body: { code: 400, error_code: 'user_already_exists', msg: 'User already registered' },
    }).as('signup')

    cy.visit('/signup')
    cy.get('#email').type('owner@example.test')
    cy.get('#password').type('valencia2026')
    cy.contains('button', 'Create account').click()
    cy.wait('@signup')

    // The message names the problem and links out of it, rather than echoing
    // GoTrue's own wording.
    cy.get('#email-error').should('be.visible').and('contain', 'already has a QuiroFlow account')
    cy.get('#email-error').find('a').should('have.attr', 'href', '/login')

    // Retyping an address you already typed is the thing that makes this
    // error infuriating, so the value stays and focus returns to it.
    cy.get('#email').should('have.value', 'owner@example.test')
    cy.get('#email').should('have.focus').and('have.attr', 'aria-invalid', 'true')
    cy.get('#email').should('have.attr', 'aria-describedby', 'email-error')
  })

  it('owns the wait in the button and refuses a second submit', () => {
    cy.intercept('POST', SIGNUP, (req) => {
      // Long enough that the assertions below run while it is still in flight.
      req.reply({ delay: 4000, statusCode: 400, body: { code: 400, msg: 'never mind' } })
    }).as('slowSignup')

    cy.visit('/signup')
    cy.get('#email').type(`states-${Date.now()}@example.test`)
    cy.get('#password').type('valencia2026')
    cy.contains('button', 'Create account').click()

    cy.contains('button', 'Creating account…')
      .should('be.disabled')
      .and('have.attr', 'aria-busy', 'true')

    // Readonly rather than disabled: the values stay readable and the fields
    // stay in the tab order while the request is out.
    cy.get('#email').should('have.attr', 'readonly')
    cy.get('#password').should('have.attr', 'readonly')

    // A second click cannot start a second signup.
    cy.contains('button', 'Creating account…').click({ force: true })
    cy.get('@slowSignup.all').should('have.length', 1)
  })

  it('shows and hides the password without losing what was typed', () => {
    cy.visit('/signup')
    cy.get('#password').type('valencia2026')
    cy.get('#password').should('have.attr', 'type', 'password')

    cy.contains('button', 'Show').click()
    cy.get('#password').should('have.attr', 'type', 'text').and('have.value', 'valencia2026')
    cy.contains('button', 'Hide').should('have.attr', 'aria-pressed', 'true')

    cy.contains('button', 'Hide').click()
    cy.get('#password').should('have.attr', 'type', 'password').and('have.value', 'valencia2026')
  })
})
