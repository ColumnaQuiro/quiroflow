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
}

describe('Growth dashboard', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  it('counts the funnel by how far a lead got, not where it sits now', () => {
    // Four leads, each parked at a different stage. Every one of them has
    // been through every stage below it.
    for (const [name, stage] of [
      ['Only Enquired', 'new'],
      ['Got Contacted', 'contacted'],
      ['Got Booked', 'booked'],
      ['Became A Patient', 'converted'],
    ] as const) {
      cy.task('db:createLead', { accountId: account.accountId, fullName: name, stage, estimatedValueCents: 100_000 })
    }

    cy.visit('/growth?growth=1')

    cy.contains('Acquisition funnel').should('be.visible')
    cy.get('[data-test="funnel-stage-new"]').should('contain', '4')
    cy.get('[data-test="funnel-stage-contacted"]').should('contain', '3')
    cy.get('[data-test="funnel-stage-booked"]').should('contain', '2')
    cy.get('[data-test="funnel-stage-showed"]').should('contain', '1')
    cy.get('[data-test="funnel-stage-converted"]').should('contain', '1')
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

    // Absent, not zero: "€0.00 per lead" reads as a claim that leads are
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
    cy.contains('€100').should('be.visible')
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
    const longAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString()
    cy.task('db:createLead', {
      accountId: account.accountId,
      fullName: 'Forgotten Enquiry',
      stage: 'contacted',
      createdAt: longAgo,
    })

    cy.visit('/growth?growth=1')
    cy.contains('leads waiting more than a week').scrollIntoView().should('be.visible')
  })
})
