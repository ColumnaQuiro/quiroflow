import { faker } from '@faker-js/faker'

describe('Signup and onboarding', () => {
  it('signs up, completes onboarding, and lands on the dashboard with a working account', () => {
    const email = `signup-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`
    const password = 'Test1234!'
    const ownerName = faker.person.fullName()
    const accountName = `${faker.company.name()} Clinic`
    const clinicName = faker.location.city()

    cy.visit('/signup')
    cy.get('#email').type(email)
    cy.get('#password').type(password)
    cy.contains('button', 'Create account').click()

    cy.location('pathname', { timeout: 15000 }).should('eq', '/onboarding')

    cy.get('#owner-name').type(ownerName)
    cy.get('#account-name').type(accountName)
    cy.get('#clinic-name').type(clinicName)

    // The right panel mirrors the two fields that build the booking URL, so a
    // clinic can see what it is about to be called before committing to it.
    cy.contains(`quiroflow.app/`).should('exist')
    cy.contains(accountName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).should('exist')

    // The phone country is asked here rather than assumed, because every
    // number the account later stores without one falls back to it. Picking
    // a non-default proves the choice actually reaches the account.
    //
    // Driven entirely from the keyboard: this replaced a native <select>, and
    // a custom combobox that can only be used with a mouse would be a
    // regression no visual check would catch.
    cy.get('#phone-country').focus().type('{enter}')
    cy.get('#phone-country').should('have.attr', 'aria-expanded', 'true')

    // Escape closes it and hands focus back to the trigger rather than
    // dropping it at the top of the document.
    cy.focused().type('{esc}')
    cy.get('#phone-country').should('have.attr', 'aria-expanded', 'false').and('have.focus')

    // Reopen, filter by name, and take the first match with Enter.
    cy.get('#phone-country').type('{enter}')
    cy.focused().type('Portugal')
    cy.get('#phone-country-listbox').find('[role="option"]').first().should('contain', 'Portugal')
    cy.focused().type('{enter}')
    cy.get('#phone-country').should('contain', '+351').and('have.attr', 'aria-expanded', 'false')

    // Arrows open it and move between options, so the list is reachable
    // without knowing what to type.
    cy.get('#phone-country').focus().type('{downarrow}')
    cy.get('#phone-country').should('have.attr', 'aria-expanded', 'true')
    cy.focused().type('{esc}')
    cy.get('#phone-country').should('contain', '+351')

    cy.contains('button', 'Create practice').click()

    cy.contains('h1', 'Make QuiroFlow yours', { timeout: 15000 }).should('be.visible')

    // Back returns to step 2 with every answer kept. By this point the account
    // exists, and create_account_with_owner refuses a second one outright, so
    // submitting again has to edit what is there rather than re-run the RPC --
    // the button label is what says which of the two is about to happen.
    const renamed = `${accountName} Renamed`
    cy.contains('button', 'Back').click()
    cy.contains('h1', 'Set up your practice').should('be.visible')
    cy.get('#owner-name').should('have.value', ownerName)
    cy.get('#account-name').should('have.value', accountName)
    cy.get('#phone-country').should('contain', '+351')
    cy.get('#account-name').clear().type(renamed)
    cy.contains('button', 'Save and continue').click()

    cy.contains('h1', 'Make QuiroFlow yours', { timeout: 15000 }).should('be.visible')
    cy.contains('button', 'Continue').click()

    cy.contains('h1', "You're all set", { timeout: 15000 }).should('be.visible')
    // The rename reached the account rather than being dropped by a submit
    // that only knows how to create.
    cy.contains(renamed).should('be.visible')
    cy.contains('button', 'Get started').click()

    cy.location('pathname', { timeout: 15000 }).should('eq', '/dashboard')
    // Greeting is time-of-day dependent ("Good morning/afternoon/evening, {firstName}") -- match loosely.
    cy.contains(new RegExp(`Good (morning|afternoon|evening), ${ownerName.split(' ')[0]}`)).should('be.visible')
    cy.contains(accountName).should('be.visible')

    // A fresh account isn't stuck re-onboarding on the next visit.
    cy.visit('/dashboard')
    cy.location('pathname').should('eq', '/dashboard')
    cy.contains(accountName).should('be.visible')

    // The country chosen during onboarding is what a new number defaults to
    // -- not Spain, which is what every account got before it was asked.
    cy.visit('/settings/communications-general')
    cy.get('select').filter(':visible').then(($selects) => {
      const withPortugal = [...$selects].find((el) => (el as HTMLSelectElement).value === 'PT')
      expect(withPortugal, 'a country select showing Portugal').to.not.equal(undefined)
    })
  })
})
