// The segment trigger, from the builder: a group of patients, the live
// "N match today" count while the filters are edited, the activation dialog,
// and -- the point -- that the count is exactly who the cron then enrols.
// The count is computed in bulk (server/utils/segmentAudience.ts) and the
// enrolment per patient (automationEngine: enrolDueSegments), so this is
// what keeps the two honest with each other.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

describe('Segment trigger', () => {
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

  it('counts who matches today, and the cron enrols exactly them', () => {
    const tag = `grupo-${Math.random().toString(36).slice(2, 8)}`
    const seed = (firstName: string, extra: Record<string, unknown> = {}) =>
      cy.task('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName, tags: [tag], ...extra })
    seed('Ana')
    seed('Bea')
    seed('Carla')
    // Never enrolled: a minor, and someone who asked not to be contacted.
    seed('Menor', { isMinor: true })
    seed('Nocontactar', { doNotContact: true })
    cy.task('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Fuera', tags: ['otro'] })

    cy.visit('/automations/new')
    cy.get('[data-test="trigger-select"]').select('segment')
    cy.get('[data-test="segment-once"]').click()
    cy.get('[data-test="segment-filter-add"]').select('tag_contains')
    cy.get('[data-test="segment-filter-tag_contains"] input').type(tag)
    cy.get('[data-test="segment-count"]').should('contain', '3')
    cy.get('[data-test="segment-count"]').contains('See the list').click()
    cy.get('[data-test="segment-count"]').should('contain', 'Ana').and('not.contain', 'Menor').and('not.contain', 'Fuera')

    cy.get('[data-test="insert-root-root-0"]').click({ force: true })
    cy.get('[data-test="add-step-tag"]').click()
    cy.get('[data-test="tag-input"]').type('contactado')
    cy.get('[data-test="save"]').click()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)

    // Switching it on says how many, and offers test mode first.
    cy.get('[data-test="automation-enabled"]').click()
    cy.get('[data-test="segment-activate"]').should('contain', '3 patients')
    cy.get('[data-test="segment-activate-test"]').click()
    cy.get('[data-test="automation-enabled"]').should('have.attr', 'aria-checked', 'true')

    cy.location('pathname').then((path) => {
      const ruleId = path.split('/').pop()!
      cy.task<{ dry_run: boolean; entry_mode: string; segment: any }>('auto:ruleRow', { ruleId }).then((rule) => {
        expect(rule.dry_run, 'switched on in test mode').to.eq(true)
        expect(rule.segment.schedule.kind).to.eq('once')
        expect(rule.segment.filters).to.deep.eq({ tag_contains: tag })
      })
      cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
      cy.task<{ patient_id: string }[]>('auto:runsForRule', { ruleId }).should('have.length', 3)
      // Once is once: the next tick enrols nobody new.
      cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
      cy.task<{ patient_id: string }[]>('auto:runsForRule', { ruleId }).should('have.length', 3)
    })
  })
})
