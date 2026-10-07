// Which leads the receptionist decides to draft for, unprompted.
//
// The writing itself needs a model key, which CI has none of, so nothing here
// asserts a sentence. What is worth testing is the choosing -- the tick runs
// every 15 minutes against every clinic paying for Growth, so "who is due a
// draft" is the part that can quietly cost money, annoy a clinic, or answer
// somebody twice. The route reports `considered`, which is exactly that
// decision and nothing else.
//
// Asserted per lead rather than on the count: the tick scans every clinic, so
// leads left behind by earlier tests in this file are legitimately considered
// too, and a total would be a test of how many tests ran before this one.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface CronResult {
  drafted: number
  considered: number
  consideredLeadIds: string[]
}

describe('Who the receptionist drafts for without being asked', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      // Logged in because the ai-state route below is a staff route. Without
      // this it 401s, no lead ever reaches 'handling', and every assertion
      // here passes by considering nothing -- which is how the first version
      // of this file "passed" six of seven cases.
      cy.login(account.email, account.password)
      cy.task('db:setReceptionistEnabled', { accountId: account.accountId, enabled: true })
    })
  })

  /** A lead the AI is handling, who has written and not been answered. */
  function waitingLead(name: string, opts: { inboundMinutesAgo?: number } = {}) {
    return cy
      .task('db:createLead', { accountId: account.accountId, fullName: name, stage: 'contacted', phone: '+34600444902', source: 'Meta Ads' })
      .then((lead) => {
        const leadId = (lead as { id: string }).id
        cy.task('db:createLeadMessage', {
          accountId: account.accountId,
          leadId,
          direction: 'inbound',
          body: `Hola, soy ${name}`,
          createdAt: new Date(Date.now() - (opts.inboundMinutesAgo ?? 5) * 60000).toISOString(),
        })
        cy.request({ method: 'POST', url: `/api/growth/leads/${leadId}/ai-state`, body: { state: 'handling' } })
        return cy.wrap(leadId, { log: false })
      })
  }

  function runCron() {
    return cy
      .request<CronResult>({
        method: 'POST',
        url: '/api/automations/receptionist-draft-cron',
        headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' },
      })
      .then((res) => {
        // Not failOnStatusCode:false -- a 401 from a missing secret would
        // report zero considered and turn every assertion below into a test
        // of nothing.
        expect(res.status).to.eq(200)
        return res.body
      })
  }

  it('picks up a lead who has written and has no draft waiting', () => {
    waitingLead('Waiting Patiently').then((leadId) => {
      runCron().then((body) => {
        expect(body.consideredLeadIds, 'due a draft').to.include(leadId)
      })
    })
  })

  it('picks up a lead that arrived through the front door', () => {
    // Every other case here hands a lead over by calling the ai-state route,
    // which is a person pressing a button. That was the ONLY way a lead ever
    // reached 'handling', so this tick was tested and inert at the same time:
    // green in CI, and with nothing to do on any real lead in any clinic.
    //
    // This one arrives the way a real one does, through the public ingest,
    // and is due a draft without anybody touching it.
    cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['leads:write'] }).then((t) => {
      cy.request({
        method: 'POST',
        url: '/api/public/v1/leads',
        headers: { Authorization: `Bearer ${t.token}` },
        body: { full_name: 'Arrived By Itself', phone: '+34600900123', marketing_consent: true },
      }).then((res) => {
        const leadId = res.body.data.id
        cy.task('db:createLeadMessage', {
          accountId: account.accountId,
          leadId,
          direction: 'inbound',
          body: '¿Cuánto cuesta?',
        })
        runCron().then((body) => {
          expect(body.consideredLeadIds, 'due a draft with nobody pressing anything').to.include(leadId)
        })
      })
    })
  })

  it('leaves a lead alone once drafting has read past their last message', () => {
    // The loop this guards against: discarding a draft clears ai_draft_body,
    // so without a separate record of how far drafting has READ, the next
    // tick would decide a draft is missing and write the same one again --
    // and the clinic could never get rid of it.
    waitingLead('Read Already').then((leadId) => {
      cy.task('db:setLeadDraftedThrough', { id: leadId, at: new Date().toISOString() })
      runCron().then((body) => {
        expect(body.consideredLeadIds, 'nothing new since the last draft').to.not.include(leadId)
      })
    })
  })

  it('does not overwrite a draft already sitting there', () => {
    // It may be half-edited by somebody. Replacing it would throw that away.
    waitingLead('Has A Draft').then((leadId) => {
      cy.task('db:setLeadDraft', { id: leadId, body: 'Algo que ya estaba escrito.' })
      runCron().then((body) => {
        expect(body.consideredLeadIds).to.not.include(leadId)
      })
    })
  })

  it('does not draft what WhatsApp would refuse to send', () => {
    // More than 24h since they wrote, so no free-form reply can go out. A
    // draft nobody could send is not worth paying a model to write.
    waitingLead('Too Late', { inboundMinutesAgo: 60 * 48 }).then((leadId) => {
      runCron().then((body) => {
        expect(body.consideredLeadIds).to.not.include(leadId)
      })
    })
  })

  it('does nothing for an account that switched the receptionist off', () => {
    cy.task('db:setReceptionistEnabled', { accountId: account.accountId, enabled: false })
    waitingLead('Switched Off').then((leadId) => {
      runCron().then((body) => {
        expect(body.consideredLeadIds).to.not.include(leadId)
      })
    })
  })

  it('does nothing for an account that is not paying for Growth', () => {
    // The cron runs as the service role, outside requireGrowth -- which is
    // what enforces the entitlement everywhere else. A background job is
    // exactly where an unpaid account would keep being worked on unnoticed.
    // Set the lead up while still entitled, then take the entitlement away --
    // the other order fails on the ai-state route itself, which is gated by
    // requireGrowth and answers 402. That refusal is the entitlement working
    // on the request path; what this test is about is the BACKGROUND path,
    // which has no requireGrowth to lean on.
    waitingLead('Not Paying').then((leadId) => {
      cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: false })
      cy.setSubscriptionStatus(account.accountId, 'active')
      cy.task('db:setComped', { accountId: account.accountId, comped: false })
      runCron().then((body) => {
        expect(body.consideredLeadIds).to.not.include(leadId)
      })
    })
  })

  it('leaves a blocked lead alone', () => {
    waitingLead('Blocked Lead').then((leadId) => {
      cy.request({ method: 'POST', url: `/api/growth/leads/${leadId}/ai-state`, body: { state: 'blocked' } })
      runCron().then((body) => {
        expect(body.consideredLeadIds).to.not.include(leadId)
      })
    })
  })
})

