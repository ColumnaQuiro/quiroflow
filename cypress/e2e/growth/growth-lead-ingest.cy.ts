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
    // workflow this replaces.
    post({
      first_name: 'Pablo',
      last_name: 'Danazzo',
      email: 'pdanazzo@example.com',
      phone: '34614375211',
      channel: 'facebook',
      source: 'Meta Ads · Un dia de consulta',
      external_id: '1097814759270608',
      attribution: {
        campaign: '27/01/24 - Open - Valencia +8Km',
        ad: 'Un dia de consulta - Jordana',
        cost_cents: 1450,
      },
      answers: [
        { question: '¿Vives en Valencia o alrededores?', answer: 'si' },
        { question: '¿Cuál sería el motivo de tu visita?', answer: 'Se me adormecen las dos manos' },
        { question: '¿Qué tan pronto quieres ser atendido?', answer: '8' },
      ],
    }).then((res) => {
      expect(res.status).to.eq(201)
      expect(res.body.data.reference).to.match(/^LEAD-\d{4}-\d{4}$/)
      expect(res.body.data.stage).to.eq('new')
      expect(res.body.data.deduplicated).to.eq(false)

      cy.task('db:leadById', { id: res.body.data.id }).then((row) => {
        const lead = row as { full_name: string; phone: string; channel: string; furthest_stage: string }
        expect(lead.full_name).to.eq('Pablo Danazzo')
        expect(lead.channel).to.eq('facebook')
        // Bare E.164 -- digits, no "+" -- which is the shape WhatsApp's
        // webhook and phoneMatches both use. Meta sent it with no plus and
        // it must not gain a second dial code on the way in.
        expect(lead.phone).to.eq('34614375211')
        expect(lead.furthest_stage).to.eq('new')
      })

      cy.task('db:leadEvents', { leadId: res.body.data.id }).then((rows) => {
        const events = rows as { kind: string; body: { answers: { question: string; answer: string }[] } | null }[]
        const qualification = events.find((e) => e.kind === 'qualification')
        expect(qualification, 'a qualification event').to.not.be.undefined
        expect(qualification!.body!.answers).to.have.length(3)
        expect(qualification!.body!.answers[1]!.answer).to.contain('adormecen')
      })
    })

    cy.visit('/growth/leads?growth=1')
    cy.contains('Pablo Danazzo').should('be.visible')
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
    post({ full_name: 'With Plus', phone: '+34614375211', external_id: 'plus-1' }).then((withPlus) => {
      post({ full_name: 'Without Plus', phone: '34614375211', external_id: 'plus-2' }).then((without) => {
        cy.task('db:leadById', { id: withPlus.body.data.id }).then((a) => {
          cy.task('db:leadById', { id: without.body.data.id }).then((b) => {
            expect((a as { phone: string }).phone).to.eq('34614375211')
            expect((b as { phone: string }).phone).to.eq('34614375211')
          })
        })
      })
    })
  })

  it('still reads a local number as local', () => {
    // The other half of the same rule: nine digits with no country code are
    // a Spanish mobile, not an Australian number that happens to start 61.
    post({ full_name: 'Local Number', phone: '614375211', external_id: 'local-1' }).then((res) => {
      cy.task('db:leadById', { id: res.body.data.id }).then((row) => {
        expect((row as { phone: string }).phone).to.eq('34614375211')
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
