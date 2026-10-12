// The Growth dashboard against real leads.
//
// The number most worth pinning down is the funnel, because it is the one
// that is easy to get quietly wrong: it counts leads that EVER reached a
// stage, not leads sitting in it now. A lead in Converted also passed
// through Booked, and counting current stages would report Booked as
// whoever happens to be there today -- flattering exactly the stages nobody
// reaches.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
  teamMemberId: string
}

const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()

describe('Growth dashboard', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  it('counts the funnel by how far a lead got, not where it sits now', () => {
    // Three leads, each parked at a different stage. Every one of them has
    // been through every stage below it.
    for (const [name, stage] of [
      ['Only Enquired', 'new'],
      ['Got Contacted', 'contacted'],
      ['Got Booked', 'booked'],
    ] as const) {
      cy.task('db:createLead', { accountId: account.accountId, fullName: name, stage, estimatedValueCents: 100_000 })
    }

    cy.visit('/growth?growth=1')

    cy.contains('Acquisition funnel').should('be.visible')
    cy.get('[data-test="funnel-stage-new"]').should('contain', '3')
    cy.get('[data-test="funnel-stage-contacted"]').should('contain', '2')
    cy.get('[data-test="funnel-stage-qualified"]').should('contain', '1')
    cy.get('[data-test="funnel-stage-booked"]').should('contain', '1')
    cy.get('[data-test="funnel-stage-showed"]').should('contain', '0')
  })

  it('counts a lead the clinic has written to as contacted, though it still sits in New', () => {
    // The follow-up sequence and Inbox replies send WhatsApp messages and
    // leave the lead in New. 74 of 75 "New" leads had been messaged when the
    // funnel said a sixth of them had been contacted.
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Messaged', stage: 'new' }).then((lead) => {
      cy.task('db:createLeadMessage', { accountId: account.accountId, leadId: (lead as { id: string }).id, direction: 'outbound', body: 'Hola', status: 'delivered' })
    })
    // A message that failed, or a dry run, reached nobody.
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Failed Send', stage: 'new' }).then((lead) => {
      cy.task('db:createLeadMessage', { accountId: account.accountId, leadId: (lead as { id: string }).id, direction: 'outbound', body: 'Hola', status: 'failed' })
    })
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Untouched', stage: 'new' })

    cy.visit('/growth?growth=1')
    cy.get('[data-test="funnel-stage-new"]').should('contain', '3')
    cy.get('[data-test="funnel-stage-contacted"]').should('contain', '1')
    cy.get('[data-test="funnel-stage-qualified"]').should('contain', '0')
  })

  it('does not count a lead as booked or showed just because it was converted', () => {
    // "Convert to patient" sets Converted straight from New -- often in order
    // to book them in. Read cumulatively that claimed a visit that had not
    // happened yet.
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Converted First', stage: 'new', phone: '34600111222' }).then((lead) => {
      cy.request('POST', `/api/growth/leads/${(lead as { id: string }).id}/convert`).then((res) => {
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: res.body.patientId,
          startsAt: daysFromNow(7),
        })
      })
    })
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Converted Unbooked', stage: 'new', phone: '34600333444' }).then((lead) => {
      cy.request('POST', `/api/growth/leads/${(lead as { id: string }).id}/convert`)
    })

    cy.visit('/growth?growth=1')
    cy.get('[data-test="funnel-stage-converted"]').should('contain', '2')
    // One of them has an appointment, next week, so it has been booked --
    cy.get('[data-test="funnel-stage-booked"]').should('contain', '1')
    // -- and nobody has turned up to anything.
    cy.get('[data-test="funnel-stage-showed"]').should('contain', '0')
    // Next week's visit has not been missed: no show rate to state yet.
    cy.contains('td', 'All channels').parent().find('td').eq(4).should('contain', '—')
  })

  it('counts a converted lead who attended as booked and showed', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Came In', stage: 'new', phone: '34600555666' }).then((lead) => {
      cy.request('POST', `/api/growth/leads/${(lead as { id: string }).id}/convert`).then((res) => {
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: res.body.patientId,
          // Minutes ago, not hours: the visit has to fall on or after the day the
          // lead came in, and an hour back can cross midnight.
          startsAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
          status: 'completed',
        })
      })
    })

    cy.visit('/growth?growth=1')
    cy.get('[data-test="funnel-stage-booked"]').should('contain', '1')
    cy.get('[data-test="funnel-stage-showed"]').should('contain', '1')
    cy.get('[data-test="funnel-stage-converted"]').should('contain', '1')
    cy.contains('td', 'All channels').parent().find('td').eq(4).should('contain', '100%')
  })

  it('speaks the staff member\'s language', () => {
    // The endpoint used to send finished English sentences into a Spanish
    // screen.
    cy.task('db:setStaffLanguage', { teamMemberId: account.teamMemberId, language: 'es' })
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Sin Origen', stage: 'contacted' })

    cy.visit('/growth?growth=1')
    cy.contains('Embudo de captación').should('be.visible')
    cy.get('[data-test="funnel-stage-contacted"]').should('contain', 'Contactado')
    cy.contains('Leads nuevos este mes').should('be.visible')
    cy.contains('1 lead sin origen').scrollIntoView().should('be.visible')
    cy.contains('td', 'Todos los canales').scrollIntoView().should('be.visible')
    cy.contains('td', 'Directo').should('exist')
    cy.contains('New leads this month').should('not.exist')
  })

  it('keeps a lost lead counted at the stage it reached', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Booked Then Lost', stage: 'booked' }).then((lead) => {
      const id = (lead as { id: string }).id

      // Losing it must not erase that it was booked -- that drop-off is the
      // whole reason the funnel is on the page.
      cy.request({ method: 'PATCH', url: `/api/growth/leads/${id}`, body: { stage: 'lost' } })

      cy.visit('/growth?growth=1')
      cy.get('[data-test="funnel-stage-booked"]').should('contain', '1')
    })
  })

  it('hides cost per lead and ROAS until a clinic records what it spent', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Meta Lead', stage: 'converted', source: 'Meta Ads · Sciatica', estimatedValueCents: 100_000 })

    cy.visit('/growth?growth=1')

    // Absent, not zero: "0,00 € per lead" reads as a claim that leads are
    // free rather than as a gap in what we know.
    cy.contains('Cost per lead').should('not.exist')
    cy.contains('ROAS').should('not.exist')
    cy.contains('Revenue attributed').should('be.visible')
    cy.contains('No ad spend recorded this month').scrollIntoView().should('be.visible')
  })

  it('computes cost per lead and ROAS once spend exists', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Meta One', stage: 'converted', source: 'Meta Ads · Sciatica', estimatedValueCents: 100_000 })
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Meta Two', stage: 'contacted', source: 'Meta Ads · Back pain', estimatedValueCents: 100_000 })
    cy.task('db:setChannelSpend', { accountId: account.accountId, channel: 'Meta Ads', amountCents: 20_000 })

    cy.visit('/growth?growth=1')

    // €200 across 2 leads.
    cy.contains('Cost per lead').should('be.visible')
    cy.contains('100 €').should('be.visible')
    // €1,000 of converted value against €200 spent.
    cy.contains('ROAS').scrollIntoView().should('be.visible')
    cy.contains('5.0×').should('be.visible')
  })

  it('groups channels by their prefix, so campaign variants share a row', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Variant One', stage: 'booked', source: 'Meta Ads · Sciatica' })
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Variant Two', stage: 'new', source: 'Meta Ads · Back pain' })
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'From Google', stage: 'new', source: 'Google Ads' })

    cy.visit('/growth?growth=1')

    cy.contains('Channels').scrollIntoView().should('be.visible')
    // One Meta Ads row holding both campaigns, which is how the budget is set.
    cy.contains('td', 'Meta Ads').scrollIntoView().should('be.visible')
    cy.contains('td', 'Meta Ads · Sciatica').should('not.exist')
    cy.contains('td', 'Google Ads').scrollIntoView().should('be.visible')
  })

  it('hides the AI receptionist card, which has nothing behind it yet', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Someone', stage: 'new' })

    cy.visit('/growth?growth=1')

    // A zeroed version of the tier's headline claim would be a statement
    // about a thing that does not exist, not an empty state.
    cy.contains('AI receptionist').should('not.exist')
    cy.contains('Needs attention').scrollIntoView().should('be.visible')
  })

  it('flags leads that have been waiting more than a week', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Forgotten Enquiry', stage: 'contacted', createdAt: daysFromNow(-10) })
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Never Answered', stage: 'new', createdAt: daysFromNow(-12) })
    // Since summer is not this afternoon's work.
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Long Gone', stage: 'new', createdAt: daysFromNow(-60) })

    cy.visit('/growth?growth=1')
    cy.contains('2 leads waiting more than a week').scrollIntoView().should('be.visible')
    // It used to say "contacted or qualified" whatever they were.
    cy.contains('not booked · 1 never contacted').should('be.visible')
  })

  it('lets a clinic type in what it spent, and the cost figures follow', () => {
    // The three cost KPIs cannot be computed from anything this app holds --
    // the money was spent inside Meta. This cell is where they come from
    // until an importer exists.
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Paid Lead', stage: 'converted', source: 'Meta Ads · Sciatica' })

    cy.visit('/growth?growth=1')
    cy.get('[data-test="spend-cell-Meta Ads"]').scrollIntoView().should('contain', '—')
    cy.get('[data-test="spend-cell-Meta Ads"]').click()
    cy.get('[data-test="spend-input-Meta Ads"]').type('480{enter}')

    cy.get('[data-test="spend-cell-Meta Ads"]').should('contain', '480')
    // One converted lead for EUR 480 spent.
    cy.contains('Cost per new patient').scrollIntoView()
    cy.contains('480 €').should('exist')
  })

  it('tells the two kinds of nothing apart', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Referred', stage: 'new', source: 'Referral' })

    cy.visit('/growth?growth=1')
    cy.get('[data-test="spend-cell-Referral"]').scrollIntoView().click()
    cy.get('[data-test="spend-input-Referral"]').type('0{enter}')
    // Zero spent is a figure, and says so.
    cy.get('[data-test="spend-cell-Referral"]').should('not.contain', '—')

    // Clearing it is the other answer: we have not said, so the cost
    // columns go back to blank rather than claiming free patients.
    cy.get('[data-test="spend-cell-Referral"]').click()
    cy.get('[data-test="spend-input-Referral"]').clear().type('{enter}')
    cy.get('[data-test="spend-cell-Referral"]').should('contain', '—')
  })

  // The dashboard is where an unapproved draft gets noticed. Without this it
  // sits on the Reputation screen indefinitely, which is the failure the
  // design tried to fix with an auto-post timer -- see the note in
  // dashboard.get.ts for why surfacing it is the answer instead of posting it.
  it('surfaces review drafts that are waiting for a person', () => {
    cy.task('db:createReview', {
      accountId: account.accountId,
      authorName: 'Waiting On Us',
      rating: 4,
      body: 'Bien en general.',
      draftBody: 'Gracias por la reseña.',
    })

    cy.visit('/growth?growth=1')
    cy.contains('1 AI reply is waiting for approval').scrollIntoView().should('be.visible')
    cy.contains('nothing posts until someone approves').scrollIntoView().should('be.visible')
  })

  it('says nothing about drafts when a review has already been answered', () => {
    cy.task('db:createReview', {
      accountId: account.accountId,
      authorName: 'Already Handled',
      rating: 5,
      body: 'Genial.',
      repliedAt: new Date().toISOString(),
      replyBody: 'Gracias.',
    })

    cy.visit('/growth?growth=1')
    cy.contains('Needs attention').scrollIntoView().should('be.visible')
    cy.contains('waiting for approval').should('not.exist')
  })

  it('refuses to import ad spend until Meta Ads is connected', () => {
    // Names the setting rather than failing. Somebody who has just clicked
    // import can fix this themselves in a minute.
    cy.request({ method: 'POST', url: '/api/growth/sync-ad-spend', failOnStatusCode: false }).then((res) => {
      expect(res.status).to.eq(400)
      expect(JSON.stringify(res.body)).to.contain('Meta Ads is not connected')
    })
  })
})
