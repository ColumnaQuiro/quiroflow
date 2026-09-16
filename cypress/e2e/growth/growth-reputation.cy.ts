// Reputation against real rows, plus the dark-theme pass across the tier.
//
// The thing worth pinning down here is the boundary between what this app
// knows and what only Google knows. An account with no reviews must not be
// shown a rating, and a funnel with nothing attributed must not be shown a
// "0% left a review" -- both would be inventions, and both are one careless
// `?? 0` away from appearing. The tests below assert the absence.
//
// The dark case gets its own test rather than a note in a PR because it is
// the claim the design made -- "design one artboard in dark to prove the
// palette flips" -- and the thing most likely to rot silently, since nobody
// reviews in dark by default. scripts/check-theme-tokens.mjs guards the
// static half (no hardcoded colours); this guards the rendered half.

const GROWTH_PAGES = ['/growth', '/growth/leads', '/growth/receptionist', '/growth/automations', '/growth/reputation']

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

// Tokens are unique across every account, deliberately -- one is a public
// URL, not an account-scoped id. So a literal here would pass once and then
// collide forever against a database that was not reset in between.
function token(label: string) {
  return `tok-${label}-${Math.random().toString(36).slice(2, 10)}`
}

function monthsAgo(n: number) {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - n, 15)
  return d.toISOString()
}

