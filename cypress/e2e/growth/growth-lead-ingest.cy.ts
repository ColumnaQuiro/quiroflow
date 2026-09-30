// The door leads come in through.
//
// This is the first piece of moving the Facebook lead-ad flow out of n8n, so
// the tests are written against what an ad platform actually does rather than
// what a well-behaved client would: it retries, it sends the same submission
// twice, it delivers late, and it will happily post a form with no phone
// number in it.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

describe('Lead ingest API', () => {
  let account: SeededAccount
  let token: string

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['leads:write'] }).then((t) => {
        token = t.token
      })
      // The ingest itself is token-authenticated, but the assertions that a
      // lead reaches the board and the funnel are made as a signed-in user.
      cy.login(account.email, account.password)
    })
  })

  function post(body: Record<string, unknown>, failOnStatusCode = true) {
    return cy.request({
      method: 'POST',
      url: '/api/public/v1/leads',
      headers: { Authorization: `Bearer ${token}` },
      body,
      failOnStatusCode,
    })
  }

  it('files a Meta lead-ad submission into the lead, its attribution and its answers', () => {
    // The real payload shape, taken from the pinned sample in the n8n
    // workflow this replaces. The shape is exact and is the point; every
    // value standing in it is invented.
    post({
      first_name: 'Ruben',
      last_name: 'Almazan',
      email: 'ralmazan@example.com',
      phone: '34612345678',
      channel: 'facebook',
      source: 'Meta Ads · Un dia de consulta',
      external_id: '1042938571026384',
      attribution: {
        campaign: '27/01/24 - Open - Valencia +8Km',
        ad: 'Un dia de consulta - Beatriz',
        cost_cents: 1450,
      },
      answers: [
        { question: '¿Vives en Valencia o alrededores?', answer: 'si' },
        { question: '¿Cuál sería el motivo de tu visita?', answer: 'Me duele la zona lumbar al levantarme' },
        { question: '¿Qué tan pronto quieres ser atendido?', answer: '8' },
      ],
    }).then((res) => {
      expect(res.status).to.eq(201)
      expect(res.body.data.reference).to.match(/^LEAD-\d{4}-\d{4}$/)
      expect(res.body.data.stage).to.eq('new')
      expect(res.body.data.deduplicated).to.eq(false)

      cy.task('db:leadById', { id: res.body.data.id }).then((row) => {
        const lead = row as { full_name: string; phone: string; channel: string; furthest_stage: string }
        expect(lead.full_name).to.eq('Ruben Almazan')
        expect(lead.channel).to.eq('facebook')
        // Bare E.164 -- digits, no "+" -- which is the shape WhatsApp's
        // webhook and phoneMatches both use. Meta sent it with no plus and
        // it must not gain a second dial code on the way in.
        expect(lead.phone).to.eq('34612345678')
        expect(lead.furthest_stage).to.eq('new')
      })

      cy.task('db:leadEvents', { leadId: res.body.data.id }).then((rows) => {
        const events = rows as { kind: string; body: { answers: { question: string; answer: string }[] } | null }[]
        const qualification = events.find((e) => e.kind === 'qualification')
        expect(qualification, 'a qualification event').to.not.be.undefined
        expect(qualification!.body!.answers).to.have.length(3)
        expect(qualification!.body!.answers[1]!.answer).to.contain('lumbar')
      })
    })

    cy.visit('/growth/leads?growth=1')
    cy.contains('Ruben Almazan').should('be.visible')
  })

  it('captures whatever a new campaign decides to ask, without a mapping', () => {
    // The point of the object form: these are not the questions the current
    // form asks. A new campaign invents new ones and they still arrive.
    post({
      full_name: 'New Campaign Lead',
      phone: '+34600222111',
      external_id: 'new-campaign-1',
      answers: {
        first_name: 'Ignored',
        email: 'ignored@example.com',
        phone_number: '34600222111',
        '¿has_ido_antes_al_quiropráctico?': 'no, nunca',
        'en_qué_horario_te_viene_mejor?': ['mañanas', 'tardes'],
        'comentarios_adicionales': '',
      },
    }).then((res) => {
      cy.task('db:leadEvents', { leadId: res.body.data.id }).then((rows) => {
        const events = rows as { kind: string; body: { answers: { question: string; answer: string }[] } | null }[]
        const q = events.find((e) => e.kind === 'qualification')
        expect(q, 'a qualification event').to.not.be.undefined

        const answers = q!.body!.answers
        const asked = answers.map((a) => a.question)

        // Name, email and phone are the lead, not questions about it.
        expect(asked.join(' | ')).to.not.contain('first name')
        expect(asked.join(' | ')).to.not.contain('email')
        expect(asked.join(' | ')).to.not.contain('phone')

        // Underscores become spaces; the accents and punctuation the clinic
        // wrote are left alone.
        expect(asked).to.include('¿has ido antes al quiropráctico?')
        expect(answers.find((a) => a.question.startsWith('¿has ido'))!.answer).to.eq('no, nunca')

        // A multi-select answers with a list.
        expect(answers.find((a) => a.question.startsWith('en qué horario'))!.answer).to.eq('mañanas, tardes')

        // An unanswered optional question is dropped rather than shown blank.
        expect(asked.join(' | ')).to.not.contain('comentarios')
      })
    })
  })

  it('returns the same lead when the platform redelivers, instead of making a second one', () => {
    const submission = {
      full_name: 'Retried Twice',
      phone: '+34600111222',
      external_id: 'leadgen-retry-1',
    }

    post(submission).then((first) => {
      expect(first.status).to.eq(201)

      // Meta redelivers whenever it does not get a clean 200. If this made a
      // second lead, the person would get the welcome drip twice and the
      // funnel would count them twice.
      post(submission).then((second) => {
        expect(second.status).to.eq(200)
        expect(second.body.data.id).to.eq(first.body.data.id)
        expect(second.body.data.deduplicated).to.eq(true)
      })
    })

    cy.visit('/growth/leads?growth=1')
    // One lead in New, not two. The count is the assertion that matters --
    // a duplicate would be a second welcome drip to the same person.
    cy.get('[data-test="lead-column-new"]').find('[data-test="lead-count"]').should('have.text', '1')
    cy.contains('Retried Twice').should('be.visible')
  })

  it('keeps the same submission separate when it comes from a different platform', () => {
    post({ full_name: 'Same Id Elsewhere', phone: '+34600111333', external_id: 'shared-id', external_source: 'facebook' }).then((fb) => {
      post({ full_name: 'Same Id Elsewhere', phone: '+34600111333', external_id: 'shared-id', external_source: 'landing_page' }).then((web) => {
        // Ids are only unique within the platform that issued them.
        expect(web.status).to.eq(201)
        expect(web.body.data.id).to.not.eq(fb.body.data.id)
      })
    })
  })

  it('reads the same number the same way with or without its plus', () => {
    // n8n's Set Phone node does replace('+','') before sending, and so does
    // WhatsApp's own webhook. Both forms have to land on one stored number,
    // or the drip messages one string and the patient lookup matches another.
    post({ full_name: 'With Plus', phone: '+34612345678', external_id: 'plus-1' }).then((withPlus) => {
      post({ full_name: 'Without Plus', phone: '34612345678', external_id: 'plus-2' }).then((without) => {
        cy.task('db:leadById', { id: withPlus.body.data.id }).then((a) => {
          cy.task('db:leadById', { id: without.body.data.id }).then((b) => {
            expect((a as { phone: string }).phone).to.eq('34612345678')
            expect((b as { phone: string }).phone).to.eq('34612345678')
          })
        })
      })
    })
  })

  it('still reads a local number as local', () => {
    // The other half of the same rule: nine digits with no country code are
    // a Spanish mobile, not an Australian number that happens to start 61.
    post({ full_name: 'Local Number', phone: '612345678', external_id: 'local-1' }).then((res) => {
      cy.task('db:leadById', { id: res.body.data.id }).then((row) => {
        expect((row as { phone: string }).phone).to.eq('34612345678')
      })
    })
  })

  it('records consent only when the caller states it', () => {
    post({ full_name: 'Said Yes', phone: '+34600333111', external_id: 'consent-yes', marketing_consent: true, marketing_consent_source: 'Meta lead form' }).then((yes) => {
      cy.task('db:leadById', { id: yes.body.data.id }).then((row) => {
        const lead = row as { marketing_consent_at: string | null; marketing_consent_source: string | null }
        expect(lead.marketing_consent_at).to.not.be.null
        expect(lead.marketing_consent_source).to.eq('Meta lead form')
      })
    })

    // Absent means not evidenced, not "probably fine". A row existing is not
    // consent, and defaulting to true here would make every walk-in typed in
    // at the desk a marketing target.
    post({ full_name: 'Said Nothing', phone: '+34600333222', external_id: 'consent-absent' }).then((none) => {
      cy.task('db:leadById', { id: none.body.data.id }).then((row) => {
        expect((row as { marketing_consent_at: string | null }).marketing_consent_at).to.be.null
      })
    })
  })

  it('dates consent to when they agreed, not when we heard about it', () => {
    const submitted = '2026-09-11T05:05:57+0000'
    post({
      full_name: 'Agreed Earlier',
      phone: '+34600333333',
      external_id: 'consent-dated',
      occurred_at: submitted,
      marketing_consent: true,
    }).then((res) => {
      cy.task('db:leadById', { id: res.body.data.id }).then((row) => {
        const at = new Date((row as { marketing_consent_at: string }).marketing_consent_at)
        expect(at.toISOString()).to.eq(new Date(submitted).toISOString())
      })
    })
  })

  describe('a refused submission writes nothing', () => {
    // A 400 tells the sender "fix this and send it again". That is only true
    // if nothing was kept: attribution and answers used to be checked after
    // the lead was inserted, so the caller got a 400 while the lead sat in
    // the board with no timeline, no welcome drip and no staff notification.
    // The corrected retry then matched it by external_id and came back
    // "deduplicated", so the drip and the notification never happened at all
    // -- and without an external_id the retry made a second lead.

    function refusedThenRetried(bad: Record<string, unknown>, field: string, externalId: string) {
      cy.task<{ id: string }>('db:createAutomationRule', {
        accountId: account.accountId,
        triggerEvent: 'lead.created',
        actions: [{ type: 'whatsapp_template', config: { template_name: 'welcome_1', template_language: 'es' } }],
      })
      const good = { full_name: 'Sent Twice', phone: '+34600444111', external_id: externalId }

      post({ ...good, ...bad }, false).then((res) => {
        expect(res.status).to.eq(400)
        expect(JSON.stringify(res.body)).to.contain(field)
      })
      cy.task('db:leadCount', { accountId: account.accountId }).should('eq', 0)

      // The sender fixes the field and tries again: this has to be the
      // lead's first arrival, with everything a first arrival gets.
      post(good).then((res) => {
        expect(res.status).to.eq(201)
        expect(res.body.data.deduplicated).to.eq(false)
        cy.task<{ kind: string }[]>('db:leadEvents', { leadId: res.body.data.id }).should('have.length', 1)
        cy.task<unknown[]>('db:sequenceRuns', { leadId: res.body.data.id }).should('have.length', 1)
      })
      cy.task('db:leadCount', { accountId: account.accountId }).should('eq', 1)
    }

    it('when an attribution field is unknown', () => {
      refusedThenRetried({ attribution: { campaign: 'Spring', adset: 'Typo for ad' } }, 'adset', 'bad-attr-field')
    })

    it('when the cost is not a whole number of cents', () => {
      refusedThenRetried({ attribution: { campaign: 'Spring', cost_cents: '12.50' } }, 'cost_cents', 'bad-attr-cost')
    })

    it('when attribution is not an object', () => {
      refusedThenRetried({ attribution: 'Spring campaign' }, 'attribution', 'bad-attr-shape')
    })

    it('when an answer is not a question and an answer', () => {
      refusedThenRetried({ answers: ['yes'] }, 'answers', 'bad-answers')
    })

    it('when an answer has no question', () => {
      refusedThenRetried({ answers: [{ answer: 'yes' }] }, 'answers', 'bad-answer-question')
    })

    it('when occurred_at is not a date', () => {
      refusedThenRetried({ occurred_at: 'not a date', marketing_consent: true }, 'occurred_at', 'bad-occurred-at')
    })

    it('and a retry without an external_id does not make a second lead', () => {
      post({ full_name: 'No Id', phone: '+34600444222', answers: 'si' }, false).its('status').should('eq', 400)
      post({ full_name: 'No Id', phone: '+34600444222', answers: { motivo: 'si' } }).its('status').should('eq', 201)
      cy.task('db:leadCount', { accountId: account.accountId }).should('eq', 1)
    })
  })

  describe('references', () => {
    const year = new Date().getUTCFullYear()

    it('numbers past a lead dated before this year but numbered in it', () => {
      // An attributed online booking becomes a lead dated back to the booking
      // (lead_for_attributed_booking), numbered from the highest reference of
      // the year. Booked on 31 Dec and attributed on 1 Jan, it holds this
      // year's first number with last year's date -- so a count of this
      // year's leads says the next number is 0001, which is taken, and every
      // lead the account receives fails on the unique index for the rest of
      // the year.
      cy.task('db:createLead', {
        accountId: account.accountId,
        fullName: 'Booked On New Year',
        reference: `LEAD-${year}-0001`,
        createdAt: `${year - 1}-12-31T22:00:00Z`,
      })
      post({ full_name: 'After New Year', phone: '+34600444333', external_id: 'ref-after-backdated' }, false).then((res) => {
        expect(res.status).to.eq(201)
        expect(res.body.data.reference).to.eq(`LEAD-${year}-0002`)
      })
    })

    it('keeps numbering once the year passes 9999', () => {
      // References are compared as text, where 10000 sorts below 9999. A
      // number that is taken is skipped rather than failing the lead.
      cy.task('db:createLead', { accountId: account.accountId, fullName: 'Nine Nines', reference: `LEAD-${year}-9999` })
      cy.task('db:createLead', { accountId: account.accountId, fullName: 'Ten Thousand', reference: `LEAD-${year}-10000` })
      post({ full_name: 'Ten Thousand And One', phone: '+34600444444' }, false).then((res) => {
        expect(res.status).to.eq(201)
        expect(res.body.data.reference).to.eq(`LEAD-${year}-10001`)
      })
    })
  })

  it('refuses a lead nobody could contact', () => {
    post({ full_name: 'No Way To Reach' }, false).then((res) => {
      expect(res.status).to.eq(400)
      expect(JSON.stringify(res.body)).to.contain('cannot be contacted')
    })
  })

  it('refuses a submission with no name at all', () => {
    post({ phone: '+34600111444' }, false).then((res) => {
      expect(res.status).to.eq(400)
      expect(JSON.stringify(res.body)).to.contain('full_name')
    })
  })

  it('will not let a form declare itself converted', () => {
    // Stages past Booked are outcomes the clinic decides. A form asserting
    // 'converted' would put a stranger into the revenue-attributed number.
    post({ full_name: 'Claims Converted', phone: '+34600111555', stage: 'converted' }, false).then((res) => {
      expect(res.status).to.eq(400)
      expect(JSON.stringify(res.body)).to.contain('stage')
    })
  })

  it('rejects a token without the leads:write scope', () => {
    cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['patients:read'] }).then((weak) => {
      cy.request({
        method: 'POST',
        url: '/api/public/v1/leads',
        headers: { Authorization: `Bearer ${weak.token}` },
        body: { full_name: 'Wrong Scope', phone: '+34600111666' },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(403)
        expect(JSON.stringify(res.body)).to.contain('leads:write')
      })
    })
  })

  it('still captures the lead when the staff notification cannot be sent', () => {
    // The notification is best-effort by design, and this is what that has to
    // mean in practice. RESEND_API_KEY is not set here, so sendResendEmail
    // throws on every run -- which is exactly the shape of a real outage, an
    // expired WhatsApp token, or a notify address that bounces. The enquiry
    // is the thing that cannot be recovered; telling the clinic about it is
    // not, so a failure there must never reach the caller as a 500 and turn a
    // captured lead into somebody else's retry.
    cy.task('db:setNewLeadNotify', { accountId: account.accountId, email: 'clinic@example.test', whatsapp: '+34600111888' })

    post({ full_name: 'Notify Fails', phone: '+34600111889', external_id: 'notify-fails' }).then((res) => {
      expect(res.status).to.eq(201)
      cy.task('db:leadById', { id: res.body.data.id }).then((row) => {
        expect((row as { full_name: string }).full_name).to.eq('Notify Fails')
      })
    })
  })

  it('hands a new lead to the receptionist when it is switched on', () => {
    // Leads have always been created 'none', and the only thing that ever
    // changed that is a button in the Inbox -- so the tick that drafts
    // replies, which looks for 'handling', had nothing to do on any lead in
    // any clinic while the switch claimed the receptionist reads real
    // enquiries. This is what makes that switch true.
    cy.task('db:setReceptionistEnabled', { accountId: account.accountId, enabled: true })
    post({ full_name: 'Alba Takes This', phone: '+34600112001', external_id: 'ai-on' }).then((res) => {
      cy.task('db:leadAiState', { id: res.body.data.id }).should((row) => {
        const state = row as { ai_state: string; ai_handling: boolean }
        expect(state.ai_state).to.eq('handling')
        // The board reads the boolean and a trigger keeps it in step. This is
        // the assertion that notices if that ever stops being true.
        expect(state.ai_handling).to.eq(true)
      })
    })
  })

  it('leaves a new lead alone when the receptionist is off', () => {
    // Off has to mean off. A clinic that has not turned this on must not find
    // the AI holding its conversations.
    cy.task('db:setReceptionistEnabled', { accountId: account.accountId, enabled: false })
    post({ full_name: 'Nobody Takes This', phone: '+34600112002', external_id: 'ai-off' }).then((res) => {
      cy.task('db:leadAiState', { id: res.body.data.id }).should((row) => {
        expect((row as { ai_state: string }).ai_state).to.eq('none')
      })
    })
  })

  it('counts an ingested lead in the dashboard funnel', () => {
    post({ full_name: 'Arrived Booked', phone: '+34600111777', stage: 'booked' }).then((res) => {
      expect(res.body.data.stage).to.eq('booked')

      // The furthest_stage trigger fires on INSERT, so a lead that arrives
      // already booked counts at every stage below it -- this is the exact
      // case that was silently broken before the trigger covered inserts.
      cy.task('db:leadById', { id: res.body.data.id }).then((row) => {
        expect((row as { furthest_stage: string }).furthest_stage).to.eq('booked')
      })
    })

    cy.visit('/growth?growth=1')
    cy.get('[data-test="funnel-stage-new"]').scrollIntoView().should('contain', '1')
    cy.get('[data-test="funnel-stage-booked"]').should('contain', '1')
  })
})
