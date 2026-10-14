// "¿Qué tal te hemos atendido?": the appointment.satisfaction trigger (fired
// by review-request-cron) asks after the first visit and every Nth, never
// twice a month; {{satisfaction_link}} mints the survey; the patient answers
// on /valorar/<token> with no login; a low score reaches the owners (a task,
// and Reputation's "Para revisar"), a high one is offered the Google review.
//
// The cron reads every account, so each test asserts on its own rows and
// switches its rules off afterwards, as growth-automation-schedules does.

interface SeededAccount { email: string; password: string; accountId: string; clinicId: string; teamMemberId: string }

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const token = () => `t${Date.now()}${Math.floor(Math.random() * 1e6)}`

describe('Satisfaction check', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
    })
  })
  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  const patient = (firstName: string) => cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Valora' })
  const visit = (patientId: string, startsAt: string, status = 'completed') =>
    cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, practitionerId: account.teamMemberId, status, startsAt })
  // Ends inside the cron's window for "2 hours after": the appointment is 30 minutes.
  const endedTwoHoursAgo = () => new Date(Date.now() - 2 * HOUR + 5 * 60 * 1000 - 30 * 60 * 1000).toISOString()
  const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString()

  it('asks after the first visit and every Nth, not twice in a month, and mints one link', () => {
    cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      name: 'Satisfacción',
      triggerEvent: 'appointment.satisfaction',
      filters: { hours_after: 2, first_visit: true, every_visits: 3 },
      // No email on file: the step is skipped, but the link is still minted for it.
      actions: [{ type: 'email', config: { subject: '¿Qué tal, {{first_name}}?', body: '<p>Valora tu visita: {{satisfaction_link}}</p>' } }],
    }).then((rule) => {
      patient('Primera').then((first) => {
        visit(first.id, endedTwoHoursAgo()).then((firstVisit) => {
          patient('Segunda').then((second) => {
            visit(second.id, daysAgo(7))
            visit(second.id, endedTwoHoursAgo()).then((secondVisit) => {
              patient('Tercera').then((third) => {
                visit(third.id, daysAgo(20)).then((asked) => {
                  cy.task('db:insertRows', { table: 'satisfaction_surveys', rows: [{ account_id: account.accountId, appointment_id: asked.id, token: token(), sent_at: daysAgo(10) }] })
                })
                visit(third.id, daysAgo(14))
                visit(third.id, endedTwoHoursAgo()).then((thirdVisit) => {
                  cy.request({ method: 'POST', url: '/api/automations/review-request-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } }).its('status').should('eq', 200)
                  cy.task<{ appointment_id: string }[]>('auto:ruleSends', { ruleId: rule.id }).then((rows) => {
                    const ids = rows.map((r) => r.appointment_id)
                    // The first visit: asked. The second of every 3: not. The third, but asked 10 days ago: not.
                    expect(ids).to.deep.eq([firstVisit.id])
                    expect(ids).not.to.include(secondVisit.id)
                    expect(ids).not.to.include(thirdVisit.id)
                  })
                  cy.task<{ token: string; rule_id: string }[]>('db:selectRows', { table: 'satisfaction_surveys', columns: 'token, rule_id', match: { appointment_id: firstVisit.id } }).then((rows) => {
                    expect(rows).to.have.length(1)
                    expect(rows[0]!.rule_id).to.eq(rule.id)
                  })
                  // Run again: the same visit is not asked twice.
                  cy.request({ method: 'POST', url: '/api/automations/review-request-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
                  cy.task('auto:ruleSends', { ruleId: rule.id }).should('have.length', 1)
                })
              })
            })
          })
        })
      })
    })
  })

  it('takes a low score with no login, tells the owners, and is resolved on Reputation', () => {
    const t = token()
    patient('Elena').then((p) => {
      visit(p.id, daysAgo(0.2)).then((appt) => {
        cy.task('db:insertRows', { table: 'satisfaction_surveys', rows: [{ account_id: account.accountId, appointment_id: appt.id, token: t }] })
        cy.visit(`/valorar/${t}`)
        cy.location('pathname').should('eq', `/valorar/${t}`)
        cy.contains('h1', 'Elena, ¿qué tal te hemos atendido').should('be.visible')
        cy.get('[data-cy=satisfaction-score-2]').click()
        cy.get('[data-cy=satisfaction-improve]').should('be.visible')
        cy.get('[data-cy=satisfaction-comment]').type('Esperé 25 minutos sin aviso.')
        cy.get('[data-cy=satisfaction-send]').click()
        cy.get('[data-cy=satisfaction-thanks]').should('contain', 'Gracias por decírnoslo')
        cy.get('[data-cy=satisfaction-review]').should('not.exist')
        cy.task<{ score: number; comment: string; answered_at: string | null }[]>('db:selectRows', { table: 'satisfaction_surveys', columns: 'score, comment, answered_at', match: { token: t } }).its('0').then((row) => {
          expect(row.score).to.eq(2)
          expect(row.comment).to.eq('Esperé 25 minutos sin aviso.')
          expect(row.answered_at).not.to.be.null
        })
        cy.task<{ title: string; team_member_id: string }[]>('db:selectRows', { table: 'staff_tasks', columns: 'title, team_member_id', match: { patient_id: p.id } }).then((tasks) => {
          expect(tasks).to.have.length(1)
          expect(tasks[0]!.title).to.contain('Valoración 2/5')
          expect(tasks[0]!.team_member_id).to.eq(account.teamMemberId)
        })

        cy.login(account.email, account.password)
        cy.visit('/growth/reputation')
        cy.get('[data-cy=satisfaction-panel][data-ready=true]', { timeout: 20000 })
        cy.get('[data-cy=satisfaction-average]').invoke('text').should('match', /2[.,]0/)
        cy.get('[data-cy=satisfaction-alert]').should('have.length', 1).and('contain', 'Elena Valora')
        cy.get('[data-cy=satisfaction-alert-comment]').should('contain', 'Esperé 25 minutos sin aviso.')
        cy.get('[data-cy=satisfaction-resolve]').click()
        cy.get('[data-cy=satisfaction-no-alerts]').should('be.visible')
        cy.task<{ resolved_at: string | null }[]>('db:selectRows', { table: 'satisfaction_surveys', columns: 'resolved_at', match: { token: t } }).its('0.resolved_at').should('not.be.null')
      })
    })
  })

  it('offers the Google review page for a high score, through a tracked link', () => {
    const t = token()
    cy.task('db:updateRows', { table: 'accounts', values: { google_review_url: 'https://g.page/r/clinica-demo/review' }, match: { id: account.accountId } })
    patient('Pablo').then((p) => {
      visit(p.id, daysAgo(0.2)).then((appt) => {
        cy.task('db:insertRows', { table: 'satisfaction_surveys', rows: [{ account_id: account.accountId, appointment_id: appt.id, token: t }] })
        cy.visit(`/valorar/${t}`)
        cy.get('[data-cy=satisfaction-score-5]').click()
        cy.get('[data-cy=satisfaction-improve]').should('not.exist')
        cy.get('[data-cy=satisfaction-review]').should('have.attr', 'href').and('match', /\/api\/r\/[a-f0-9]+$/)
        cy.task<{ appointment_id: string }[]>('db:selectRows', { table: 'review_requests', columns: 'appointment_id', match: { patient_id: p.id } }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]!.appointment_id).to.eq(appt.id)
        })
        cy.task<unknown[]>('db:selectRows', { table: 'staff_tasks', columns: 'id', match: { patient_id: p.id } }).should('have.length', 0)
        // Reloaded, it remembers the answer and the same review link.
        cy.reload()
        cy.get('[data-cy=satisfaction-score-5]').should('have.attr', 'aria-checked', 'true')
        cy.get('[data-cy=satisfaction-review]').should('exist')
        cy.task('db:selectRows', { table: 'review_requests', columns: 'id', match: { patient_id: p.id } }).should('have.length', 1)
      })
    })
  })

  it('refuses a link that does not exist', () => {
    cy.visit('/valorar/nope-not-a-token')
    cy.get('[data-cy=satisfaction-invalid]').should('be.visible')
    cy.request({ method: 'POST', url: '/api/satisfaction/nope-not-a-token', body: { score: 1 }, failOnStatusCode: false }).its('status').should('eq', 404)
  })
})
