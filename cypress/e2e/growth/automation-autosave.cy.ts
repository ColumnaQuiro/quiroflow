import { autoSaved } from '../../support/autoSave'

// The automation builder saves itself: no Save button, a status that says
// where it stands, and the cases where saving on a timer would be wrong --
// a live automation half edited, a failed request, a second tab -- each
// stopping visibly rather than writing something nobody meant.

interface SeededAccount {
  email: string
  password: string
  accountId: string
}
interface Step {
  id: string
  action_type: string
  position: number
  config: Record<string, any>
}

const status = () => cy.get('[data-test="save-status"]', { timeout: 15000 })
const saved = () => autoSaved()

describe('Automation auto-save', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.intercept('GET', '**/api/whatsapp/templates*', { body: { templates: [] } })
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })
  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  function ruleWithTag(enabled: boolean, tag = 'antes') {
    return cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.completed',
      enabled,
      steps: [{ type: 'tag', config: { mode: 'add', tag } }],
    })
  }
  function openTagStep(ruleId: string) {
    cy.task<Step[]>('auto:actionsForRule', { ruleId }).then(([step]) => {
      cy.visit(`/automations/${ruleId}`)
      cy.get('[data-test="canvas-fit"]').click()
      cy.get(`[data-test="node-${step!.id}"]`).click({ force: true })
      cy.get('[data-test="tag-input"]').should('have.value', step!.config.tag)
    })
  }
  const storedTags = (ruleId: string) =>
    cy.task<Step[]>('auto:actionsForRule', { ruleId }).then((steps) => steps.filter((s) => s.action_type === 'tag').map((s) => s.config.tag))

  it('saves a paused automation as it is edited, with nothing to press', () => {
    ruleWithTag(false).then((rule) => {
      openTagStep(rule.id)
      cy.get('[data-test="save"]').should('not.exist')
      cy.get('[data-test="save-bar"]').should('not.exist')

      cy.get('[data-test="tag-input"]').clear().type('despues')
      status().should('contain', 'Saving')
      saved()
      status().should('contain', 'Saved')
      storedTags(rule.id).should('deep.eq', ['despues'])
      // Saving is not switching on.
      cy.task<{ enabled: boolean }>('auto:ruleRow', { ruleId: rule.id }).its('enabled').should('eq', false)
    })
  })

  it('saves on leaving the field, without waiting for the timer', () => {
    ruleWithTag(false).then((rule) => {
      openTagStep(rule.id)
      cy.intercept('PUT', `/api/automations/${rule.id}`).as('put')
      cy.get('[data-test="tag-input"]').clear().type('al-salir').blur()
      // Blur saves at once: well inside the typing delay.
      cy.wait('@put', { timeout: 1000 }).its('request.body.steps.0.config.tag').should('eq', 'al-salir')
      saved()
    })
  })

  it('never writes a half-made state of an automation that is on', () => {
    ruleWithTag(true).then((rule) => {
      openTagStep(rule.id)
      // A new step, not filled in yet: on a live automation that is not saved.
      cy.get('[data-test="insert-root-root-1"]').click({ force: true })
      cy.get('[data-test="add-step-tag"]').click()
      status().should('have.attr', 'data-state', 'held').and('contain', 'something is missing')
      storedTags(rule.id).should('deep.eq', ['antes'])

      // What is missing is one click away.
      cy.get('[data-test="save-review"]').click()
      cy.get('[data-test="problems-list"]').should('contain', 'A tag step has no tag')
      cy.get('[data-cy="confirm-dialog-cancel"]').click()

      // Complete again: it saves, and stays on.
      cy.get('[data-test="tag-input"]').type('nuevo')
      saved()
      storedTags(rule.id).should('deep.eq', ['antes', 'nuevo'])
      cy.task<{ enabled: boolean }>('auto:ruleRow', { ruleId: rule.id }).its('enabled').should('eq', true)
    })
  })

  it('says when a save failed, and retries it', () => {
    ruleWithTag(false).then((rule) => {
      openTagStep(rule.id)
      cy.intercept({ method: 'PUT', url: `/api/automations/${rule.id}`, times: 1 }, { statusCode: 500, body: { statusMessage: 'boom' } }).as('failed')
      cy.get('[data-test="tag-input"]').clear().type('reintento')
      cy.wait('@failed')
      status().should('have.attr', 'data-state', 'error').and('contain', 'Not saved')
      storedTags(rule.id).should('deep.eq', ['antes'])

      cy.get('[data-test="save-retry"]').click()
      saved()
      storedTags(rule.id).should('deep.eq', ['reintento'])
    })
  })

  it('asks before leaving what could not be saved', () => {
    ruleWithTag(false).then((rule) => {
      openTagStep(rule.id)
      cy.intercept('PUT', `/api/automations/${rule.id}`, { forceNetworkError: true })
      cy.get('[data-test="tag-input"]').clear().type('perdida')
      status().should('have.attr', 'data-state', 'error')
      cy.get('[data-test="back"]').click()
      cy.contains('Leave without saving').should('be.visible')
      cy.location('pathname').should('eq', `/automations/${rule.id}`)
    })
  })

  it('refuses to write over a copy saved elsewhere, and lets the person keep theirs', () => {
    ruleWithTag(false).then((rule) => {
      openTagStep(rule.id)

      // "Another tab": the same automation saved through the API meanwhile.
      cy.task<Record<string, any>>('auto:ruleRow', { ruleId: rule.id }).then((row) => {
        cy.task<Step[]>('auto:actionsForRule', { ruleId: rule.id }).then(([step]) => {
          cy.request('PUT', `/api/automations/${rule.id}`, {
            rule: row,
            steps: [{ ...step, config: { mode: 'add', tag: 'otra-pestana' }, parent_id: null, branch: null }],
          })
        })
      })

      cy.get('[data-test="tag-input"]').clear().type('esta-pestana')
      status().should('have.attr', 'data-state', 'conflict').and('contain', 'another tab')
      storedTags(rule.id).should('deep.eq', ['otra-pestana'])
      // Nothing more is written while it is unresolved.
      cy.get('[data-test="tag-input"]').type('-mas').blur()
      status().should('have.attr', 'data-state', 'conflict')
      storedTags(rule.id).should('deep.eq', ['otra-pestana'])

      // Keep mine: written over it, on purpose.
      cy.get('[data-test="conflict-keep"]').click()
      saved()
      storedTags(rule.id).should('deep.eq', ['esta-pestana-mas'])
    })
  })

  it('loads the other copy when the person chooses it', () => {
    ruleWithTag(false).then((rule) => {
      openTagStep(rule.id)
      cy.task<Record<string, any>>('auto:ruleRow', { ruleId: rule.id }).then((row) => {
        cy.task<Step[]>('auto:actionsForRule', { ruleId: rule.id }).then(([step]) => {
          cy.request('PUT', `/api/automations/${rule.id}`, {
            rule: row,
            steps: [{ ...step, config: { mode: 'add', tag: 'otra-pestana' }, parent_id: null, branch: null }],
          })
          cy.get('[data-test="tag-input"]').clear().type('esta-pestana')
          status().should('have.attr', 'data-state', 'conflict')
          cy.get('[data-test="conflict-reload"]').click()
          saved()
          cy.get('[data-test="canvas-fit"]').click()
          cy.get(`[data-test="node-${step!.id}"]`).click({ force: true })
          cy.get('[data-test="tag-input"]').should('have.value', 'otra-pestana')
          storedTags(rule.id).should('deep.eq', ['otra-pestana'])
        })
      })
    })
  })

  it('creates a new automation with its first change, not by opening one', () => {
    cy.intercept('POST', '/api/automations').as('create')
    cy.visit('/automations/new')
    cy.get('[data-test="automation-name"]', { timeout: 15000 }).should('be.visible')
    status().should('contain', 'Saves as you edit')
    // Opened and left alone: nothing is created.
    cy.wait(2500)
    cy.get('@create.all').should('have.length', 0)

    cy.get('[data-test="automation-name"]').clear().type('Creada al escribir')
    saved()
    cy.get('@create.all').should('have.length', 1)
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
    // Still the page being typed in, not a reload of it.
    cy.get('[data-test="automation-name"]').should('have.value', 'Creada al escribir').type(' y renombrada')
    saved()
    cy.location('pathname').then((path) => {
      cy.task<{ name: string; enabled: boolean }>('auto:ruleRow', { ruleId: path.split('/').pop() }).should((row) => {
        expect(row.name).to.eq('Creada al escribir y renombrada')
        expect(row.enabled).to.eq(false)
      })
    })
    cy.get('@create.all').should('have.length', 1)
  })
})
