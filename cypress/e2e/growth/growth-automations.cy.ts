// The Automations list -- what Campaigns and Growth > Automations were.
//
// The old Growth canvas spec asserted that the canvas drew the account's real
// rules, not fixtures; those assertions live on here against the list and the
// builder: nothing is invented for an empty account, a real rule is drawn as
// its trigger and steps, test mode is called test mode, and zero says zero.
// Added: the statistics are per automation (not joined by template name) and
// a test-mode message is not a send; the old URLs still land; and without
// Growth the lead automations are locked, not deleted.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

describe('Automations list', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })
  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  it('says there is nothing rather than drawing something', () => {
    cy.visit('/automations')
    cy.get('[data-test="empty"]').should('contain', 'No automations yet')
    cy.get('[data-test^="rule-"]').should('not.exist')
  })

  it('lists a real rule and draws it as its trigger and steps, in order', () => {
    cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      name: 'Bienvenida',
      triggerEvent: 'lead.created',
      dryRun: false,
      steps: [
        { type: 'whatsapp_template', config: { template_name: 'welcome_1', template_language: 'es', header: { type: 'video', storage_path: 'x/y.mp4' } } },
        { type: 'delay', config: { delay_minutes: 1440 } },
        { type: 'whatsapp_template', config: { template_name: 'welcome_day_2', template_language: 'es' } },
      ],
    }).then((rule) => {
      cy.visit('/automations')
      cy.get(`[data-test="rule-${rule.id}"]`).should('contain', 'Bienvenida').and('contain', 'New lead').and('contain', '3 steps')
      cy.get(`[data-test="rule-${rule.id}"] [data-test="badge-growth"]`).should('exist')
      // Zero says zero: a new automation has not run, and that is worth seeing.
      cy.get(`[data-test="rule-${rule.id}"] [data-test="stat-entered"]`).should('have.text', '0')

      cy.get(`[data-test="rule-${rule.id}"] [data-test="rule-link"]`).click()
      cy.location('pathname').should('eq', `/automations/${rule.id}`)
      cy.get('[data-test="canvas-fit"]').click()
      cy.get('[data-test="node-trigger"]').should('contain', 'New lead')
      cy.task<{ id: string; action_type: string; position: number }[]>('auto:actionsForRule', { ruleId: rule.id }).then((steps) => {
        cy.get(`[data-test="node-${steps[0]!.id}"]`).should('contain', 'welcome_1')
        cy.get(`[data-test="node-${steps[1]!.id}"]`).should('contain', 'Wait 1 day')
        cy.get(`[data-test="node-${steps[2]!.id}"]`).should('contain', 'welcome_day_2')
      })
      // Edges derived from where the nodes are: one into each step and one
      // into the end.
      cy.get('[data-test="flow-edges"] path').should('have.length', 4)
    })
  })

  it('calls test mode test mode, not active', () => {
    cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.completed',
      dryRun: true,
      steps: [{ type: 'whatsapp_template', config: { template_name: 'welcome_1' } }],
    }).then((rule) => {
      cy.visit('/automations')
      cy.get(`[data-test="rule-${rule.id}"] [data-test="badge-test"]`).should('contain', 'Test mode')
    })
  })

  it('counts each automation’s own sends, and a test-mode message is not a send', () => {
    // Two automations using ONE template. Campaigns joined sends to rules by
    // template name, so each reported the other's -- and a manual send of
    // it from the Inbox as theirs.
    cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Cifras' }).then((p) => {
      cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, name: 'Uno', triggerEvent: 'appointment.completed', dryRun: false, steps: [{ type: 'whatsapp_template', config: { template_name: 'shared' } }] }).then((a) => {
        cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, name: 'Dos', triggerEvent: 'appointment.booked', dryRun: false, steps: [{ type: 'whatsapp_template', config: { template_name: 'shared' } }] }).then((b) => {
          const seed = (ruleId: string | null, status: string) => cy.task('auto:seedWhatsAppMessage', { accountId: account.accountId, patientId: p.id, templateName: 'shared', status, ruleId })
          seed(a.id, 'read')
          seed(a.id, 'delivered')
          seed(a.id, 'would_send') // recorded in test mode: not a send
          seed(b.id, 'read')
          seed(b.id, 'read')
          seed(b.id, 'failed')
          seed(null, 'read') // an Inbox send of the same template: nobody's

          cy.visit('/automations')
          // Uno: two real sends, one read.
          cy.get(`[data-test="rule-${a.id}"] [data-test="stat-third"]`).should('have.text', '50 %')
          // Dos: two real sends, both read; the failed one is not a send.
          cy.get(`[data-test="rule-${b.id}"] [data-test="stat-third"]`).should('have.text', '100 %')

          cy.visit(`/automations/${a.id}`)
          cy.get('[data-test="rule-whatsapp-stats"]').should('be.visible').within(() => {
            cy.get('[data-test="rule-whatsapp-stats-Sent"]').should('contain', '2')
            cy.get('[data-test="rule-whatsapp-stats-Read"]').should('contain', '1')
          })
          cy.get('[data-test="rule-whatsapp-stats"]').should('contain', '1 recorded in test mode, not sent.')
        })
      })
    })
  })

  it('records which automation and step sent a message', () => {
    cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.completed',
      dryRun: true,
      steps: [{ type: 'whatsapp_template', config: { template_name: 'atribuida', template_language: 'es' } }],
    }).then((rule) => {
      cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Atribuida', phone: '612345678' }).then((p) => {
        cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.completed', patientId: p.id } })
        cy.task<{ id: string }[]>('auto:actionsForRule', { ruleId: rule.id }).then(([step]) => {
          cy.task<{ rule_id: string; automation_action_id: string; status: string }[]>('auto:whatsappForRule', { ruleId: rule.id }).then((rows) => {
            expect(rows).to.have.length(1)
            expect(rows[0]!.status).to.eq('would_send')
            expect(rows[0]!.automation_action_id).to.eq(step!.id)
          })
        })
      })
    })
  })

  it('still answers the old Campaigns and Growth > Automations URLs', () => {
    cy.visit('/campaigns')
    cy.location('pathname').should('eq', '/automations')
    cy.visit('/growth/automations?growth=1')
    cy.location('pathname').should('eq', '/automations')

    // A link to a failed run lands on that run, in its automation.
    cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, triggerEvent: 'appointment.completed', steps: [{ type: 'delay', config: { delay_minutes: 60 } }, { type: 'webhook', config: { url: 'https://example.invalid/x' } }] }).then((rule) => {
      cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Enlace' }).then((p) => {
        cy.request({ method: 'POST', url: '/api/automations/fire', body: { triggerEvent: 'appointment.completed', patientId: p.id } })
        cy.task<{ id: string }[]>('auto:runsForRule', { ruleId: rule.id }).then(([run]) => {
          cy.visit(`/growth/automations?tab=executions&run=${run!.id}`)
          cy.location('pathname').should('eq', `/automations/${rule.id}`)
          cy.location('search').should('contain', 'tab=people').and('contain', `run=${run!.id}`)
          cy.get('[data-test="run-detail"]').should('contain', 'Enlace')
        })
      })
    })
  })

  it('is in the main menu, under Patients, and not under Growth', () => {
    cy.visit('/automations')
    cy.get('nav').contains('a', 'Automations').should('have.attr', 'href', '/automations')
    cy.get('nav').contains('a', 'Campaigns').should('not.exist')
  })

  describe('without Growth', () => {
    beforeEach(() => {
      cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: false })
      cy.setSubscriptionStatus(account.accountId, 'active')
    })

    it('locks lead automations, keeps them as they are, and offers no lead steps elsewhere', () => {
      cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, name: 'Leads de Meta', triggerEvent: 'lead.created', enabled: true, steps: [{ type: 'lead_stage', config: { stage: 'contacted' } }] }).then((lead) => {
        cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, name: 'Pacientes', triggerEvent: 'appointment.completed', enabled: false, steps: [{ type: 'tag', config: { tag: 'x' } }] }).then((patientRule) => {
          cy.visit('/automations')
          cy.get(`[data-test="rule-${lead.id}"] [data-test="rule-toggle"]`).should('be.disabled').and('have.attr', 'aria-checked', 'false')
          cy.get(`[data-test="rule-${lead.id}"]`).should('contain', 'Paused · no Growth')
          // Saved as it was: not deleted, not rewritten.
          cy.task<{ enabled: boolean }>('auto:ruleRow', { ruleId: lead.id }).its('enabled').should('eq', true)

          cy.visit(`/automations/${lead.id}`)
          cy.get('[data-test="no-growth"]').should('contain', 'Lead automations are part of Growth')
          cy.get('[data-test="automation-enabled"]').should('be.disabled')
          cy.get('[data-test="insert-root-root-0"]').click({ force: true })
          cy.get('[data-test="add-step-lead_stage"]').should('have.attr', 'aria-disabled', 'true')

          // A patient automation offers no lead steps at all.
          cy.visit(`/automations/${patientRule.id}`)
          cy.get('[data-test="trigger-select"]').find('option[value="lead.created"]').should('be.disabled')
          cy.get('[data-test="insert-root-root-0"]').click({ force: true })
          cy.get('[data-test="add-step-menu"]').should('be.visible')
          cy.get('[data-test="add-step-lead_stage"]').should('not.exist')

          // And the API refuses to switch one on.
          cy.request({ method: 'POST', url: `/api/automations/${lead.id}/enabled`, body: { enabled: true }, failOnStatusCode: false }).its('status').should('eq', 422)
        })
      })
    })
  })
})