describe('Growth reputation', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  it('says it has no reviews rather than reporting a rating of zero', () => {
    cy.visit('/growth/reputation?growth=1')

    cy.get('[data-test="no-reviews"]').should('contain', 'is not built yet')
    cy.get('[data-test="rating"]').should('not.exist')
    cy.get('[data-test="review-card"]').should('not.exist')

    // 0.0 out of 5 is the single most misleading thing this screen could
    // say, so it is asserted against by name.
    cy.contains('0.0').should('not.exist')

    // The half we do own is still counted, and still explains itself.
    cy.get('[data-test="request-funnel"]').should('be.visible')
    cy.get('[data-test="funnel-caveat"]').should('contain', 'only known once a platform is connected')
  })

  it('averages the rating, spreads it by stars and tracks where it is heading', () => {
    for (const [rating, months] of [[5, 6], [4, 6], [5, 1], [3, 1]] as const) {
      cy.task('db:createReview', {
        accountId: account.accountId,
        authorName: `Reviewer ${rating}-${months}`,
        rating,
        body: 'Seeded review body.',
        postedAt: monthsAgo(months),
      })
    }

    cy.visit('/growth/reputation?growth=1')

    // (5 + 4 + 5 + 3) / 4 = 4.25, rounded for display.
    cy.get('[data-test="rating"]').should('have.text', '4.3')
    cy.contains('4 reviews').should('be.visible')

    // Two months, each averaging its own reviews: 4.5 six months ago, 4.0
    // this month. A downward trend has to be allowed to show as one.
    cy.contains('4.5 → 4.0').should('be.visible')

    cy.get('[role="img"][aria-label="4.3 out of 5"]').should('exist')
    cy.get('[data-test="review-card"]').should('have.length', 4)
  })

  it('says Google is connectable rather than that reviews cannot be had', () => {
    // The screen used to say connecting Google "is not built yet", which
    // stopped being true. Doctoralia and Facebook still are.
    cy.visit('/growth/reputation?growth=1')
    cy.get('[data-test="no-reviews"]').should('contain', 'Google is connected once you add your Place ID')
    cy.get('[data-test="no-reviews"]').should('contain', 'Doctoralia and Facebook each need their own integration')
  })

  it('says importing needs a key rather than blaming the clinic for it', () => {
    // No Places key on this deployment, so the route reports unavailable and
    // stops -- before it looks at whether the clinic connected a listing.
    //
    // That order is the point. A deployment with no key cannot read Google
    // for anybody, and telling an owner to go and find their Place ID would
    // send them to fix something that was never the problem. Same shape as
    // the model key on the drafting routes: not configured is a state, not a
    // failure.
    cy.visit('/growth/reputation?growth=1')
    cy.request({ method: 'POST', url: '/api/growth/reputation/sync-google' }).then((res) => {
      expect(res.status).to.eq(200)
      expect(res.body.available).to.eq(false)
      expect(res.body.imported).to.eq(0)
    })
  })

  it('holds a draft back for approval and says nothing posts without it', () => {
    cy.task('db:createReview', {
      accountId: account.accountId,
      authorName: 'Jordi Puigdemont',
      rating: 3,
      body: 'Buen trato, pero esperé 25 minutos.',
      draftBody: 'Gracias por decírnoslo, Jordi.',
    })

    cy.visit('/growth/reputation?growth=1')

    cy.get('[data-test="pending-reply"]').within(() => {
      cy.contains('needs your approval').should('be.visible')
      cy.contains('Gracias por decírnoslo, Jordi.').should('be.visible')

      // The design had this posting itself after 22 hours. It does not, and
      // the card has to keep saying so -- a countdown reappearing here would
      // mean an AI sentence can reach a public page unread.
      cy.contains('Nothing posts without your approval').should('be.visible')
      cy.contains('Auto-posts').should('not.exist')
    })

    cy.get('[data-test="pending-reply"]').should('be.visible')
  })

  it('writes the draft into the reply on approval, and records that AI wrote it', () => {
    cy.task('db:createReview', {
      accountId: account.accountId,
      authorName: 'Ana Ruiz',
      rating: 5,
      body: 'Excelente.',
      draftBody: 'Muchas gracias, Ana.',
    }).then((review) => {
      const id = (review as { id: string }).id

      cy.visit('/growth/reputation?growth=1')
      cy.get('[data-test="approve-reply"]').click()

      // "Saved", not "Posted" -- nothing reaches Google until the platform
      // integration exists, and the toast is where that lie would be easiest.
      cy.contains('Reply approved and saved.').should('be.visible')
      cy.contains('Replied · AI drafted, approved').should('be.visible')
      cy.get('[data-test="pending-reply"]').should('not.exist')

      cy.task('db:reviewById', { id }).then((row) => {
        const saved = row as { reply_body: string; replied_at: string; reply_was_ai_drafted: boolean; draft_body: string | null }
        expect(saved.reply_body).to.eq('Muchas gracias, Ana.')
        expect(saved.replied_at).to.not.be.null
        expect(saved.reply_was_ai_drafted).to.be.true
        expect(saved.draft_body).to.be.null
      })
    })
  })

  it('stops calling it AI-written once a person has edited it', () => {
    cy.task('db:createReview', {
      accountId: account.accountId,
      authorName: 'Marc Vidal',
      rating: 4,
      body: 'Muy bien.',
      draftBody: 'Gracias por la reseña.',
    }).then((review) => {
      const id = (review as { id: string }).id

      cy.visit('/growth/reputation?growth=1')
      cy.get('[data-test="edit-reply-start"]').click()
      cy.get('[data-test="edit-reply"]').clear().type('Gracias Marc, nos alegra mucho.')
      cy.get('[data-test="approve-reply"]').click()

      cy.contains('Reply approved and saved.').should('be.visible')

      cy.task('db:reviewById', { id }).then((row) => {
        const saved = row as { reply_body: string; reply_was_ai_drafted: boolean }
        expect(saved.reply_body).to.eq('Gracias Marc, nos alegra mucho.')
        // The words are the clinic's now. Attributing them to the model
        // would be wrong in the direction that matters.
        expect(saved.reply_was_ai_drafted).to.be.false
      })
    })
  })

  it('leaves nothing behind when a draft is discarded', () => {
    cy.task('db:createReview', {
      accountId: account.accountId,
      authorName: 'Discarded Draft',
      rating: 2,
      body: 'No me gustó.',
      draftBody: 'Lo sentimos mucho.',
    }).then((review) => {
      const id = (review as { id: string }).id

      cy.visit('/growth/reputation?growth=1')
      cy.get('[data-test="discard-reply"]').click()

      cy.contains('Draft discarded. Nothing was saved.').should('be.visible')
      cy.get('[data-test="pending-reply"]').should('not.exist')
      cy.get('[data-test="draft-reply"]').should('be.visible')

      cy.task('db:reviewById', { id }).then((row) => {
        const saved = row as { draft_body: string | null; reply_body: string | null; replied_at: string | null }
        expect(saved.draft_body).to.be.null
        expect(saved.reply_body).to.be.null
        expect(saved.replied_at).to.be.null
      })
    })
  })

  it('says drafting needs a key rather than failing silently', () => {
    // CI has no ANTHROPIC_API_KEY, which is also the state a self-hosted
    // install starts in. The button has to explain itself there.
    cy.task('db:createReview', { accountId: account.accountId, authorName: 'No Key Yet', rating: 5, body: 'Genial.' })

    cy.visit('/growth/reputation?growth=1')
    cy.get('[data-test="draft-reply"]').click()
    cy.contains('needs an Anthropic API key').should('be.visible')
  })

  it('counts sent and opened exactly, and refuses to guess the rest', () => {
    cy.task('db:createReviewRequest', { accountId: account.accountId, token: token('sent-only') })
    cy.task('db:createReviewRequest', { accountId: account.accountId, token: token('opened'), openedAt: new Date().toISOString() })

    cy.visit('/growth/reputation?growth=1')

    cy.get('[data-test="request-funnel"]').within(() => {
      cy.contains('Sent').should('be.visible')
      cy.contains('50%').should('be.visible')

      // Nothing has been attributed to a review, so the last step is unknown
      // rather than zero. "0 left a review" would read as a measurement.
      cy.contains('Left a review').parent().should('contain', '—')
    })
  })

  describe('the tracked link', () => {
    it('records the open and sends the patient to the clinic listing', () => {
      cy.task('db:setGoogleReviewUrl', { accountId: account.accountId, url: 'https://g.page/r/seeded-listing/review' })
      const tracked = token('redirect')
      cy.task('db:createReviewRequest', { accountId: account.accountId, token: tracked })

      cy.request({ url: `/api/r/${tracked}`, followRedirect: false }).then((res) => {
        expect(res.status).to.eq(302)
        expect(res.headers.location).to.eq('https://g.page/r/seeded-listing/review')
      })

      cy.task('db:reviewRequestByToken', { token: tracked }).then((row) => {
        expect((row as { opened_at: string | null }).opened_at).to.not.be.null
      })
    })

    it('redirects an unknown token too, so it cannot be used to probe', () => {
      cy.request({ url: '/api/r/definitely-not-a-token', followRedirect: false }).then((res) => {
        // A 404 here would answer "is this token real?" for anyone asking,
        // and would strand a patient whose link we mangled.
        expect(res.status).to.eq(302)
        expect(res.headers.location).to.contain('google.com/maps')
      })
    })
  })

  it('points an account without the tier at the upgrade screen', () => {
    cy.visit('/growth/reputation?growth=0')

    cy.contains('Reputation is part of the Growth tier.').should('be.visible')
    cy.get('[data-test="review-card"]').should('not.exist')
  })

  describe('dark theme', () => {
    for (const path of GROWTH_PAGES) {
      it(`flips the palette on ${path}`, () => {
        cy.visit(`${path}?growth=1`, {
          onBeforeLoad(win) {
            win.localStorage.setItem('quiroflow-theme', 'dark')
          },
        })

        cy.get('html').should('have.attr', 'data-theme', 'dark')

        // The page surface must actually be dark, not merely themed. Parsing
        // the channels rather than matching a literal colour, so this keeps
        // working if the dark palette is retuned.
        cy.get('body').should(($body) => {
          const bg = getComputedStyle($body[0]).backgroundColor
          const [r, g, b] = bg.match(/\d+/g)!.map(Number)
          const luminance = (r! + g! + b!) / 3
          expect(luminance, `page background on ${path} should be dark, got ${bg}`).to.be.lessThan(90)
        })
      })
    }
  })
})
