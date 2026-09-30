// Report pages (Reports > Report pages): a clinic's own dashboards, built from
// sections of the standard reports, saved reports, or new ones from the
// metric catalogue -- and "Download PDF" on them and on every report.
import { defaultLocale } from '../../support/reportFigures'

const PASSWORD = 'Test1234!'
// The instant the generated clinic is built around (see report-figures-owner).
const NOW = new Date(2026, 5, 17, 10, 30, 0, 0)

interface Account {
  email: string
  password: string
  accountId: string
  clinicId: string
  teamMemberId: string
}

type BlockSpec = { title: string; metric: string; split?: string; chart?: string; span?: number }
const block = (b: BlockSpec, i: number) => ({
  id: `b${i}`,
  title: b.title,
  span: b.span ?? 3,
  config: { metric: b.metric, split: b.split ?? 'none', chart: b.chart ?? (b.split ? 'table' : 'number'), period: { mode: 'page' } },
})

/** A page made as the owner, through the same policies the app goes through. */
function createPage(account: Account, name: string, blocks: BlockSpec[], extra: Record<string, unknown> = {}) {
  return cy
    .task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
      email: account.email,
      password: account.password,
      table: 'report_pages',
      op: 'insert',
      values: { account_id: account.accountId, name, blocks: blocks.map(block), settings: { period: 'this_month', compare: 'previous_period' }, created_by: account.teamMemberId, ...extra },
    })
    .then((r) => {
      expect(r.error).to.eq(null)
      return cy.task<{ id: string }[]>('db:selectRows', { table: 'report_pages', columns: 'id', match: { account_id: account.accountId, name } }).then((rows) => rows[0]!.id)
    })
}

