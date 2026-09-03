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
    cy.contains('button', 'Create practice').click()

    cy.contains('h1', 'Make it yours', { timeout: 15000 }).should('be.visible')
    cy.contains('button', 'Continue').click()

    cy.contains('h1', "You're all set", { timeout: 15000 }).should('be.visible')
    cy.contains('button', 'Get started').click()

    cy.location('pathname', { timeout: 15000 }).should('eq', '/dashboard')
    // Greeting is time-of-day dependent ("Good morning/afternoon/evening, {firstName}") -- match loosely.
    cy.contains(new RegExp(`Good (morning|afternoon|evening), ${ownerName.split(' ')[0]}`)).should('be.visible')
    cy.contains(accountName).should('be.visible')

    // A fresh account isn't stuck re-onboarding on the next visit.
    cy.visit('/dashboard')
    cy.location('pathname').should('eq', '/dashboard')
    cy.contains(accountName).should('be.visible')
  })
})
