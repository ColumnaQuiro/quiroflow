// The same figures as report-figures-owner, for the people whose roles narrow
// them -- and the sidebar badges, for everyone.
//
//   Beatriz, Practitioner role: reports_own_only and dashboard_scope 'own'
//     (the practitioner filter is pinned to her and hidden), patients_scope
//     'own' (row-level security hides every other practitioner's patients,
//     and their invoices and payments with them), no Inbox.
//   Fina, Front Desk role: the whole clinic's dashboard and the Inbox, no
//     reports at all.
//
// Recorded before the reports were reworked for speed; see
// cypress/support/reportFigures.ts.
import { defaultLocale, expectFigures, saveRecordedFigures, type FigureSnapshot } from '../../support/reportFigures'

const FIXTURE = 'report-figures-scoped.json'
const NOW = new Date(2026, 5, 17, 10, 30, 0, 0)

interface Person { email: string; password: string; name: string }

describe('Report and dashboard figures, narrowed by role', () => {
  const recorded: Record<string, FigureSnapshot> = {}
  let owner: Person
  let beatriz: Person
  let frontDesk: Person

  before(() => {
    cy.seedStaffAccount().then((account) => {
      owner = { email: account.email, password: account.password, name: 'Olga Owner' }
      cy.task<{ beatriz: Person; frontDesk: Person }>(
        'db:seedReportDataset',
        { accountId: account.accountId, clinicId: account.clinicId, ownerTeamMemberId: account.teamMemberId, nowIso: NOW.toISOString() },
        { timeout: 120000 },
      ).then((seeded) => {
        beatriz = seeded.beatriz
        frontDesk = seeded.frontDesk
      })
    })
  })
  after(() => saveRecordedFigures(FIXTURE, recorded))

  function open(who: Person, path: string) {
    cy.login(who.email, who.password)
    cy.clock(NOW.getTime(), ['Date'])
    cy.visit(path, { onBeforeLoad: (win) => defaultLocale(win) })
  }
  const figures = (key: string) => expectFigures(FIXTURE, recorded, key)

  it("a practitioner's own dashboard and reports", () => {
    open(beatriz, '/dashboard')
    cy.get('[data-cy="report-own-only"]').should('be.visible')
    figures('Beatriz / dashboard')
    for (const path of ['/reports/income', '/reports/daily-transactions', '/reports/income-performance', '/reports/statistics', '/reports/upcoming-visits', '/reports/appointment-distribution']) {
      open(beatriz, path)
      figures(`Beatriz / ${path}`)
    }
  })

  it('refuses a practitioner the reports that cannot be narrowed to them', () => {
    for (const path of ['/reports/debtors', '/reports/memberships', '/reports/scheduled-reminders', '/reports/custom']) {
      open(beatriz, path)
      cy.location('pathname').should('not.eq', path)
    }
  })

  it("front desk: the whole clinic's dashboard, and no reports", () => {
    open(frontDesk, '/dashboard')
    figures('Front desk / dashboard')
    open(frontDesk, '/reports/income')
    cy.location('pathname').should('not.eq', '/reports/income')
  })

  // The Inbox badge is the Inbox's own "unread" count: conversations whose
  // last message came in after this person last read them, and that they
  // have not archived. Compared with the conversation list itself for three
  // people who see different things -- the owner (reads seeded on seven in
  // ten conversations), front desk (no reads at all, so every conversation
  // whose last message is inbound) and a practitioner with no Inbox access
  // (nothing, and no badge).
  it('the Inbox badge counts what the Inbox calls unread', () => {
    for (const who of [owner, frontDesk]) {
      cy.task<{ view: number; badge: number | string }>('db:inboxUnreadCounts', { email: who.email, password: who.password }).then(({ view, badge }) => {
        expect(view, `${who.name}: unread conversations`).to.be.greaterThan(0)
        open(who, '/dashboard')
        cy.get('[data-cy="nav-badge-inbox"]').should('have.text', String(view))
        // And the count the sidebar is given, however it is asked for.
        if (typeof badge === 'number') expect(badge, `${who.name}: badge count`).to.equal(view)
      })
    }
    cy.task<{ view: number; badge: number | string }>('db:inboxUnreadCounts', { email: beatriz.email, password: beatriz.password }).then(({ view, badge }) => {
      expect(view, 'no Inbox access: nothing unread').to.equal(0)
      if (typeof badge === 'number') expect(badge).to.equal(0)
      open(beatriz, '/dashboard')
      cy.get('[data-cy="report-own-only"]').should('be.visible')
      cy.get('[data-cy="nav-badge-inbox"]').should('not.exist')
    })
  })
})
