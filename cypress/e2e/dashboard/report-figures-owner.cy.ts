// Every figure on the dashboard and on every report, as the clinic's owner
// sees them, pinned against a generated clinic.
//
// Written before the reports were reworked for speed, and recorded from the
// pages as they were then (cypress/fixtures/report-figures-owner.json), so
// that rework -- fewer requests, different queries, figures computed
// elsewhere -- has to land on exactly the same numbers. See
// cypress/support/reportFigures.ts for what is compared and how.
//
// The browser's Date is frozen to NOW, the instant the clinic was generated
// against, so "this month", "this week" and "today" mean the same days on
// every run.
import { defaultLocale, expectFigures, pickPreset, saveRecordedFigures, type FigureSnapshot } from '../../support/reportFigures'

const FIXTURE = 'report-figures-owner.json'
// A Wednesday in the middle of a month, mid-morning: this week, this month,
// last month and the day so far all have something in them.
const NOW = new Date(2026, 5, 17, 10, 30, 0, 0)

describe('Report and dashboard figures, as the owner', () => {
  const recorded: Record<string, FigureSnapshot> = {}
  let owner: { email: string; password: string }

  before(() => {
    cy.seedStaffAccount().then((account) => {
      owner = { email: account.email, password: account.password }
      cy.task('db:seedReportDataset', { accountId: account.accountId, clinicId: account.clinicId, ownerTeamMemberId: account.teamMemberId, nowIso: NOW.toISOString() }, { timeout: 120000 })
    })
  })
  after(() => saveRecordedFigures(FIXTURE, recorded))

  function open(path: string) {
    cy.login(owner.email, owner.password)
    cy.clock(NOW.getTime(), ['Date'])
    cy.visit(path, { onBeforeLoad: (win) => defaultLocale(win) })
  }
  const figures = (key: string) => expectFigures(FIXTURE, recorded, key)
  // No clinic filter here: ReportsPractitionerClinicFilters declares
  // `showClinic?: boolean`, which Vue casts to false when a page leaves it
  // out, so no report has ever shown its clinic picker. The pages' clinic
  // code paths are unreachable from the UI and cannot be pinned from it.
  const practitioner = (name: string) => cy.get('[data-cy="report-practitioner-filter"]').select(name)

  it('dashboard', () => {
    open('/dashboard')
    figures('dashboard')
    pickPreset('Last 30 days')
    figures('dashboard / last 30 days')
    practitioner('Beatriz Ferrando')
    figures('dashboard / last 30 days / Beatriz')
  })

  it('income', () => {
    open('/reports/income')
    figures('income')
    practitioner('Beatriz Ferrando')
    figures('income / Beatriz')
    practitioner('All practitioners')
    pickPreset('Last month')
    figures('income / last month')
    practitioner('Natacha Ruiz')
    figures('income / last month / Natacha')
  })

  it('daily transactions', () => {
    open('/reports/daily-transactions')
    figures('daily transactions')
    practitioner('Olga Owner')
    figures('daily transactions / Olga')
    practitioner('All practitioners')
    cy.contains('button', '‹').click()
    figures('daily transactions / yesterday')
  })

  it('income performance', () => {
    open('/reports/income-performance')
    figures('income performance')
    practitioner('Beatriz Ferrando')
    figures('income performance / Beatriz')
    practitioner('All practitioners')
    pickPreset('Last month')
    figures('income performance / last month')
  })

  it('statistics', () => {
    open('/reports/statistics')
    figures('statistics')
    practitioner('Natacha Ruiz')
    figures('statistics / Natacha')
    practitioner('All practitioners')
    pickPreset('Last month')
    figures('statistics / last month')
  })

  it('scheduled reminders', () => {
    open('/reports/scheduled-reminders')
    figures('scheduled reminders')
    pickPreset('Last month')
    figures('scheduled reminders / last month')
  })

  it('upcoming visits and appointment distribution', () => {
    open('/reports/upcoming-visits')
    figures('upcoming visits')
    cy.contains('button', '‹').click()
    figures('upcoming visits / last month')

    open('/reports/appointment-distribution')
    figures('appointment distribution')
    practitioner('Olga Owner')
    figures('appointment distribution / Olga')
  })

  it('debtors and memberships', () => {
    open('/reports/debtors')
    figures('debtors')
    open('/reports/memberships')
    figures('memberships')
  })

  it('custom reports', () => {
    open('/reports/custom')
    figures('custom')
    const choose = (label: string, value: string) => cy.contains('label', label).parent().find('select').select(value)
    choose('Group by', 'Appointment type')
    figures('custom / appointments by type')
    choose('Group by', 'Practitioner')
    figures('custom / appointments by practitioner')
    choose('Data source', 'Payments')
    figures('custom / payments total by month')
    choose('Group by', 'Payment method')
    figures('custom / payments total by method')
    choose('Group by', 'Practitioner')
    choose('Metric', 'Count')
    figures('custom / payment count by practitioner')
    choose('Data source', 'Patients')
    figures('custom / patients by practitioner')
    choose('Group by', 'Recall status')
    figures('custom / patients by recall status')
  })
})
