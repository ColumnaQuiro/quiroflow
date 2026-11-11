// The email editor's "Write with AI". The model is stubbed (CI has no
// Anthropic key): what matters here is what the editor does with a draft --
// asks before replacing what the email already says, puts the blocks and the
// subject in the step, and keeps it only when the automation is saved.

const DRAFT = {
  available: true,
  draft: {
    subject: '{{first_name}}, gracias por venir',
    design: {
      version: 1,
      preheader: 'Te esperamos en tu próxima visita',
      blocks: [
        { id: 'x1', type: 'header', align: 'center' },
        { id: 'x2', type: 'heading', text: 'Gracias, {{first_name}}', align: 'left' },
        { id: 'x3', type: 'text', html: '<p>Ha sido un placer verte en tu primera visita.</p>' },
        { id: 'x4', type: 'button', text: 'Reservar la siguiente', link: { kind: 'booking' }, align: 'center' },
        { id: 'x5', type: 'footer', html: '<p>{{clinic_name}}</p>' },
      ],
    },
  },
}

describe('Writing an automation email with AI', () => {
  const canvas = () => cy.get('[data-test="email-builder-canvas"]').its('0.contentDocument.body').should('not.be.empty')

  beforeEach(() => {
    cy.intercept('GET', '**/api/whatsapp/templates*', { body: { templates: [] } })
    cy.seedStaffAccount().then((account) => cy.login(account.email, account.password))
    cy.visit('/automations/new')
    cy.get('[data-test="node-trigger"]').should('be.visible')
    cy.get('[data-test="insert-root-root-0"]').should('be.visible').click()
    cy.get('[data-test="add-step-email"]').click()
    cy.get('[data-test="email-builder"]').should('be.visible')
  })

  it('asks before replacing the email, then fills in the blocks and the subject', () => {
    cy.intercept('POST', '/api/automations/draft-email', { statusCode: 200, body: DRAFT }).as('draft')
    cy.get('[data-test="email-tab-templates"]').click()
    cy.get('[data-test="email-ai-go"]').should('be.disabled')
    cy.get('[data-test="email-ai-description"]').type('Agradece su primera visita')
    cy.get('[data-test="email-ai-go"]').click()
    cy.wait('@draft').its('request.body').should('deep.include', { description: 'Agradece su primera visita', trigger: 'appointment.completed', marketing: false })

    // A new email already has words in it, so it asks first, like a template.
    cy.get('[data-test="email-template-confirm"]').should('be.visible')
    cy.get('[data-test="email-template-confirm-yes"]').click()

    cy.get('[data-test="email-block-list"] li').should('have.length', 5)
    canvas().should('contain', 'Gracias, Lucía').and('contain', 'Reservar la siguiente')
    cy.get('[data-test="email-builder-subject"]').should('have.value', '{{first_name}}, gracias por venir')
    cy.get('[data-test="email-builder-preheader"]').should('have.value', 'Te esperamos en tu próxima visita')

    // Kept only by the automation's own Save.
    cy.get('[data-test="email-builder-done"]').click()
    cy.get('[data-test="save"]').click()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
    cy.location('pathname').then((path) => {
      cy.task<{ config: Record<string, any> }[]>('auto:actionsForRule', { ruleId: path.split('/').pop() }).should((rows) => {
        const email = rows.find((r) => r.config.design)!
        expect(email.config.subject).to.eq('{{first_name}}, gracias por venir')
        expect(email.config.design.blocks.map((x: { type: string }) => x.type)).to.deep.eq(['header', 'heading', 'text', 'button', 'footer'])
      })
    })
  })

  it('keeps the email as it was when the person says no', () => {
    cy.intercept('POST', '/api/automations/draft-email', { statusCode: 200, body: DRAFT }).as('draft')
    cy.get('[data-test="email-tab-templates"]').click()
    cy.get('[data-test="email-ai-description"]').type('Agradece su primera visita')
    cy.get('[data-test="email-ai-go"]').click()
    cy.wait('@draft')
    cy.contains('[data-test="email-template-confirm"] button', 'Keep mine').click()
    cy.get('[data-test="email-template-confirm"]').should('not.exist')
    canvas().should('not.contain', 'Gracias, Lucía')
  })

  it('says so when writing with AI is unavailable', () => {
    // Not stubbed: without an Anthropic key (as in CI) the route says it is not available.
    cy.get('[data-test="email-tab-templates"]').click()
    cy.get('[data-test="email-ai-description"]').type('Recuérdale que le toca revisión')
    cy.get('[data-test="email-ai-go"]').click()
    cy.get('[data-test="email-ai-error"]').should('contain', 'not available')
    cy.get('[data-test="email-ai-description"]').should('have.value', 'Recuérdale que le toca revisión')
  })
})
