// The Automations page's "Create with AI". The model is stubbed (CI has no
// Anthropic key): what matters here is what the builder does with a draft --
// opens it unsaved and switched off, treats leaving as losing work, and
// keeps it only through its own Save, paused.

const STEP = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const DRAFT = {
  available: true,
  draft: {
    rule: {
      name: 'Revisión a los 3 meses',
      trigger_event: 'appointment.completed',
      filters: {},
      is_marketing: false,
      dry_run: false,
      entry_mode: 'one_at_a_time',
      exit_on: ['appointment.booked'],
      quiet_hours: null,
      segment: null,
    },
    steps: [
      { id: STEP(1), action_type: 'delay', config: { delay_minutes: 129600 }, parent_id: null, branch: null, position: 0 },
      {
        id: STEP(2),
        action_type: 'email',
        config: {
          subject: '{{first_name}}, te toca revisión',
          body: '',
          design: { version: 1, blocks: [{ id: 'e1', type: 'text', html: '<p>Hola {{first_name}}, ya han pasado tres meses.</p>' }, { id: 'e2', type: 'button', text: 'Reservar', link: { kind: 'booking' }, align: 'center' }] },
        },
        parent_id: null,
        branch: null,
        position: 1,
      },
    ],
  },
}

describe('Creating an automation with AI', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/whatsapp/templates*', { body: { templates: [] } })
    cy.seedStaffAccount().then((account) => cy.login(account.email, account.password))
    cy.visit('/automations')
    cy.get('[data-test="open-ai-draft"]', { timeout: 15000 }).should('be.visible')
  })

  it('opens the draft in the builder unsaved and switched off, and saves it paused', () => {
    cy.intercept('POST', '/api/automations/draft-automation', { statusCode: 200, body: DRAFT }).as('draft')
    cy.get('[data-test="open-ai-draft"]').click()
    cy.get('[data-cy="confirm-dialog-confirm"]').should('be.disabled')
    cy.contains('[data-test="automation-ai-dialog"] button', 'Check-up reminder').click()
    cy.get('[data-cy="confirm-dialog-confirm"]').click()
    cy.wait('@draft').its('request.body.description').should('contain', 'check-up')

    cy.location('pathname').should('eq', '/automations/new')
    cy.get('[data-test="ai-draft-note"]').should('be.visible')
    cy.contains('[data-test^="node-"]', 'te toca revisión').should('be.visible')
    cy.get('[data-test="saved-at"]').should('contain', 'Unsaved changes')

    cy.get('[data-test="save"]').click()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
    cy.location('pathname').then((path) => {
      cy.task<{ action_type: string; config: Record<string, any> }[]>('auto:actionsForRule', { ruleId: path.split('/').pop() }).should((rows) => {
        expect(rows.map((r) => r.action_type).sort()).to.deep.eq(['delay', 'email'])
      })
    })
    // Saved, and still not running.
    cy.visit('/automations')
    cy.contains('Revisión a los 3 meses', { timeout: 15000 }).should('be.visible')
  })

  it('asks before throwing the draft away', () => {
    cy.intercept('POST', '/api/automations/draft-automation', { statusCode: 200, body: DRAFT }).as('draft')
    cy.get('[data-test="open-ai-draft"]').click()
    cy.get('[data-test="automation-ai-description"]').type('Recordatorio de revisión a los tres meses')
    cy.get('[data-cy="confirm-dialog-confirm"]').click()
    cy.wait('@draft')
    cy.get('[data-test="ai-draft-note"]').should('be.visible')
    cy.go('back')
    cy.contains('Leave without saving').should('be.visible')
  })

  it('says so when creating with AI is unavailable', () => {
    // Not stubbed: without an Anthropic key (as in CI) the route says it is not available.
    cy.get('[data-test="open-ai-draft"]').click()
    cy.get('[data-test="automation-ai-description"]').type('Avisar a quien no viene a su cita')
    cy.get('[data-cy="confirm-dialog-confirm"]').click()
    cy.get('[data-test="automation-ai-error"]').should('contain', 'not available')
    cy.location('pathname').should('eq', '/automations')
  })
})
