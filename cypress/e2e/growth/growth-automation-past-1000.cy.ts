// Automations on a clinic with more than a thousand of something.
//
// PostgREST stops an unpaged select at 1000 rows and says nothing: no error,
// no flag, just a short list that reads as the whole answer. Three places the
// automation engine reads "everyone" were written that way, so on a clinic
// past 1000 patients (Columnaquiro has over 1,500) a segment enrolled whoever
// came back first and silently skipped the rest, its re-entry guard forgot
// who it had just enrolled, and saving a rule miscounted the people standing
// on a step it was about to remove.
//
// 1,050 rather than 1,001: enough that a page boundary anywhere near 1000 is
// crossed by a margin a flaky count could not explain.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const CROWD = 1050

describe('Automations past a thousand rows', () => {
  let account: SeededAccount
  let patientIds: string[]
  const rules: string[] = []

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.task<{ patientIds: string[] }>('db:seedManyPatients', { accountId: account.accountId, clinicId: account.clinicId, count: CROWD }, { timeout: 120000 }).then(
        (seededPatients) => {
          patientIds = seededPatients.patientIds
        },
      )
    })
  })

  afterEach(() => {
    // A thousand due runs left behind would sit at the front of every other
    // spec's tick, ordered by resume_at, and push their runs out of it.
    for (const ruleId of rules.splice(0)) cy.task('auto:cancelRunsForRule', { ruleId })
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  function tick() {
    return cy
      .request({
        method: 'POST',
        url: '/api/automations/lead-sequence-cron',
        headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' },
        timeout: 180000,
      })
      .its('status')
      .should('eq', 200)
  }

  it('enrols every patient a segment matches, and does not enrol them again inside the re-entry window', () => {
    cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent: 'segment',
      // Every day at midnight, so a clock put back two days is always due.
      segment: { filters: {}, schedule: { kind: 'daily', time: '00:00' }, reentry_days: 30 },
      steps: [{ type: 'tag', config: { tag: 'many' } }],
    }).then((rule) => {
      rules.push(rule.id)
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()

      cy.task('auto:setSegmentLastRunAt', { ruleId: rule.id, at: twoDaysAgo })
      tick()
      cy.task<number>('auto:countRunsForRule', { ruleId: rule.id }).should('eq', CROWD)

      // Due again, and every one of them was enrolled inside the last 30
      // days. The guard reads who it enrolled; reading only the first 1000
      // of them let the other 50 straight back in.
      cy.task('auto:setSegmentLastRunAt', { ruleId: rule.id, at: twoDaysAgo })
      tick()
      cy.task<number>('auto:countRunsForRule', { ruleId: rule.id }).should('eq', CROWD)
    })
  })

  it('counts every person on a step that a save would remove', () => {
    cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent: 'appointment.completed',
      steps: [
        { type: 'delay', config: { delay_minutes: 2880 } },
        { type: 'tag', config: { tag: 'despues' } },
      ],
    }).then((rule) => {
      rules.push(rule.id)
      cy.task<{ id: string; action_type: string }[]>('auto:actionsForRule', { ruleId: rule.id }).then((steps) => {
        const wait = steps.find((s) => s.action_type === 'delay')!
        cy.task('auto:parkPatientRuns', { accountId: account.accountId, ruleId: rule.id, actionId: wait.id, nextPosition: 1, patientIds }, { timeout: 120000 })
      })

      cy.login(account.email, account.password)
      cy.request<{ rule: Record<string, unknown>; steps: { id: string; action_type: string }[] }>(`/api/automations/${rule.id}`).then(({ body }) => {
        cy.request({
          method: 'PUT',
          url: `/api/automations/${rule.id}`,
          body: { rule: body.rule, steps: body.steps.filter((s) => s.action_type !== 'delay'), enabled: false },
          failOnStatusCode: false,
          timeout: 120000,
        }).then((res) => {
          expect(res.status).to.eq(409)
          const people = (res.body.data?.people ?? []) as { count: number }[]
          expect(people.reduce((sum, p) => sum + p.count, 0), 'everybody waiting there').to.eq(CROWD)
        })
      })

      // Taking them out reaches every one of them, not the first thousand.
      cy.request<{ rule: Record<string, unknown>; steps: { id: string; action_type: string }[] }>(`/api/automations/${rule.id}`).then(({ body }) => {
        cy.request({
          method: 'PUT',
          url: `/api/automations/${rule.id}`,
          body: { rule: body.rule, steps: body.steps.filter((s) => s.action_type !== 'delay'), enabled: false, removedPolicy: 'take_out' },
          timeout: 180000,
        }).then((res) => {
          expect(res.body.takenOut).to.eq(CROWD)
        })
      })
      cy.task<number>('auto:countRunsForRule', { ruleId: rule.id, status: 'running' }).should('eq', 0)
    })
  })
})
