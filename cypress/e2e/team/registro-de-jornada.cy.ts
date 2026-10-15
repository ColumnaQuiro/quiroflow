// Registro de jornada: a team member clocks in, takes a break and clocks out
// from My Day (the server stamps every time); asks for a correction from
// their month; an owner approves it on /jornada, which keeps the original
// beside it and puts it in the month's export; and an owner can exclude
// someone who does not have to clock.
const madridDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)

describe('Registro de jornada', () => {
  function clinicWithFisio() {
    return cy.seedStaffAccount().then((account) => {
      const email = `jornada-${Date.now()}@example.test`
      const password = 'valencia2026'
      return cy
        .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email, password, fullName: 'Lucía Fisio', isPractitioner: true })
        .then((fisio) => cy.wrap({ account, fisio: { id: fisio.teamMemberId, email, password } }))
    })
  }

  it('clocks a day from My Day, with the server stamping each time', () => {
    clinicWithFisio().then(({ fisio }) => {
      const before = Date.now()
      cy.login(fisio.email, fisio.password)
      cy.visit('/practitioner')
      cy.get('[data-cy=clock-card][data-state=off]', { timeout: 20000 })
      cy.get('[data-cy=clock-in]').click()
      cy.get('[data-cy=clock-card][data-state=working]')
      cy.get('[data-cy=clock-break]').click()
      cy.get('[data-cy=clock-card][data-state=on_break]')
      cy.get('[data-cy=clock-back]').click()
      cy.get('[data-cy=clock-card][data-state=working]')
      cy.get('[data-cy=clock-out]').click()
      cy.get('[data-cy=clock-card][data-state=off]')
      cy.get('[data-cy=clock-detail]').should('contain', 'In').and('contain', 'Break').and('contain', 'Out')

      cy.task<{ kind: string; at: string; source: string }[]>('db:selectRows', { table: 'time_entries', columns: 'kind, at, source', match: { team_member_id: fisio.id } }).then((rows) => {
        expect(rows.map((r) => r.kind).sort()).to.deep.eq(['break_end', 'break_start', 'in', 'out'])
        for (const r of rows) {
          expect(r.source).to.eq('clock')
          expect(Date.parse(r.at)).to.be.within(before - 60_000, Date.now() + 60_000)
        }
      })
      // The month links from the card.
      cy.get('[data-cy=clock-month]').click()
      cy.get('[data-cy=my-month-day]').should('have.length', 1)
    })
  })

  it('asks for a correction, which an owner approves without losing the original', () => {
    clinicWithFisio().then(({ account, fisio }) => {
      // Yesterday: clocked in, never clocked out.
      const yesterday = madridDate(new Date(Date.now() - 24 * 3600_000))
      cy.task('db:insertRows', { table: 'time_entries', rows: [{ account_id: account.accountId, team_member_id: fisio.id, work_date: yesterday, kind: 'in', at: `${yesterday}T07:00:00Z` }] })

      cy.login(fisio.email, fisio.password)
      cy.visit('/jornada')
      cy.get(`[data-cy=my-month-day][data-date=${yesterday}]`, { timeout: 20000 }).click()
      cy.get('[data-cy=correction-target]').should('have.value', 'add:out')
      cy.get('[data-cy=correction-time]').type('17:05')
      cy.get('[data-cy=correction-reason]').type('Olvidé fichar la salida')
      cy.get('[data-cy=correction-send]').click()
      cy.get('[data-cy=correction-sent]').should('be.visible')
      cy.get('[data-cy=my-correction][data-status=pending]').should('contain', 'Olvidé fichar la salida')

      cy.clearAllCookies()
      cy.login(account.email, account.password)
      cy.visit('/jornada')
      cy.get('[data-cy=pending-correction]', { timeout: 20000 }).should('contain', 'Lucía Fisio').and('contain', '17:05')
      cy.get('[data-cy=approve-correction]').click()
      cy.get('[data-cy=pending-correction]').should('not.exist')

      cy.task<{ kind: string; source: string; correction_id: string | null; superseded_by: string | null }[]>('db:selectRows', { table: 'time_entries', columns: 'kind, source, correction_id, superseded_by', match: { team_member_id: fisio.id } }).then((rows) => {
        expect(rows).to.have.length(2)
        expect(rows.find((r) => r.kind === 'in')!.source).to.eq('clock')
        const out = rows.find((r) => r.kind === 'out')!
        expect(out.source).to.eq('correction')
        expect(out.correction_id).to.be.a('string')
      })
      cy.task<{ status: string; decided_by: string }[]>('db:selectRows', { table: 'time_corrections', columns: 'status, decided_by', match: { team_member_id: fisio.id } }).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]!.status).to.eq('approved')
        expect(rows[0]!.decided_by).to.eq(account.teamMemberId)
      })

      cy.get('[data-cy=team-month-row][data-member="Lucía Fisio"]').click()
      cy.get(`[data-cy=team-month-day][data-date=${yesterday}]`).should('contain', '17:05')
      cy.get('[data-cy=team-month-note]').should('contain', 'Corrected').and('contain', 'Olvidé fichar la salida')

      // The month's export carries it.
      const month = yesterday.slice(0, 7)
      cy.request(`/api/time-records/export?month=${month}&format=csv`).then((res) => {
        expect(res.headers['content-type']).to.contain('text/csv')
        expect(res.body).to.contain('Lucía Fisio').and.contain('17:05').and.contain('Olvidé fichar la salida')
      })
      cy.request({ url: `/api/time-records/export?month=${month}&format=pdf`, encoding: 'binary' }).then((res) => {
        expect(res.headers['content-type']).to.contain('application/pdf')
        expect(res.body.slice(0, 5)).to.eq('%PDF-')
      })
    })
  })

  it('exports only their own month to anyone but an owner', () => {
    clinicWithFisio().then(({ account, fisio }) => {
      const today = madridDate(new Date())
      cy.task('db:insertRows', {
        table: 'time_entries',
        rows: [
          { account_id: account.accountId, team_member_id: account.teamMemberId, work_date: today, kind: 'in', at: new Date(Date.now() - 3600_000).toISOString() },
          { account_id: account.accountId, team_member_id: fisio.id, work_date: today, kind: 'in', at: new Date(Date.now() - 3600_000).toISOString() },
        ],
      })
      cy.login(fisio.email, fisio.password)
      cy.visit('/jornada')
      cy.get('[data-cy=my-month]', { timeout: 20000 })
      cy.request(`/api/time-records/export?month=${today.slice(0, 7)}&format=csv`).then((res) => {
        expect(res.body).to.contain('Lucía Fisio')
        expect(res.body).not.to.contain('Test Owner')
      })
      // No team view, no approving.
      cy.get('[data-cy=jornada-tab-team]').should('not.exist')
    })
  })

  it('lets an owner exclude someone who does not have to clock', () => {
    clinicWithFisio().then(({ account, fisio }) => {
      cy.login(account.email, account.password)
      cy.visit('/jornada')
      cy.get('[data-cy=team-month-row][data-member="Lucía Fisio"]', { timeout: 20000 }).click()
      cy.get('[data-cy=team-month-exempt]').check()
      cy.get('[data-cy=team-month-row][data-member="Lucía Fisio"]').should('contain', "Doesn't clock")
      cy.task('db:selectRows', { table: 'time_clock_exemptions', columns: 'team_member_id', match: { team_member_id: fisio.id } }).should('have.length', 1)

      cy.clearAllCookies()
      cy.login(fisio.email, fisio.password)
      cy.visit('/practitioner')
      cy.contains('h1', 'My Day', { timeout: 20000 })
      cy.wait(1500)
      cy.get('[data-cy=clock-card]').should('not.exist')
    })
  })
})