// The cases above put the inbound message in with a task. A real one arrives
// through the WhatsApp webhook, and the webhook used to lift every lead the AI
// was handling to 'needs_human' the moment they wrote -- before the tick ever
// saw them. Since the tick only looks at 'handling', the one thing that should
// produce a draft (the lead writing) was what guaranteed it never would: no
// WhatsApp lead in any clinic was ever drafted for.
describe('The receptionist drafts for leads who write in on WhatsApp', () => {
  let account: SeededAccount
  let phoneNumberId: string
  let appSecret: string

  function deliver(from: string, text: string) {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneNumberId },
                messages: [{ id: `wamid.${Date.now()}${Math.random()}`, from, type: 'text', text: { body: text } }],
              },
            },
          ],
        },
      ],
    })
    return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) =>
      cy.request({
        method: 'POST',
        url: '/api/whatsapp/webhook',
        body,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
      }),
    )
  }

  function runCron() {
    return cy
      .request<CronResult>({
        method: 'POST',
        url: '/api/automations/receptionist-draft-cron',
        headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' },
      })
      .then((res) => {
        expect(res.status).to.eq(200)
        return res.body
      })
  }

  const randomPhone = () => `346${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

  beforeEach(() => {
    phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    appSecret = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
      cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId })
      cy.task('db:setReceptionistEnabled', { accountId: account.accountId, enabled: true })
    })
  })

  it('keeps a lead it is handling on the AI when they write, and drafts for them', () => {
    const phone = randomPhone()
    cy.task<{ id: string }>('db:createLead', { accountId: account.accountId, fullName: 'Asked On WhatsApp', phone, aiHandling: true }).then((lead) => {
      deliver(phone, '¿Cuánto cuesta la primera visita?')
      cy.task('db:leadById', { id: lead.id }).then((row) => {
        expect((row as { ai_state: string }).ai_state, 'still the AI').to.eq('handling')
      })
      runCron().then((body) => {
        expect(body.consideredLeadIds, 'due a draft').to.include(lead.id)
      })
    })
  })

  it('drafts for a stranger whose first message made them a lead', () => {
    const phone = randomPhone()
    deliver(phone, 'Hola, ¿tenéis cita esta semana?')
    cy.task<{ id: string; external_id: string }[]>('db:leadsByExternalId', { accountId: account.accountId, externalSource: 'whatsapp' }).then((leads) => {
      const lead = leads.find((l) => l.external_id === phone)
      expect(lead, 'the stranger became a lead').to.not.be.undefined
      cy.task('db:leadById', { id: lead!.id }).then((row) => {
        expect((row as { ai_state: string }).ai_state).to.eq('handling')
      })
      runCron().then((body) => {
        expect(body.consideredLeadIds, 'due a draft').to.include(lead!.id)
      })
    })
  })

  it('still asks for a person when the receptionist is switched off', () => {
    // Off means nothing will draft, so a lead left on 'handling' would be a
    // conversation nobody is reading.
    cy.task('db:setReceptionistEnabled', { accountId: account.accountId, enabled: false })
    const phone = randomPhone()
    cy.task<{ id: string }>('db:createLead', { accountId: account.accountId, fullName: 'Nobody Drafting', phone, aiHandling: true }).then((lead) => {
      deliver(phone, '¿Hola?')
      cy.task('db:leadById', { id: lead.id }).then((row) => {
        expect((row as { ai_state: string }).ai_state).to.eq('needs_human')
      })
    })
  })

  it('is not starved by older leads that have said nothing', () => {
    // The scan used to read 200 'handling' leads in no particular order and
    // only then ask which had written. Form leads the AI is on but who never
    // wrote back pile up, and a clinic with 200 of them never had a new
    // message considered at all.
    cy.task<string[]>('auto:seedHandlingLeads', { accountId: account.accountId, count: 210 }).then((silentIds) => {
      const phone = randomPhone()
      cy.task<{ id: string }>('db:createLead', { accountId: account.accountId, fullName: 'Behind The Queue', phone, aiHandling: true }).then((lead) => {
        deliver(phone, 'Quería pedir cita')
        runCron().then((body) => {
          expect(body.consideredLeadIds, 'the lead who wrote').to.include(lead.id)
          for (const id of silentIds) expect(body.consideredLeadIds).to.not.include(id)
        })
      })
      // Gone again, so they do not crowd any other spec's tick.
      cy.task('auto:softDeleteLeads', { ids: silentIds })
    })
  })
})
