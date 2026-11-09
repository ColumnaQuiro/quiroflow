// Personal, phases 3-5: each person's papers (staff_documents, the private
// team-member-files bucket) seen by the owner and, except a parte de baja, by
// the person in Mi jornada; the month's pack for the gestoría; and
// Rentabilidad por profesional with the coste empresa typed in.
const lastMonth = () => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
/** The first Monday-to-Friday day of `month` (a holiday there counts as one working day). */
function firstWeekday(month: string) {
  for (let d = 1; d <= 7; d++) {
    const day = `${month}-0${d}`
    const wd = new Date(`${day}T12:00:00Z`).getUTCDay()
    if (wd !== 0 && wd !== 6) return day
  }
  return `${month}-01`
}
const pdf = (name: string) => ({ contents: Cypress.Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'), fileName: name, mimeType: 'application/pdf' })

describe('Personal: documents, the gestoría pack and profitability', () => {
  function clinicWithLucia() {
    return cy.seedStaffAccount().then((account) => {
      const email = `docs-lucia-${Date.now()}@example.test`
      return cy
        .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email, password: 'valencia2026', fullName: 'Lucía Fisio', isPractitioner: true })
        .then((lucia) => cy.wrap({ account, lucia: { id: lucia.teamMemberId, email } }))
    })
  }

  it('uploads payslips in bulk and a sick note, which the person sees only the first of', () => {
    clinicWithLucia().then(({ account, lucia }) => {
      cy.login(account.email, account.password)
      cy.visit('/personal')
      cy.get('[data-cy=staff-people][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=staff-bulk-payslips]').click()
      cy.get('[data-cy=bulk-payslips-month]').should('have.value', lastMonth())
      cy.get('[data-cy=bulk-payslips-files]').selectFile([pdf('nomina_lucia_fisio.pdf'), pdf('scan_0001.pdf')])
      cy.get('[data-cy=bulk-payslips-row]').should('have.length', 2)
      cy.get('[data-cy=bulk-payslips-member]').eq(0).should('have.value', lucia.id)
      cy.get('[data-cy=bulk-payslips-member]').eq(1).should('have.value', null)
      cy.get('[data-cy=bulk-payslips-save]').should('be.disabled')
      cy.get('[data-cy=bulk-payslips-member]').eq(1).select(account.teamMemberId)
      cy.get('[data-cy=bulk-payslips-save]').click()
      cy.get('[data-cy=bulk-payslips]', { timeout: 20000 }).should('not.exist')

      cy.visit(`/personal/${lucia.id}?tab=documents`)
      cy.get('[data-cy=file-documents][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=documents-row]').should('have.length', 1).first().find('[data-cy=documents-seen]').should('contain', 'Not opened')
      cy.get('[data-cy=documents-add]').click()
      cy.get('[data-cy=documents-category-sick_note]').click()
      cy.get('[data-cy=documents-sick-note-hint]').should('be.visible')
      cy.get('[data-cy=documents-file]').selectFile(pdf('parte.pdf'))
      cy.get('[data-cy=documents-save]').click()
      cy.get('[data-cy=documents-row]', { timeout: 20000 }).should('have.length', 2)
      cy.get('[data-cy=documents-row][data-category=sick_note]').find('[data-cy=documents-seen]').should('contain', 'Owners only')

      // RLS: the payslip, not the parte de baja, and not the owner's own.
      cy.task<{ rows: { category: string }[] }>('db:selectAsUser', { email: lucia.email, password: 'valencia2026', table: 'staff_documents', select: 'category' }).then(({ rows }) => {
        expect(rows.map((r) => r.category)).to.deep.eq(['payslip'])
      })

      // Lucía opens it from Mi jornada: the owner then sees it as seen.
      cy.login(lucia.email, 'valencia2026')
      cy.visit('/jornada?tab=mine')
      cy.get('[data-cy=my-documents][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=my-documents-open]').should('have.length', 1).and('have.attr', 'data-category', 'payslip')
      cy.get('[data-cy=my-documents-new]').should('exist')
      const tab = { location: { href: '' }, close: () => {} }
      cy.window().then((win) => cy.stub(win, 'open').returns(tab))
      cy.get('[data-cy=my-documents-open]').click()
      cy.wrap(tab).its('location.href').should('contain', '/storage/v1/object/sign/team-member-files/')
      cy.get('[data-cy=my-documents-new]').should('not.exist')
      cy.task<{ first_viewed_at: string | null }[]>('db:selectRows', { table: 'staff_documents', columns: 'first_viewed_at', match: { team_member_id: lucia.id, category: 'payslip' } }).then(([d]) => {
        expect(d!.first_viewed_at).to.be.a('string')
      })
    })
  })

  it('shows the gestoría the month: hours, holidays and pay, apart for an autónomo', () => {
    clinicWithLucia().then(({ account, lucia }) => {
      const m = lastMonth()
      cy.task('db:insertRows', { table: 'staff_contracts', rows: [{ account_id: account.accountId, team_member_id: lucia.id, employment_type: 'employee', modality: 'indefinido', starts_on: '2025-01-01', weekly_hours: 30 }, { account_id: account.accountId, team_member_id: account.teamMemberId, employment_type: 'partner' }] })
      cy.task('db:insertRows', { table: 'staff_absences', rows: [{ account_id: account.accountId, team_member_id: lucia.id, kind: 'vacation', starts_on: firstWeekday(m), ends_on: firstWeekday(m), status: 'approved' }] })
      cy.task('db:insertRows', { table: 'pay_plans', rows: [{ account_id: account.accountId, team_member_id: lucia.id, base_cents: 150000, payments_pct: 0, visit_cents: 0, tier_mode: 'reached', tiers: [], new_patient_cents: 1000, sales_pct: 0 }] })

      cy.login(account.email, account.password)
      cy.visit('/personal?tab=gestoria')
      cy.get('[data-cy=gestoria-pack][data-ready=true]', { timeout: 30000 })
      cy.get('[data-cy=gestoria-pack-employees] [data-cy=gestoria-pack-row][data-name="Lucía Fisio"]').within(() => {
        cy.get('[data-cy=gestoria-pack-holidays]').should('contain', '1')
        cy.get('[data-cy=gestoria-pack-absences]').should('contain', 'Vacaciones')
        // A fixed salary is the gestoría's own: only the variable part shows.
        cy.get('[data-cy=gestoria-pack-pay]').should('contain', '0,00')
      })
      cy.get('[data-cy=gestoria-pack-others] [data-cy=gestoria-pack-row]').should('have.length', 1)
      cy.get('[data-cy=gestoria-pack-csv]').invoke('attr', 'href').then((href) => {
        cy.request(String(href)).then((res) => {
          expect(res.headers['content-type']).to.contain('text/csv')
          expect(res.body).to.contain('Lucía Fisio').and.contain('Persona;Tipo')
        })
      })
      cy.get('[data-cy=gestoria-pack-pdf]').invoke('attr', 'href').then((href) => {
        cy.request({ url: String(href), encoding: 'binary' }).its('headers.content-type').should('contain', 'application/pdf')
      })
    })
  })

  it('puts each practitioner’s income beside the cost typed in, estimated until then', () => {
    clinicWithLucia().then(({ account, lucia }) => {
      cy.task('db:insertRows', { table: 'pay_plans', rows: [{ account_id: account.accountId, team_member_id: lucia.id, base_cents: 150000, payments_pct: 0, visit_cents: 0, tier_mode: 'reached', tiers: [], new_patient_cents: 0, sales_pct: 0 }] })
      cy.login(account.email, account.password)
      cy.visit('/reports/profitability')
      cy.get('[data-cy=profitability][data-ready=true]', { timeout: 30000 })
      cy.get('[data-cy=profitability-row][data-name="Lucía Fisio"]').within(() => {
        cy.get('[data-cy=profitability-cost]').should('contain', '1500,00')
        cy.get('[data-cy=profitability-estimated]').should('exist')
        cy.get('[data-cy=profitability-cost-edit]').click()
        cy.get('[data-cy=profitability-cost-input]').type('2150,40')
        cy.get('[data-cy=profitability-cost-save]').click()
      })
      cy.get('[data-cy=profitability-row][data-name="Lucía Fisio"] [data-cy=profitability-estimated]', { timeout: 15000 }).should('not.exist')
      cy.get('[data-cy=profitability-row][data-name="Lucía Fisio"] [data-cy=profitability-cost]').should('contain', '2150,40')
      cy.task<{ cost_cents: number }[]>('db:selectRows', { table: 'staff_monthly_costs', columns: 'cost_cents', match: { team_member_id: lucia.id } }).then(([c]) => {
        expect(Number(c!.cost_cents)).to.eq(215040)
      })

      // Not for a practitioner.
      cy.login(lucia.email, 'valencia2026')
      cy.visit('/reports/profitability')
      cy.location('pathname', { timeout: 15000 }).should('not.eq', '/reports/profitability')
    })
  })
})
