// A drip that waits, and stops when it should.
//
// The engine everywhere else fires a rule and runs it to completion, so this
// is the first automation with anything in flight. What is worth testing is
// almost entirely the stopping: a sequence that sends is easy, a sequence
// that knows when to shut up is the product.
//
// No WhatsApp is sent in any of these -- the account has no Meta credentials,
// so each WhatsApp step is recorded as skipped ("WhatsApp is not connected")
// and the drip carries on. That is deliberate: these test the sequencing, not
// the delivery. A step that genuinely FAILS is exercised with a webhook
// pointed at a closed port, which fails the same way offline and in CI.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface Run {
  id: string
  status: string
  attempts: number
  last_error: string | null
  next_position: number
  stopped_reason: string | null
  resume_at: string
}

describe('Lead welcome sequences', () => {
  let account: SeededAccount
  let token: string

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['leads:write'] }).then((t) => {
        token = t.token
      })
    })
  })

  afterEach(() => {
    cy.task('db:stopPracticeHubStub')
  })

  function ingest(body: Record<string, unknown>) {
    return cy.request({
      method: 'POST',
      url: '/api/public/v1/leads',
      headers: { Authorization: `Bearer ${token}` },
      body: { marketing_consent: true, ...body },
    })
  }

  // Not failOnStatusCode:false -- a 401 from a missing NUXT_CRON_SECRET would
  // leave every run still 'running' and turn the stop assertions below into
  // tests of nothing.
  function runCron() {
    return cy
      .request({
        method: 'POST',
        url: '/api/automations/lead-sequence-cron',
        headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' },
      })
      .its('status')
      .should('eq', 200)
  }

  function threeStepDrip() {
    return cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'lead.created',
      isMarketing: true,
      actions: [
        { type: 'whatsapp_template', config: { template_name: 'welcome_1', template_language: 'es' } },
        { type: 'delay', config: { delay_minutes: 1440 } },
        { type: 'whatsapp_template', config: { template_name: 'welcome_day_2', template_language: 'es' } },
      ],
    })
  }

  it('starts a sequence the moment the lead arrives, and parks it at the delay', () => {
    threeStepDrip()
    ingest({ full_name: 'Drip Starts', phone: '+34600900001', external_id: 'seq-1' }).then((res) => {
      cy.task<Run[]>('db:sequenceRuns', { leadId: res.body.data.id }).then((runs) => {
        expect(runs).to.have.length(1)
        expect(runs[0]!.status).to.eq('running')
        // Ran action 0, hit the delay at 1, and is waiting to resume at 2.
        expect(runs[0]!.next_position).to.eq(2)
        // Roughly a day out, not immediately.
        expect(new Date(runs[0]!.resume_at).getTime()).to.be.greaterThan(Date.now() + 23 * 3600 * 1000)
      })
    })
  })

  it('never starts a second sequence for the same lead and rule', () => {
    threeStepDrip()
    const body = { full_name: 'Only Once', phone: '+34600900002', external_id: 'seq-dedupe' }

    ingest(body).then((first) => {
      // A redelivery. The lead dedupes, and the drip must not start again --
      // a second run would mean the same person receiving it twice.
      ingest(body).then((second) => {
        expect(second.body.data.deduplicated).to.eq(true)
        cy.task<Run[]>('db:sequenceRuns', { leadId: first.body.data.id }).then((runs) => {
          expect(runs).to.have.length(1)
        })
      })
    })
  })

  it('stops when the lead becomes a patient, even if nobody moved the card', () => {
    // The case a stage check alone misses: booked in at the desk, so the
    // person is a patient while the lead still says "new".
    cy.task('db:createPatient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Already',
      lastName: 'Booked',
      phone: '600900003',
    })

    threeStepDrip()
    ingest({ full_name: 'Already Booked', phone: '+34600900003', external_id: 'seq-patient' }).then((res) => {
      cy.task('db:makeSequenceDue', { leadId: res.body.data.id })
      runCron()

      cy.task<Run[]>('db:sequenceRuns', { leadId: res.body.data.id }).then((runs) => {
        expect(runs[0]!.status).to.eq('cancelled')
        expect(runs[0]!.stopped_reason).to.eq('already_a_patient')
      })
    })
  })

  it('stops when the lead is marked lost', () => {
    threeStepDrip()
    ingest({ full_name: 'Gone Cold', phone: '+34600900004', external_id: 'seq-lost' }).then((res) => {
      const id = res.body.data.id
      cy.task('db:setLeadStage', { id, stage: 'lost' })
      cy.task('db:makeSequenceDue', { leadId: id })
      runCron()

      cy.task<Run[]>('db:sequenceRuns', { leadId: id }).then((runs) => {
        expect(runs[0]!.status).to.eq('cancelled')
        expect(runs[0]!.stopped_reason).to.eq('lost')
      })
    })
  })

  it('finishes the sequence once the last step has run', () => {
    threeStepDrip()
    ingest({ full_name: 'Runs To End', phone: '+34600900005', external_id: 'seq-end' }).then((res) => {
      const id = res.body.data.id
      cy.task('db:makeSequenceDue', { leadId: id })
      runCron()

      cy.task<Run[]>('db:sequenceRuns', { leadId: id }).then((runs) => {
        expect(runs[0]!.status).to.eq('done')
      })
    })
  })

  it('defers rather than sending or stopping when PracticeHub cannot be reached', () => {
    // The third answer. Carrying on risks messaging somebody who booked in
    // PracticeHub last week; stopping risks cancelling every drip because a
    // third party had a bad afternoon. So neither: try again next tick.
    cy.task('db:setPracticeHubConnection', { accountId: account.accountId, baseUrl: 'http://127.0.0.1:9' })

    threeStepDrip()
    ingest({ full_name: 'Practicehub Down', phone: '+34600900008', email: 'ph.down@example.com', external_id: 'seq-ph-down' }).then((res) => {
      const id = res.body.data.id
      cy.task('db:makeSequenceDue', { leadId: id })
      runCron()

      cy.task<Run[]>('db:sequenceRuns', { leadId: id }).then((runs) => {
        // Still alive, not cancelled -- and pushed out rather than retried
        // in a tight loop.
        expect(runs[0]!.status).to.eq('running')
        expect(runs[0]!.stopped_reason).to.be.null
        expect(new Date(runs[0]!.resume_at).getTime()).to.be.greaterThan(Date.now())
      })
    })
  })

  it('keeps the drip going when PracticeHub answers about somebody else', () => {
    // The regression that silently switched the whole drip off. The old check
    // read total_entries and stopped on any non-zero count, which is only the
    // right question if PracticeHub applies `email` as a filter. When it does
    // not, the response is the entire patient list -- thousands of rows, none
    // of them this lead -- and every real lead was cancelled as
    // already_a_patient within a second of arriving. Three did, on the first
    // night of real Facebook traffic.
    cy.task<{ baseUrl: string }>('db:startPracticeHubStub', {
      totalEntries: 4213,
      emails: ['someone.else@example.com'],
    }).then(({ baseUrl }) => {
      cy.task('db:setPracticeHubConnection', { accountId: account.accountId, baseUrl })

      threeStepDrip()
      ingest({ full_name: 'Not Their Patient', phone: '+34600900011', email: 'not.theirs@example.com', external_id: 'seq-ph-mismatch' }).then((res) => {
        const id = res.body.data.id
        cy.task('db:makeSequenceDue', { leadId: id })
        runCron()

        cy.task<Run[]>('db:sequenceRuns', { leadId: id }).then((runs) => {
          expect(runs[0]!.stopped_reason).to.be.null
          expect(runs[0]!.status).to.not.eq('cancelled')
        })
      })
    })
  })

  it('stops when PracticeHub returns the lead themselves', () => {
    // The other half: when the row really is this person, the drip must stop.
    // Dual-running means PracticeHub holds patients QuiroFlow has never seen,
    // so this check earns its place -- it just has to be right.
    cy.task<{ baseUrl: string }>('db:startPracticeHubStub', {
      totalEntries: 1,
      emails: ['THEIR.patient@example.com'],
    }).then(({ baseUrl }) => {
      cy.task('db:setPracticeHubConnection', { accountId: account.accountId, baseUrl })

      threeStepDrip()
      // Deliberately cased differently from the stub's row -- an email match
      // that only works when the casing agrees is not a match.
      ingest({ full_name: 'Their Patient', phone: '+34600900012', email: 'their.patient@example.com', external_id: 'seq-ph-match' }).then((res) => {
        const id = res.body.data.id
        cy.task('db:makeSequenceDue', { leadId: id })
        runCron()

        cy.task<Run[]>('db:sequenceRuns', { leadId: id }).then((runs) => {
          expect(runs[0]!.status).to.eq('cancelled')
          expect(runs[0]!.stopped_reason).to.eq('already_a_patient')
        })
      })
    })
  })

  it('skips the PracticeHub check entirely when no connection is configured', () => {
    // Not configured is not the same as unreachable: a clinic that never used
    // PracticeHub must not have its drips deferred forever.
    threeStepDrip()
    ingest({ full_name: 'No Practicehub', phone: '+34600900009', email: 'none@example.com', external_id: 'seq-ph-none' }).then((res) => {
      const id = res.body.data.id
      cy.task('db:makeSequenceDue', { leadId: id })
      runCron()
      cy.task<Run[]>('db:sequenceRuns', { leadId: id }).then((runs) => {
        expect(runs[0]!.status).to.eq('done')
      })
    })
  })

  it('records what it would send instead of sending, in dry run', () => {
    cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'lead.created',
      isMarketing: true,
      dryRun: true,
      actions: [{ type: 'whatsapp_template', config: { template_name: 'welcome_1', template_language: 'es' } }],
    })

    ingest({ full_name: 'Dry Run', phone: '+34600900010', external_id: 'seq-dry' }).then((res) => {
      cy.task<{ status: string; template_name: string; wamid: string | null }[]>('db:leadMessages', { leadId: res.body.data.id }).then((msgs) => {
        expect(msgs).to.have.length(1)
        expect(msgs[0]!.status).to.eq('would_send')
        expect(msgs[0]!.template_name).to.eq('welcome_1')
        // Nothing reached Meta, so there is no message id to show for it.
        expect(msgs[0]!.wamid).to.be.null
      })
    })
  })

  it('does not start anything when no lead.created rule is enabled', () => {
    ingest({ full_name: 'No Rule', phone: '+34600900006', external_id: 'seq-none' }).then((res) => {
      cy.task<Run[]>('db:sequenceRuns', { leadId: res.body.data.id }).then((runs) => {
        expect(runs).to.have.length(0)
      })
    })
  })

  it('still captures the lead when a sequence cannot start', () => {
    // A rule with no actions at all. The enquiry is the thing that cannot be
    // recovered, so it must survive anything the automation does.
    cy.task('db:createAutomationRule', { accountId: account.accountId, triggerEvent: 'lead.created', actions: [] })
    ingest({ full_name: 'Survives Anyway', phone: '+34600900007', external_id: 'seq-empty' }).then((res) => {
      expect(res.status).to.eq(201)
      cy.task('db:leadById', { id: res.body.data.id }).then((row) => {
        expect((row as { full_name: string }).full_name).to.eq('Survives Anyway')
      })
    })
  })

  describe('Executions', () => {
    interface RunEvent {
      outcome: string
      position: number | null
      step_label: string | null
      detail: string | null
      actor_team_member_id: string | null
    }

    it('records every step, including the ones that were skipped and why', () => {
      threeStepDrip()
      ingest({ full_name: 'History Kept', phone: '+34600900020', external_id: 'seq-history' }).then((res) => {
        const leadId = res.body.data.id
        cy.task<Run[]>('db:sequenceRuns', { leadId }).then((runs) => {
          cy.task<RunEvent[]>('db:runEvents', { runId: runs[0]!.id }).then((events) => {
            expect(events.map((e) => e.outcome)).to.deep.eq(['started', 'skipped', 'waiting'])
            // Not delivered, and the history says so in words -- the drip
            // used to count this step as done with nothing to show for it.
            expect(events[1]!.step_label).to.eq('WhatsApp · welcome_1')
            expect(events[1]!.detail).to.contain('not connected')
            expect(events[2]!.step_label).to.eq('Wait 1 day')
          })
        })

        cy.task('db:makeSequenceDue', { leadId })
        runCron()
        cy.task<Run[]>('db:sequenceRuns', { leadId }).then((runs) => {
          expect(runs[0]!.status).to.eq('done')
          cy.task<RunEvent[]>('db:runEvents', { runId: runs[0]!.id }).then((events) => {
            expect(events.map((e) => e.outcome)).to.deep.eq(['started', 'skipped', 'waiting', 'skipped', 'finished'])
          })
        })
      })
    })

    it('retries a failing step, parks the run as failed, and resumes it from that step on Retry', () => {
      cy.task<{ id: string }>('db:createAutomationRule', {
        accountId: account.accountId,
        triggerEvent: 'lead.created',
        name: 'Webhook drip',
        isMarketing: true,
        actions: [
          { type: 'whatsapp_template', config: { template_name: 'welcome_1', template_language: 'es' } },
          // Nothing listens on port 9: refused at once, offline or in CI.
          { type: 'webhook', config: { url: 'http://127.0.0.1:9/hook' } },
          { type: 'whatsapp_template', config: { template_name: 'welcome_2', template_language: 'es' } },
        ],
      }).then((rule) => {
        ingest({ full_name: 'Webhook Down', phone: '+34600900021', external_id: 'seq-fail' }).then((res) => {
          const leadId = res.body.data.id

          // First attempt, in the ingest request itself.
          cy.task<Run[]>('db:sequenceRuns', { leadId }).then((runs) => {
            expect(runs[0]!.status, 'retried automatically, not given up on').to.eq('running')
            expect(runs[0]!.attempts).to.eq(1)
            // Parked AT the failing step, having saved step 0 as it went.
            expect(runs[0]!.next_position).to.eq(1)
            expect(runs[0]!.last_error).to.contain('webhook did not accept')
          })

          // Two more ticks and it stops trying on its own.
          cy.task('db:makeSequenceDue', { leadId })
          runCron()
          cy.task('db:makeSequenceDue', { leadId })
          runCron()

          cy.task<Run[]>('db:sequenceRuns', { leadId }).then((runs) => {
            const run = runs[0]!
            expect(run.status).to.eq('failed')
            expect(run.attempts).to.eq(3)
            expect(run.next_position).to.eq(1)

            // A failed run is not due: the cron leaves it for a person.
            cy.task('db:makeSequenceDue', { leadId })
            runCron()
            cy.task<RunEvent[]>('db:runEvents', { runId: run.id }).then((events) => {
              expect(events.filter((e) => e.outcome === 'failed')).to.have.length(3)
            })

            // The person fixes the cause -- here, the webhook's address.
            cy.task<{ baseUrl: string }>('db:startPracticeHubStub', {}).then(({ baseUrl }) => {
              cy.task('db:setAutomationActionConfig', { ruleId: rule.id, position: 1, config: { url: `${baseUrl}/hook` } })
            })

            cy.login(account.email, account.password)
            cy.visit('/growth/automations?tab=executions')

            // Visible without opening anything: a badge on the tab and a
            // count on the filter.
            cy.get('[data-test="tab-executions-failed"]').should('contain', '1')
            cy.get('[data-test="executions-filter-failed"]').click()
            cy.get(`[data-test="execution-${run.id}"]`).should('contain', 'Webhook Down').and('contain', 'webhook did not accept').click()

            cy.get('[data-test="execution-status"]').should('contain', 'Failed')
            cy.get('[data-test="execution-event-failed"]').should('have.length', 3)
            cy.get('[data-test="execution-retry"]').click()

            cy.get('[data-test="execution-status"]').should('contain', 'Finished')
            cy.get('[data-test="execution-event-retried"]').should('exist')

            cy.task<Run[]>('db:sequenceRuns', { leadId }).then((after) => {
              expect(after[0]!.status).to.eq('done')
              expect(after[0]!.last_error).to.be.null
            })
            cy.task<RunEvent[]>('db:runEvents', { runId: run.id }).then((events) => {
              // Resumed at step 1: step 0 ran once, ever. A retry that started
              // over would have messaged the lead a second time.
              expect(events.filter((e) => e.position === 0 && e.outcome !== 'retried')).to.have.length(1)
              const afterRetry = events.slice(events.findIndex((e) => e.outcome === 'retried'))
              expect(afterRetry.map((e) => e.outcome)).to.deep.eq(['retried', 'sent', 'skipped', 'finished'])
              // And it says who pressed the button.
              expect(afterRetry[0]!.actor_team_member_id).to.be.a('string')
            })
          })
        })
      })
    })

    it('refuses to retry a run that has not failed', () => {
      threeStepDrip()
      ingest({ full_name: 'Still Running', phone: '+34600900022', external_id: 'seq-no-retry' }).then((res) => {
        cy.task<Run[]>('db:sequenceRuns', { leadId: res.body.data.id }).then((runs) => {
          cy.login(account.email, account.password)
          // Retrying a run mid-flight would race the cron for the same step
          // and could send it twice.
          cy.request({ method: 'POST', url: `/api/growth/automation-runs/${runs[0]!.id}/retry`, failOnStatusCode: false }).its('status').should('eq', 409)
        })
      })
    })
  })
})
