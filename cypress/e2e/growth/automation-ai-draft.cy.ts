import { autoSaved } from '../../support/autoSave'
// The Automations page's "Create with AI". The model is stubbed (CI has no
// Anthropic key): what matters here is what the builder does with a draft --
// opens it switched off and saves it at once, paused, so leaving loses
// nothing and nothing is sent until someone switches it on.

// Fresh step ids for every test: the draft is saved now, and a step id
// already saved by another automation is refused.
const STEP = (run: string, n: number) => `${run}-0000-4000-8000-00000000000${n}`
const draftFor = (run: string) => ({
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
      { id: STEP(run, 1), action_type: 'delay', config: { delay_minutes: 129600 }, parent_id: null, branch: null, position: 0 },
      {
        id: STEP(run, 2),
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
})
let DRAFT = draftFor('00000000')

describe('Creating an automation with AI', () => {
  beforeEach(() => {
    DRAFT = draftFor(Cypress._.times(8, () => Cypress._.random(15).toString(16)).join(''))
    cy.intercept('GET', '**/api/whatsapp/templates*', { body: { templates: [] } })
    cy.seedStaffAccount().then((account) => cy.login(account.email, account.password))
    cy.visit('/automations')
    // Enabled once the page is hydrated: a click before that would do nothing.
    cy.get('[data-test="open-ai-draft"]', { timeout: 15000 }).should('be.visible').and('not.be.disabled')
  })

  it('opens the draft in the builder switched off, and saves it paused on its own', () => {
    cy.intercept('POST', '/api/automations/draft-automation', { statusCode: 200, body: DRAFT }).as('draft')
    cy.get('[data-test="open-ai-draft"]').click()
    cy.get('[data-cy="confirm-dialog-confirm"]').should('be.disabled')
    cy.contains('[data-test="automation-ai-dialog"] button', 'Check-up reminder').click()
    cy.get('[data-cy="confirm-dialog-confirm"]').click()
    cy.wait('@draft').its('request.body.description').should('contain', 'check-up')

    cy.get('[data-test="ai-draft-note"]').should('be.visible')
    cy.contains('[data-test^="node-"]', 'te toca revisión').should('be.visible')

    // Nobody presses anything: it is written, and the address becomes its own.
    autoSaved()
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

  it('keeps the draft when the person leaves straight away', () => {
    cy.intercept('POST', '/api/automations/draft-automation', { statusCode: 200, body: DRAFT }).as('draft')
    cy.get('[data-test="open-ai-draft"]').click()
    cy.get('[data-test="automation-ai-description"]').type('Recordatorio de revisión a los tres meses')
    cy.get('[data-cy="confirm-dialog-confirm"]').click()
    cy.wait('@draft')
    cy.get('[data-test="ai-draft-note"]').should('be.visible')
    // Back before the auto-save's own timer: leaving writes it first.
    cy.get('[data-test="back"]').click()
    cy.contains('Leave without saving').should('not.exist')
    cy.location('pathname').should('eq', '/automations')
    cy.contains('Revisión a los 3 meses', { timeout: 15000 }).should('be.visible')
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
