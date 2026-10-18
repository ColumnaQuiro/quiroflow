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
    // Nor someone archived: archiving says it stops reminders.
    seed('Archivada', { status: 'inactive' })
    cy.task('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Fuera', tags: ['otro'] })

    cy.visit('/automations/new')
    cy.get('[data-test="trigger-select"]').select('segment')
    cy.get('[data-test="segment-once"]').click()
    cy.get('[data-test="segment-filter-add"]').select('tag_contains')
    cy.get('[data-test="segment-filter-tag_contains"] input').type(tag)
    cy.get('[data-test="segment-count"]').should('contain', '3')
    cy.get('[data-test="segment-count"]').contains('See the list').click()
    cy.get('[data-test="segment-count"]').should('contain', 'Ana').and('not.contain', 'Menor').and('not.contain', 'Archivada').and('not.contain', 'Fuera')

    cy.get('[data-test="insert-root-root-0"]').click({ force: true })
    cy.get('[data-test="add-step-tag"]').click()
    // The clinic's own tags are offered as chips (not a <datalist>, whose
    // popup crashes headless Electron), and picking one fills the field.
    cy.get('[data-test="tag-input"]').type(tag.slice(0, 5))
    cy.get('[data-test="tag-suggestions"]').contains('button', tag).click()
    cy.get('[data-test="tag-input"]').should('have.value', tag)
    cy.get('[data-test="tag-input"]').clear().type('contactado')
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

  it('a band of last visits and a visit-count range: counted, then enrolled', () => {
    const tag = `franja-${Math.random().toString(36).slice(2, 8)}`
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    const withVisits = (firstName: string, visitDaysAgo: number[]) =>
      cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName, tags: [tag] }).then((p) => {
        for (const d of visitDaysAgo) {
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: daysAgo(d), status: 'completed' })
        }
      })
    // One visit, two months ago: the "second visit pending" band.
    withVisits('Unavisita', [60])
    // Two visits, the last three months ago: in the band, but not a first-timer.
    withVisits('Dosvisitas', [200, 100])
    // Too recent, and too long ago, for a 21-to-120-day band.
    withVisits('Reciente', [5])
    withVisits('Antigua', [400])
    // Never came at all: not lapsed.
    cy.task('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nunca', tags: [tag] })

    cy.visit('/automations/new')
    cy.get('[data-test="trigger-select"]').select('segment')
    cy.get('[data-test="segment-once"]').click()
    cy.get('[data-test="segment-filter-add"]').select('tag_contains')
    cy.get('[data-test="segment-filter-tag_contains"] input').type(tag)
    cy.get('[data-test="segment-count"]').should('contain', '5')
    // More than 21 days ago...
    cy.get('[data-test="segment-filter-add"]').select('last_visit')
    cy.get('[data-test="segment-filter-last_visit"] select').select('days')
    cy.get('[data-test="segment-filter-last_visit"] input').type('{selectall}21')
    cy.get('[data-test="segment-count"]').should('contain', '3')
    // ...and at most 120 days ago.
    cy.get('[data-test="segment-filter-add"]').select('last_visit_within')
    cy.get('[data-test="segment-filter-last_visit_within"] input').type('{selectall}120')
    cy.get('[data-test="segment-count"]').should('contain', '2')
    // Only those who came once.
    cy.get('[data-test="segment-filter-add"]').select('max_visits')
    cy.get('[data-test="segment-filter-max_visits"] input').type('{selectall}1')
    cy.get('[data-test="segment-count"]').should('contain', '1')
    cy.get('[data-test="segment-count"]').contains('See the list').click()
    cy.get('[data-test="segment-count"]').should('contain', 'Unavisita').and('not.contain', 'Dosvisitas').and('not.contain', 'Reciente').and('not.contain', 'Antigua').and('not.contain', 'Nunca')
    // Two or more: the other side of the split, and the exact-count filter is not offered twice.
    cy.get('[data-test="segment-filter-max_visits"] button[aria-label]').click()
    cy.get('[data-test="segment-filter-add"]').select('min_visits')
    cy.get('[data-test="segment-filter-min_visits"] input').type('{selectall}2')
    cy.get('[data-test="segment-count"]').should('contain', '1')
    cy.get('[data-test="segment-count"]').should('contain', 'Dosvisitas').and('not.contain', 'Unavisita')

    cy.get('[data-test="insert-root-root-0"]').click({ force: true })
    cy.get('[data-test="add-step-tag"]').click()
    cy.get('[data-test="tag-input"]').type('contactado')
    cy.get('[data-test="save"]').click()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
    cy.get('[data-test="automation-enabled"]').click()
    cy.get('[data-test="segment-activate"]').should('contain', '1 patient')
    cy.get('[data-test="segment-activate-test"]').click()
    cy.location('pathname').then((path) => {
      const ruleId = path.split('/').pop()!
      cy.task<{ segment: any }>('auto:ruleRow', { ruleId }).then((rule) => {
        expect(rule.segment.filters).to.deep.eq({ tag_contains: tag, last_visit_before_days: 21, last_visit_within_days: 120, min_visits: 2 })
      })
      cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
      cy.task<{ patient_id: string }[]>('auto:runsForRule', { ruleId }).should('have.length', 1)
    })
  })

  it('a daily cap takes the most recently seen first and the rest the next day', () => {
    const tag = `tope-${Math.random().toString(36).slice(2, 8)}`
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    const ids: Record<string, string> = {}
    const seen = (firstName: string, lastVisitDaysAgo: number) =>
      cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName, tags: [tag] }).then((p) => {
        ids[firstName] = p.id
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: daysAgo(lastVisitDaysAgo), status: 'completed' })
      })
    seen('Ayer', 1)
    seen('Semana', 7)
    seen('Mes', 30)

    cy.visit('/automations/new')
    cy.get('[data-test="trigger-select"]').select('segment')
    cy.get('[data-test="segment-once"]').click()
    cy.get('[data-test="segment-daily-limit"]').type('2')
    cy.get('[data-test="segment-filter-add"]').select('tag_contains')
    cy.get('[data-test="segment-filter-tag_contains"] input').type(tag)
    cy.get('[data-test="segment-count"]').should('contain', '3')
    cy.get('[data-test="insert-root-root-0"]').click({ force: true })
    cy.get('[data-test="add-step-tag"]').click()
    cy.get('[data-test="tag-input"]').type('contactado')
    cy.get('[data-test="save"]').click()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
    cy.get('[data-test="automation-enabled"]').click()
    // The dialog says how it will be paced.
    cy.get('[data-test="segment-activate-pace"]').should('contain', '2 per day').and('contain', '2 days')
    cy.get('[data-test="segment-activate-test"]').click()
    cy.get('[data-test="automation-enabled"]').should('have.attr', 'aria-checked', 'true')

    const cron = () => cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
    cy.location('pathname').then((path) => {
      const ruleId = path.split('/').pop()!
      cy.task<{ segment: any }>('auto:ruleRow', { ruleId }).then((rule) => expect(rule.segment.daily_limit).to.eq(2))
      cron()
      cy.task<{ patient_id: string }[]>('auto:runsForRule', { ruleId }).then((runs) => {
        expect(runs.map((r) => r.patient_id).sort(), 'the two most recently seen').to.deep.eq([ids.Ayer, ids.Semana].sort())
      })
      // The same day again: nothing more.
      cron()
      cy.task<{ patient_id: string }[]>('auto:runsForRule', { ruleId }).should('have.length', 2)
      // The next day (the last run reads as yesterday): the rest come in.
      cy.task('auto:setSegmentLastRunAt', { ruleId, at: new Date(Date.now() - 86_400_000).toISOString() })
      cron()
      cy.task<{ patient_id: string }[]>('auto:runsForRule', { ruleId }).should('have.length', 3)
      // Everyone is in: another day adds nobody, and once a day enrols fewer than the cap the carry-over stops on its own.
      cy.task('auto:setSegmentLastRunAt', { ruleId, at: new Date(Date.now() - 86_400_000).toISOString() })
      cron()
      cy.task<{ patient_id: string }[]>('auto:runsForRule', { ruleId }).should('have.length', 3)
    })
  })

  it('a group of patients behind on their care plan: counted, then enrolled', () => {
    const tag = `plan-${Math.random().toString(36).slice(2, 8)}`
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
    const day = (d: Date) => d.toISOString().slice(0, 10)
    const withPlan = (firstName: string, opts: { futureVisit?: boolean } = {}) =>
      cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName, tags: [tag] }).then((p) => {
        // Weekly, ten visits, one done a month ago: three weeks overdue.
        cy.task('db:createCarePlan', { accountId: account.accountId, patientId: p.id, totalVisits: 10, startedAt: day(daysAgo(60)) })
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: daysAgo(30).toISOString(), status: 'completed' })
        if (opts.futureVisit) cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() })
      })
    withPlan('Atrasada')
    // Booked again: not behind any more.
    withPlan('Reservada', { futureVisit: true })
    // No plan at all.
    cy.task('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sinplan', tags: [tag] })

    cy.visit('/automations/new')
    cy.get('[data-test="trigger-select"]').select('segment')
    cy.get('[data-test="segment-once"]').click()
    cy.get('[data-test="segment-filter-add"]').select('tag_contains')
    cy.get('[data-test="segment-filter-tag_contains"] input').type(tag)
    cy.get('[data-test="segment-count"]').should('contain', '3')
    cy.get('[data-test="segment-filter-add"]').select('care_plan_overdue')
    cy.get('[data-test="segment-filter-care_plan_overdue"] input').should('have.value', '7')
    cy.get('[data-test="segment-count"]').should('contain', '1')
    cy.get('[data-test="segment-count"]').contains('See the list').click()
    cy.get('[data-test="segment-count"]').should('contain', 'Atrasada').and('not.contain', 'Reservada').and('not.contain', 'Sinplan')

    cy.get('[data-test="insert-root-root-0"]').click({ force: true })
    cy.get('[data-test="add-step-tag"]').click()
    cy.get('[data-test="tag-input"]').type('plan sin terminar')
    cy.get('[data-test="save"]').click()
    cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
    cy.get('[data-test="automation-enabled"]').click()
    cy.get('[data-test="segment-activate"]').should('contain', '1 patient')
    cy.get('[data-test="segment-activate-test"]').click()
    cy.location('pathname').then((path) => {
      const ruleId = path.split('/').pop()!
      cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
      cy.task<{ patient_id: string }[]>('auto:runsForRule', { ruleId }).should('have.length', 1)
    })
  })
})