const blockNamed = (title: string) => cy.contains('[data-cy="report-block"]', title)
const valueOf = (title: string) => blockNamed(title).find('[data-cy="report-block-value"]').invoke('text').then((s) => s.replace(/\s+/g, ' ').trim())
/** A table block as { label: value }. */
const tableOf = (title: string) =>
  blockNamed(title)
    .find('tbody tr')
    .then(($rows): Record<string, string> => Object.fromEntries([...$rows].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent!.replace(/\s+/g, ' ').trim())).filter((r) => r[0] !== 'Total')))
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('Report pages', () => {
  it('starts a page from a template, and every block on it draws', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/reports')
      cy.clickUntil('[data-cy="report-template-monthly"]', '[data-cy="report-page-create"]')
      cy.get('[data-cy="report-page-create-name"]').should('have.value', 'Monthly management')
      cy.get('[data-cy="confirm-dialog"]').contains('button', 'Create').click()
      cy.location('pathname').should('match', /^\/reports\/pages\//)
      cy.get('[data-cy="report-page-title"]').should('contain', 'Monthly management')
      cy.get('[data-cy="report-block"]').should('have.length', 10)
      // Nothing left loading and nothing refused: an empty clinic still has figures of zero.
      cy.get('[data-cy="report-block"][aria-busy]').should('not.exist')
      cy.get('[data-cy="report-block-unavailable"]').should('not.exist')
      cy.contains('Could not load').should('not.exist')
      cy.visit('/reports')
      cy.get('[data-cy="report-page-card"]').should('have.length', 1).and('contain', 'Monthly management').and('contain', 'Whole clinic')
    })
  })

  it('builds a block from the catalogue, keeps it, and saves it for other pages', () => {
    cy.seedStaffAccount().then((account) => {
      createPage(account, 'Mine', []).then((id) => {
        cy.intercept('PATCH', '**/rest/v1/report_pages*').as('savePage')
        cy.login(account.email, account.password)
        cy.visit(`/reports/pages/${id}`)
        cy.clickUntil('[data-cy="report-page-edit"]', '[data-cy="report-page-done"]')
        cy.get('[data-cy="report-page-add"]').click()
        cy.get('[data-cy="report-add-new"]').click()
        cy.get('[data-cy="report-builder-search"]').type('income paid')
        cy.get('[data-cy="report-metric-income_paid"]').click()
        cy.get('[data-cy="report-split-method"]').click()
        cy.get('[data-cy="report-chart-donut"]').click()
        cy.get('[data-cy="report-builder-title"]').should('have.value', 'Income paid by payment method')
        cy.get('[data-cy="report-builder-add"]').click()
        cy.wait('@savePage')
        cy.get('[data-cy="report-page-done"]').click()
        cy.wait('@savePage')

        cy.reload()
        blockNamed('Income paid by payment method').should('exist')
        cy.task<any[]>('db:selectRows', { table: 'custom_reports', columns: 'name, config', match: { account_id: account.accountId } }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0].name).to.eq('Income paid by payment method')
          expect(rows[0].config).to.include({ v: 2, metric: 'income_paid', split: 'method', chart: 'donut' })
        })
      })
    })
  })

  it('offers a report saved by the old Custom Reports page, and counts every patient', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:seedManyPatients', { accountId: account.accountId, clinicId: account.clinicId, count: 1052 }, { timeout: 120000 })
      cy.task('db:settingsWriteAsStaff', {
        email: account.email,
        password: account.password,
        table: 'custom_reports',
        op: 'insert',
        values: { account_id: account.accountId, name: 'Patients by recall status', config: { source: 'patients', metric: 'count', groupBy: 'recall_status', chartType: 'table', range: { from: '2026-01-01', to: '2026-01-31' } } },
      })
      createPage(account, 'Old reports', []).then((id) => {
        cy.login(account.email, account.password)
        cy.visit(`/reports/pages/${id}?edit=1`)
        cy.get('[data-cy="report-page-add"]').click()
        cy.get('[data-cy="report-add-tab-saved"]').click()
        cy.get('[data-cy="report-saved-row"]').should('contain', 'Patients by recall status').find('[data-cy="report-add-saved"]').click()
        // Paged: every patient, not the first 1,000.
        cy.task<number>('db:patientCount', { accountId: account.accountId }).then((expected) => {
          expect(expected).to.be.greaterThan(1000)
          tableOf('Patients by recall status').then((rows) => {
            const total = Object.values(rows).reduce((sum, v) => sum + Number(String(v).replace(/\./g, '')), 0)
            expect(total).to.eq(expected)
          })
        })
      })
    })
  })

  it('shows the same numbers as the standard reports it comes from', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:seedReportDataset', { accountId: account.accountId, clinicId: account.clinicId, ownerTeamMemberId: account.teamMemberId, nowIso: NOW.toISOString() }, { timeout: 120000 })
      createPage(account, 'Same numbers', [
        { title: 'Total charged', metric: 'total_charged' },
        { title: 'Income paid', metric: 'income_paid' },
        { title: 'Outstanding', metric: 'outstanding' },
        { title: 'By payment method', metric: 'income_paid', split: 'method', span: 6 },
        { title: 'By practitioner', metric: 'income_paid', split: 'practitioner', span: 6 },
        { title: 'First visits', metric: 'first_visits' },
        { title: 'Completed visits', metric: 'visits_completed' },
        { title: 'PVA', metric: 'pva' },
        { title: 'Conversion to 3rd visit', metric: 'conversion_third_visit' },
        { title: 'Retention post-revision', metric: 'retention_post_revision' },
        { title: 'Overall retention', metric: 'overall_retention' },
        { title: 'Visits by shift', metric: 'visits_booked', split: 'shift', span: 6 },
        { title: 'Show rate by shift', metric: 'show_rate', split: 'shift', span: 6 },
        { title: 'Bono debt', metric: 'bono_debt' },
        { title: 'Active memberships', metric: 'active_memberships' },
        { title: 'Membership income', metric: 'membership_income' },
      ]).then((id) => {
        cy.login(account.email, account.password)
        cy.clock(NOW.getTime(), ['Date'])
        cy.visit(`/reports/pages/${id}`, { onBeforeLoad: (win) => defaultLocale(win) })
        cy.get('[data-cy="report-block"][aria-busy]').should('not.exist')

        // What each standard report showed for this clinic on this day,
        // pinned in cypress/fixtures/report-figures-owner.json.
        cy.fixture('report-figures-owner.json').then((fixture: Record<string, { lines: string[]; charts: string[] }>) => {
          const after = (report: string, label: string, offset = 1) => {
            const lines = fixture[report]!.lines
            return norm(lines[lines.indexOf(label) + offset]!)
          }
          valueOf('Total charged').should('eq', after('income', 'Total charged'))
          valueOf('Income paid').should('eq', after('income', 'Total paid'))
          valueOf('Outstanding').should('eq', after('income', 'Outstanding'))

          // "Revenue (€): Bank transfer=756, Bizum=424, ..." -- the by-method chart.
          const byMethod = fixture.income!.charts.find((c) => c.includes('Bank transfer'))!
          const expectedMethods = Object.fromEntries(byMethod.split(': ')[1]!.split(', ').map((p) => p.split('=')))
          tableOf('By payment method').then((rows) => {
            expect(Object.keys(rows).sort()).to.deep.eq(Object.keys(expectedMethods).sort())
            for (const [label, euros] of Object.entries(expectedMethods)) expect(rows[label]).to.eq(`${euros},00 €`)
          })
          // "[Beatriz Ferrando | 204,00 € ; ...]" -- By practitioner.
          const byPractitioner = fixture.income!.lines.find((l) => l.startsWith('[Beatriz'))!
          const expectedPractitioners = Object.fromEntries(byPractitioner.slice(1, -1).split(' ; ').map((p) => p.split(' | ').map(norm)))
          tableOf('By practitioner').should('deep.equal', expectedPractitioners)

          // Statistics shows the figure above its label.
          valueOf('First visits').should('eq', after('statistics', 'First visits', -1))
          valueOf('Completed visits').should('eq', after('statistics', 'Total completed visits', -1))
          valueOf('PVA').should('eq', after('statistics', 'PVA (visits / new patient)', -1).replace('.', ','))
          valueOf('Conversion to 3rd visit').should('eq', after('statistics', 'Conversion to 3rd visit'))
          valueOf('Retention post-revision').should('eq', after('statistics', 'Retention post-revision'))
          valueOf('Overall retention').should('eq', after('statistics', 'Overall retention'))

          const shifts = ['Morning (before 12pm)', 'Afternoon (12–4pm)', 'Evening (4pm+)']
          tableOf('Visits by shift').then((rows) => {
            for (const s of shifts) expect(rows[s]).to.eq(after('appointment distribution', s))
          })
          tableOf('Show rate by shift').then((rows) => {
            for (const s of shifts) expect(`${rows[s]} show-up rate`).to.eq(after('appointment distribution', s, 2))
          })

          valueOf('Bono debt').should('eq', norm(fixture.debtors!.lines[1]!))
          valueOf('Active memberships').should('eq', after('memberships', 'Active memberships', -1))
          valueOf('Membership income').should('eq', after('memberships', 'Revenue this month (paid)', -1))
        })
      })
    })
  })

  it("shows someone who sees only their own figures their own, and nothing about the whole clinic", () => {
    cy.seedStaffAccount().then((account) => {
      const email = `own-${Date.now()}@example.test`
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email, password: PASSWORD, fullName: 'Ana Propia' }).then(() => {
        createPage(account, 'For everyone', [
          { title: 'Income paid', metric: 'income_paid' },
          { title: 'Bono debt', metric: 'bono_debt' },
        ])
        createPage(account, 'Just the owner', [{ title: 'Income paid', metric: 'income_paid' }], { visibility: 'private' })

        cy.login(email, PASSWORD)
        cy.visit('/reports')
        cy.get('[data-cy="report-page-card"]').should('have.length', 1).and('contain', 'For everyone')
        cy.get('[data-cy="report-page-card"]').click()
        cy.get('[data-cy="report-own-only"]').should('be.visible')
        blockNamed('Income paid').find('[data-cy="report-block-value"]').should('exist')
        blockNamed('Bono debt').find('[data-cy="report-block-unavailable"]').should('contain', 'whole clinic')
        cy.get('[data-cy="report-page-edit"]').should('not.exist')
      })

      // And the database, whatever the page shows: a private page is not
      // readable by anyone else, and a shared one cannot be changed by them.
      cy.task<{ rows: number }>('db:readAsStaff', { email, password: PASSWORD, table: 'report_pages', columns: 'name' }).its('rows').should('eq', 1)
      cy.task<{ changed: number }>('db:settingsWriteAsStaff', { email, password: PASSWORD, table: 'report_pages', op: 'update', values: { name: 'Taken over' }, match: { account_id: account.accountId } })
        .its('changed')
        .should('eq', 0)
      cy.task<{ changed: number }>('db:settingsWriteAsStaff', { email, password: PASSWORD, table: 'report_pages', op: 'delete', match: { account_id: account.accountId } })
        .its('changed')
        .should('eq', 0)
    })
  })

  it('downloads a report page, and a standard report, as a PDF', () => {
    cy.seedStaffAccount().then((account) => {
      createPage(account, 'Monthly PDF', [
        { title: 'Income paid', metric: 'income_paid' },
        { title: 'Completed visits', metric: 'visits_completed' },
        { title: 'Visits by shift', metric: 'visits_booked', split: 'shift', span: 6 },
        { title: 'Visits by day of week', metric: 'visits_booked', split: 'weekday', chart: 'bar', span: 6 },
      ]).then((id) => {
        cy.login(account.email, account.password)
        cy.visit(`/reports/pages/${id}`)
        cy.get('[data-cy="report-block"][aria-busy]').should('not.exist')
        cy.clickUntil('[data-cy="report-pdf"]', '[data-cy="report-pdf"][data-pdf-result]:not([data-pdf-result=""])')
        cy.get('[data-cy="report-pdf"]')
          .invoke('attr', 'data-pdf-result')
          .then((raw) => {
            const result = JSON.parse(raw!)
            expect(result.pages).to.be.at.least(1)
            expect(result.blocks.map((b: any) => b.kind)).to.deep.eq(['kpis', 'table', 'image'])
            expect(result.blocks[0].items).to.have.length(2)
            expect(result.blocks[1].title).to.eq('Visits by shift')
          })
        const month = new Date().toISOString().slice(0, 7)
        cy.readFile(`cypress/downloads/monthly-pdf-${month}.pdf`, 'binary', { timeout: 15000 }).should((s: string) => expect(s.slice(0, 5)).to.eq('%PDF-'))
      })

      // Something taken this month, or Income shows "no payments" instead of its charts.
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p) =>
        cy.task('db:createPayment', { accountId: account.accountId, patientId: p.id, amountCents: 4500, method: 'cash' }),
      )
      cy.visit('/reports/income')
      cy.contains('Total charged').should('be.visible')
      cy.get('[aria-busy]').should('not.exist')
      cy.clickUntil('[data-cy="report-pdf"]', '[data-cy="report-pdf"][data-pdf-result]:not([data-pdf-result=""])')
      cy.get('[data-cy="report-pdf"]')
        .invoke('attr', 'data-pdf-result')
        .then((raw) => {
          const result = JSON.parse(raw!)
          const kpis = result.blocks.find((b: any) => b.kind === 'kpis')
          expect(kpis.items.map((i: string) => i.split(':')[0])).to.include.members(['Total charged', 'Total paid', 'Outstanding'])
          expect(result.blocks.filter((b: any) => b.kind === 'image').map((b: any) => b.title)).to.include('Revenue by month')
        })
    })
  })

  it('sends the retired Custom Reports page to Reports', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/reports/custom')
      cy.location('pathname').should('eq', '/reports')
      cy.contains('a', 'Custom Reports').should('not.exist')
    })
  })
})
