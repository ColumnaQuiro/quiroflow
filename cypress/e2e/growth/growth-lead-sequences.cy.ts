// A drip that waits, and stops when it should.
//
// The engine everywhere else fires a rule and runs it to completion, so this
// is the first automation with anything in flight. What is worth testing is
// almost entirely the stopping: a sequence that sends is easy, a sequence
// that knows when to shut up is the product.
//
// No WhatsApp is sent in any of these -- the account has no Meta credentials,
// so runWhatsAppAction returns before sending. That is deliberate: these test
// the sequencing, not the delivery.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface Run {
  id: string
  status: string
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
})
