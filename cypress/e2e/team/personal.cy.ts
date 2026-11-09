// Personal (pages/personal.vue), owners only: the team's people with where
// each is today and the holidays they have left, and the whole year's leave
// in one view -- a request decided from its cell, leave recorded by picking
// days on someone's row, and a marker on the days two practitioners are away.
const madridDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
/** The Monday after next and the Wednesday after it (YYYY-MM-DD). */
function weekAhead() {
  const d = new Date()
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7) + 7)
  const mon = madridDate(d)
  const wed = new Date(d)
  wed.setDate(wed.getDate() + 2)
  return { mon, wed: madridDate(wed) }
}

describe('Personal', () => {
  function clinicWithTwo() {
    return cy.seedStaffAccount().then((account) => {
      const stamp = Date.now()
      const make = (fullName: string, tag: string) =>
        cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email: `personal-${tag}-${stamp}@example.test`, password: 'valencia2026', fullName, isPractitioner: true })
      return make('Lucía Fisio', 'lucia').then((lucia) =>
        make('Marco Quiro', 'marco').then((marco) => cy.wrap({ account, lucia: { id: lucia.teamMemberId, email: `personal-lucia-${stamp}@example.test` }, marco: { id: marco.teamMemberId } })),
      )
    })
  }
  /** The year view shows the current year; move to the one `day` is in. */
  function showYearOf(day: string) {
    cy.get('[data-cy=leave-year]').invoke('text').then((shown) => {
      if (shown.trim() !== day.slice(0, 4)) cy.get('[data-cy=leave-year-next]').click()
    })
    cy.get('[data-cy=leave-year]').should('have.text', day.slice(0, 4))
  }

  it('shows the team, and an owner decides a request from its cell in the year view', () => {
    clinicWithTwo().then(({ account, lucia }) => {
      const { mon, wed } = weekAhead()
      cy.task('db:insertRows', { table: 'staff_absences', rows: [{ account_id: account.accountId, team_member_id: lucia.id, kind: 'vacation', starts_on: mon, ends_on: wed, status: 'pending' }] })

      cy.login(account.email, account.password)
      cy.visit('/personal')
      cy.get('[data-cy=staff-people][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=staff-person][data-name="Lucía Fisio"]').within(() => {
        cy.get('[data-cy=staff-person-leave]').should('contain', '22').and('contain', '3')
        cy.get('[data-cy=staff-person-link]').should('have.attr', 'href', `/settings/team/${lucia.id}`)
      })
      cy.get('[data-cy=staff-waiting-leave]').should('contain', '1').click()

      cy.get('[data-cy=staff-leave][data-ready=true]', { timeout: 20000 })
      showYearOf(mon)
      cy.get(`[data-cy=leave-cell][data-name="Lucía Fisio"][data-day="${mon}"]`).should('have.attr', 'data-status', 'pending').click()
      cy.get('[data-cy=leave-detail]').should('contain', 'Lucía Fisio')
      cy.get('[data-cy=leave-detail-approve]').click()
      cy.get(`[data-cy=leave-cell][data-name="Lucía Fisio"][data-day="${mon}"]`, { timeout: 15000 }).should('have.attr', 'data-status', 'approved')

      cy.task<{ status: string; block_ids: string[] }[]>('db:selectRows', { table: 'staff_absences', columns: 'status, block_ids', match: { team_member_id: lucia.id } }).then(([absence]) => {
        expect(absence!.status).to.eq('approved')
        expect(absence!.block_ids).to.have.length(1)
      })
      // Approved days are no longer pending, and come out of what is left.
      cy.get('[data-cy=leave-year-total][data-name="Lucía Fisio"]').within(() => {
        cy.get('[data-cy=leave-year-pending]').should('have.text', '0')
        cy.get('[data-cy=leave-year-left]').should('have.text', '19')
      })
    })
  })

  it('records leave picked on a row, and marks the days two practitioners are away', () => {
    clinicWithTwo().then(({ account, lucia, marco }) => {
      const { mon } = weekAhead()
      cy.task('db:insertRows', { table: 'staff_absences', rows: [{ account_id: account.accountId, team_member_id: lucia.id, kind: 'vacation', starts_on: mon, ends_on: mon, status: 'approved' }] })

      cy.login(account.email, account.password)
      cy.visit('/personal?tab=leave')
      cy.get('[data-cy=staff-leave][data-ready=true]', { timeout: 20000 })
      showYearOf(mon)
      cy.get(`[data-cy=leave-overlap-${mon}]`).should('not.exist')

      // One day picked on Marco's row opens the form with him and that day.
      cy.get(`[data-cy=leave-free][data-name="Marco Quiro"][data-day="${mon}"]`).trigger('pointerdown', { button: 0, pointerId: 1 })
      cy.window().trigger('pointerup', { pointerId: 1 })
      cy.get('[data-cy=leave-add-form]').should('be.visible')
      cy.get('[data-cy=leave-add-member]').should('have.value', marco.id)
      cy.get('[data-cy=leave-add-from]').should('have.value', mon)
      cy.get('[data-cy=leave-add-to]').should('have.value', mon)
      cy.get('[data-cy=leave-add-kind-training]').click()
      cy.get('[data-cy=leave-add-save]').click()
      cy.get('[data-cy=leave-add-form]').should('not.exist')

      cy.task<{ kind: string; status: string; starts_on: string; ends_on: string }[]>('db:selectRows', { table: 'staff_absences', columns: 'kind, status, starts_on, ends_on', match: { team_member_id: marco.id } }).then(([absence]) => {
        expect(absence).to.deep.include({ kind: 'training', status: 'approved', starts_on: mon, ends_on: mon })
      })
      cy.get(`[data-cy=leave-cell][data-name="Marco Quiro"][data-day="${mon}"]`).should('have.attr', 'data-kind', 'training')

      // Both practitioners away that day.
      cy.get(`[data-cy=leave-overlap-${mon}]`).click()
      cy.get('[data-cy=leave-detail-who]').should('have.length', 2).and('contain', 'Lucía Fisio').and('contain', 'Marco Quiro')
      cy.get('[data-cy=leave-detail-who]').first().should('contain', 'no visits booked')
    })
  })

  it('is for owners only', () => {
    clinicWithTwo().then(({ lucia }) => {
      cy.login(lucia.email, 'valencia2026')
      cy.visit('/jornada')
      cy.get('[data-cy=jornada-page]', { timeout: 20000 })
      cy.get('a[href="/personal"]').should('not.exist')
      cy.visit('/personal')
      cy.location('pathname', { timeout: 15000 }).should('not.eq', '/personal')
    })
  })
})
