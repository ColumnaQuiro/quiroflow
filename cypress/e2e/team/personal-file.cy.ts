// One person's file in Personal (pages/personal/[id].vue), owners only: the
// contract history (staff_contracts) that the overview and Turnos read, and
// the existing screens -- leave, clocking, pay -- narrowed to that person.
const madridDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
const daysFromToday = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return madridDate(d)
}
const WEEKDAYS_9_TO_5 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, [['09:00', '17:00']]]))

describe('Personal: a person’s file', () => {
  function clinicWithLucia() {
    return cy.seedStaffAccount().then((account) => {
      const email = `file-lucia-${Date.now()}@example.test`
      return cy
        .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email, password: 'valencia2026', fullName: 'Lucía Fisio', isPractitioner: true })
        .then((lucia) => cy.wrap({ account, lucia: { id: lucia.teamMemberId, email } }))
    })
  }

  it('keeps a contract history, flags one ending soon, and warns Turnos about hours over it', () => {
    clinicWithLucia().then(({ account, lucia }) => {
      const ends = daysFromToday(20)
      const tomorrow = daysFromToday(1)
      cy.task('db:setTeamMemberHours', { teamMemberId: lucia.id, hours: WEEKDAYS_9_TO_5 })
      cy.task('db:insertRows', { table: 'staff_contracts', rows: [{ account_id: account.accountId, team_member_id: lucia.id, employment_type: 'employee', modality: 'temporal', starts_on: daysFromToday(-90), ends_on: ends, weekly_hours: 20 }] })

      cy.login(account.email, account.password)
      cy.visit('/personal')
      cy.get('[data-cy=staff-people][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=staff-person][data-name="Lucía Fisio"]').within(() => {
        cy.get('[data-cy=staff-person-role]').should('contain', 'Employee')
        cy.get('[data-cy=staff-person-contract]').should('contain', 'Ends')
        cy.get('[data-cy=staff-person-link]').click()
      })

      cy.location('pathname').should('eq', `/personal/${lucia.id}`)
      cy.get('[data-cy=staff-file][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=staff-file-title]').should('have.text', 'Lucía Fisio')
      cy.get('[data-cy=staff-file-settings]').should('have.attr', 'href', `/settings/team/${lucia.id}`)
      cy.get('[data-cy=staff-file-tab-contract]').click()
      cy.get('[data-cy=file-contract][data-ready=true]', { timeout: 15000 })
      cy.get('[data-cy=contract-row]').should('have.length', 1).first().within(() => {
        cy.get('[data-cy=contract-status]').should('contain', 'Ends in 20 days')
        cy.get('[data-cy=contract-weekly]').should('contain', '20 h')
      })

      // Made permanent from tomorrow: a second row, the temporal one still in force today.
      cy.get('[data-cy=contract-new]').click()
      cy.get('[data-cy=contract-type-employee]').should('have.attr', 'aria-pressed', 'true')
      cy.get('[data-cy=contract-hours]').should('have.value', '20')
      cy.get('[data-cy=contract-modality]').select('indefinido')
      cy.get('[data-cy=contract-from]').clear().type(tomorrow)
      cy.get('[data-cy=contract-hours]').clear().type('30')
      cy.get('[data-cy=contract-title]').type('Fisioterapeuta')
      cy.get('[data-cy=contract-save]').click()
      cy.get('[data-cy=contract-form]').should('not.exist')
      cy.get('[data-cy=contract-row]').should('have.length', 2)
      cy.get('[data-cy=contract-row]').first().find('[data-cy=contract-status]').should('contain', 'Starts later')
      cy.get('[data-cy=contract-row][data-current=true]').find('[data-cy=contract-type]').should('contain', 'Fixed-term')

      cy.task<{ modality: string; starts_on: string; weekly_hours: number; created_by: string | null }[]>('db:selectRows', { table: 'staff_contracts', columns: 'modality, starts_on, weekly_hours, created_by', match: { team_member_id: lucia.id } }).then((rows) => {
        const made = rows.find((r) => r.modality === 'indefinido')!
        expect(made.starts_on).to.eq(tomorrow)
        expect(Number(made.weekly_hours)).to.eq(30)
        expect(made.created_by).to.eq(account.teamMemberId)
      })

      // Turnos: a 40-hour planned week against the 20 hours in force today.
      cy.visit('/jornada?tab=shifts')
      cy.get('[data-cy=shifts-row][data-name="Lucía Fisio"]', { timeout: 20000 }).find('[data-cy=shifts-over-contract]').should('contain', '20 h')
    })
  })

  it('narrows leave, clocking and pay to the person, and keeps the file of someone who left', () => {
    clinicWithLucia().then(({ account, lucia }) => {
      cy.login(account.email, account.password)
      cy.visit(`/personal/${lucia.id}?tab=leave`)
      cy.get('[data-cy=staff-leave][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=leave-year-total]').should('have.length', 1).and('have.attr', 'data-name', 'Lucía Fisio')
      cy.get('[data-cy=leave-add]').click()
      cy.get('[data-cy=leave-add-form]').should('be.visible')
      cy.get('[data-cy=leave-add-member]').should('not.exist')
      cy.get('[data-cy=leave-add-cancel]').click()

      cy.get('[data-cy=staff-file-tab-time]').click()
      cy.get('[data-cy=team-month-row]').should('have.length', 1).and('contain', 'Lucía Fisio')
      cy.get('[data-cy=team-month-detail]').should('contain', 'Lucía Fisio')

      cy.get('[data-cy=staff-file-tab-pay]').click()
      cy.get('[data-cy=file-pay][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=file-pay-empty]').should('exist')
      cy.get('[data-cy=file-pay-edit]').click()
      cy.get('[data-cy=pay-base]').type('1200')
      cy.get('[data-cy=pay-save]').click()
      cy.get('[data-cy=file-pay-total]', { timeout: 15000 }).should('contain', '1200')

      // Deactivated: off the list, under "No longer here", file still there.
      cy.task('db:updateRows', { table: 'team_members', match: { id: lucia.id }, values: { deleted_at: new Date().toISOString() } })
      cy.visit('/personal')
      cy.get('[data-cy=staff-people][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=staff-person][data-name="Lucía Fisio"]').should('not.exist')
      cy.get('[data-cy=staff-gone-link]').should('contain', 'Lucía Fisio').click()
      cy.get('[data-cy=staff-file-gone]', { timeout: 20000 }).should('exist')
    })
  })

  it('lets the person read their own contract and nobody else’s, and keeps the file to owners', () => {
    clinicWithLucia().then(({ account, lucia }) => {
      cy.task('db:insertRows', {
        table: 'staff_contracts',
        rows: [
          { account_id: account.accountId, team_member_id: lucia.id, employment_type: 'self_employed' },
          { account_id: account.accountId, team_member_id: account.teamMemberId, employment_type: 'partner' },
        ],
      })
      cy.task<{ rows: { team_member_id: string }[]; error: string | null }>('db:selectAsUser', { email: lucia.email, password: 'valencia2026', table: 'staff_contracts', select: 'team_member_id' }).then(({ rows, error }) => {
        expect(error).to.eq(null)
        expect(rows.map((r) => r.team_member_id)).to.deep.eq([lucia.id])
      })
      cy.login(lucia.email, 'valencia2026')
      cy.visit(`/personal/${lucia.id}`)
      cy.location('pathname', { timeout: 15000 }).should('not.eq', `/personal/${lucia.id}`)
    })
  })

  it('carries unused holidays into the year when the clinic allows it', () => {
    clinicWithLucia().then(({ account, lucia }) => {
      const lastYear = new Date().getFullYear() - 1
      // On the team since before last year, with ten working days taken then (two Monday-to-Friday weeks in March).
      cy.task('db:updateRows', { table: 'team_members', match: { id: lucia.id }, values: { created_at: `${lastYear - 1}-06-01T00:00:00Z` } })
      const firstMonday = (() => {
        const d = new Date(Date.UTC(lastYear, 2, 1, 12))
        while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1)
        return d
      })()
      const twoWeeksOn = new Date(firstMonday)
      twoWeeksOn.setUTCDate(twoWeeksOn.getUTCDate() + 11)
      cy.task('db:insertRows', { table: 'staff_absences', rows: [{ account_id: account.accountId, team_member_id: lucia.id, kind: 'vacation', starts_on: firstMonday.toISOString().slice(0, 10), ends_on: twoWeeksOn.toISOString().slice(0, 10), status: 'approved' }] })

      cy.login(account.email, account.password)
      cy.visit('/jornada?tab=shifts')
      cy.get('[data-cy=leave-allowance-row][data-name="Lucía Fisio"]', { timeout: 20000 }).find('[data-cy=leave-allowance-carried]').should('not.exist')
      cy.get('[data-cy=leave-carry-max]').clear().type('5').blur()
      cy.get('[data-cy=leave-allowance-row][data-name="Lucía Fisio"] [data-cy=leave-allowance-carried]', { timeout: 15000 }).should('have.text', '+5')
      cy.task<{ leave_carry_over_days: number }[]>('db:selectRows', { table: 'accounts', columns: 'leave_carry_over_days', match: { id: account.accountId } }).then(([a]) => {
        expect(Number(a!.leave_carry_over_days)).to.eq(5)
      })
      cy.visit('/personal')
      cy.get('[data-cy=staff-person][data-name="Lucía Fisio"] [data-cy=staff-person-leave]', { timeout: 20000 }).should('contain', '27')

      cy.login(lucia.email, 'valencia2026')
      cy.visit('/jornada?tab=mine')
      cy.get('[data-cy=my-leave-left]', { timeout: 20000 }).should('contain', '27')
    })
  })

  it('shows a Solo clinic what Personal is instead of the section', () => {
    clinicWithLucia().then(({ account, lucia }) => {
      cy.task('db:setSubscriptionPlan', { accountId: account.accountId, planId: 'starter' })
      cy.task('db:setSubscriptionStatus', { accountId: account.accountId, status: 'active' })
      cy.login(account.email, account.password)
      cy.visit('/personal')
      cy.get('[data-cy=staff-plan-gate]', { timeout: 20000 }).should('be.visible')
      cy.get('[data-cy=staff-people]').should('not.exist')
      cy.visit(`/personal/${lucia.id}`)
      cy.get('[data-cy=staff-plan-gate]', { timeout: 20000 }).should('be.visible')
      cy.visit('/reports/profitability')
      cy.get('[data-cy=staff-plan-gate]', { timeout: 20000 }).should('be.visible')
      cy.request({ url: '/api/staff/gestoria-pack?month=2026-10&format=json', failOnStatusCode: false }).its('status').should('eq', 402)
    })
  })
})
