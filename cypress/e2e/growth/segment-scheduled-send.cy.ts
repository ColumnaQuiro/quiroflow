// A one-off group send on a date (TriggerPanel, schedule.starts_at): switched
// on beforehand, it sends nothing until that time, and then enrols the group
// once, as a "send now" one does. The engine has waited for starts_at all
// along (lastScheduledOccurrence); this is the builder letting you set it.
describe('Scheduling a group send', () => {
  let account: { email: string; password: string; accountId: string; clinicId: string }

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as any
      cy.login(account.email, account.password)
    })
  })
  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  it('waits for the date and time chosen, then enrols the group once', () => {
    const tag = `prog-${Math.random().toString(36).slice(2, 8)}`
    cy.task('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', tags: [tag] })
    cy.task('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bea', tags: [tag] })

    cy.visit('/automations/new')
    cy.get('[data-test="trigger-select"]').select('segment')
    cy.get('[data-test="segment-once"]').click()
    cy.get('[data-test="segment-once-scheduled"]').click()
    const day = new Date(Date.now() + 3 * 86_400_000)
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    cy.get('[data-test="segment-once-date"]').clear().type(date).blur()
    cy.get('[data-test="segment-once-time"]').clear().type('11:30').blur()
    cy.contains('11:30').should('be.visible')
    cy.get('[data-test="segment-filter-add"]').select('tag_contains')
    cy.get('[data-test="segment-filter-tag_contains"] input').type(tag)
    cy.get('[data-test="segment-count"]').should('contain', '2')

    cy.get('[data-test="insert-root-root-0"]').click({ force: true })
    cy.get('[data-test="add-step-tag"]').click()
    cy.get('[data-test="tag-input"]').clear().type('contactado')
    cy.get('[data-test="save"]').click()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)

    cy.get('[data-test="automation-enabled"]').click()
    cy.get('[data-test="segment-activate"]').should('contain', '2 patients').and('contain', '11:30')
    cy.get('[data-test="segment-activate-test"]').click()
    cy.get('[data-test="automation-enabled"]').should('have.attr', 'aria-checked', 'true')

    cy.location('pathname').then((path) => {
      const ruleId = path.split('/').pop()!
      const cron = () => cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
      cy.task<{ segment: any }>('auto:ruleRow', { ruleId }).then((rule) => {
        expect(rule.segment.schedule.kind).to.eq('once')
        // 11:30 on the clinic's clock (Madrid), whatever the browser's.
        const at = new Date(rule.segment.schedule.starts_at)
        expect(at.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })).to.eq('11:30')

        // Before the date: nothing.
        cron()
        cy.task('auto:runsForRule', { ruleId }).should('have.length', 0)

        // The date arrives (moved back rather than waited for): the group enters, once.
        cy.task('db:updateRows', { table: 'automation_rules', values: { segment: { ...rule.segment, schedule: { ...rule.segment.schedule, starts_at: new Date(Date.now() - 60_000).toISOString() } } }, match: { id: ruleId } })
        cron()
        cy.task('auto:runsForRule', { ruleId }).should('have.length', 2)
        cron()
        cy.task('auto:runsForRule', { ruleId }).should('have.length', 2)
      })
    })
  })
})
