// Settings > Team > one person: Save writes the columns that were edited and
// nothing else.
//
// It used to send the whole form. Renaming a Front Desk member therefore also
// wrote online_booking_enabled = false (the save forced it off for anyone not
// seeing patients) and replaced their null business_hours with seven empty
// days (the form normalised null on load). Neither was on screen, and the
// activity log recorded both as the owner's edit.
describe('Settings > Team > member: Save writes only what changed', () => {
  function openMember(teamMemberId: string, name: string) {
    cy.visit(`/settings/team/${teamMemberId}`)
    cy.get('[data-cy=member-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')
    cy.get('[data-cy=member-title]').should('have.text', name)
  }

  function seedFrontDesk() {
    return cy.seedStaffAccount().then((account) =>
      cy
        .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          roleName: 'Front Desk',
          email: `desk-${Date.now()}@example.test`,
          password: 'Test1234!',
          fullName: 'Rita Recepción',
        })
        .then((desk) =>
          cy
            .task('db:setTeamMemberBookingFlags', { id: desk.teamMemberId, isPractitioner: false, onlineBookingEnabled: true })
            .then(() => cy.task('db:setTeamMemberHours', { teamMemberId: desk.teamMemberId, hours: null }))
            .then(() => cy.task('db:teamMemberDetail', { teamMemberId: desk.teamMemberId }))
            .then((before: any) => ({ account, deskId: desk.teamMemberId, before })),
        ),
    )
  }

  it('renaming a Front Desk member changes their name and nothing else', () => {
    seedFrontDesk().then(({ account, deskId, before }) => {
      expect(before.online_booking_enabled).to.eq(true)
      expect(before.business_hours).to.eq(null)

      cy.login(account.email, account.password)
      openMember(deskId, 'Rita Recepción')
      cy.get('[data-cy=member-name]').clear().type('Rita Renombrada')
      cy.get('[data-cy=member-save]').click()
      cy.get('[data-cy=member-save-bar]').should('not.exist')

      cy.task('db:teamMemberDetail', { teamMemberId: deskId }).then((after: any) => {
        expect(after.full_name).to.eq('Rita Renombrada')
        expect(after.online_booking_enabled).to.eq(true)
        expect(after.business_hours).to.eq(null)
        expect({ ...after, full_name: before.full_name }).to.deep.eq(before)
      })
      // The activity log is where this showed up: one update, one column.
      cy.task<any[]>('db:auditLogFor', { entityId: deskId }).then((rows) => {
        // Only staff edits: the seeding above writes as the server.
        const updates = rows.filter((r) => r.entity_type === 'team_member' && r.action === 'updated' && r.actor === 'staff')
        expect(updates).to.have.length(1)
        expect(Object.keys(updates[0].changes ?? {})).to.deep.eq(['full_name'])
      })
    })
  })

  it('opening and closing their own hours is not a change', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: null })
      cy.login(account.email, account.password)
      openMember(account.teamMemberId, 'Test Owner')

      cy.get('[data-cy=member-hours-set]').click()
      cy.get('[data-cy=hours-not-set]').should('be.visible')
      cy.get('[data-cy=member-save-bar]').should('not.exist')
      cy.get('[data-cy=member-hours-clear]').click()
      cy.get('[data-cy=member-hours-none]').should('be.visible')
      cy.get('[data-cy=member-save-bar]').should('not.exist')

      // A real change elsewhere still leaves the hours alone.
      cy.get('[data-cy=member-name]').clear().type('Olga Owner')
      cy.get('[data-cy=member-save]').click()
      cy.get('[data-cy=member-save-bar]').should('not.exist')
      cy.task('db:teamMemberDetail', { teamMemberId: account.teamMemberId }).then((m: any) => {
        expect(m.full_name).to.eq('Olga Owner')
        expect(m.business_hours).to.eq(null)
      })
    })
  })

  it('taking someone off "sees patients" still takes them off online booking', () => {
    seedFrontDesk().then(({ account, deskId }) => {
      cy.task('db:setTeamMemberBookingFlags', { id: deskId, isPractitioner: true, onlineBookingEnabled: true })
      cy.login(account.email, account.password)
      openMember(deskId, 'Rita Recepción')

      cy.get('[data-cy=member-online]').should('have.attr', 'aria-checked', 'true')
      cy.get('[data-cy=member-practitioner]').click()
      cy.get('[data-cy=member-save]').click()
      cy.get('[data-cy=member-save-bar]').should('not.exist')

      cy.task('db:teamMemberDetail', { teamMemberId: deskId }).then((m: any) => {
        expect(m.is_practitioner).to.eq(false)
        expect(m.online_booking_enabled).to.eq(false)
        expect(m.business_hours).to.eq(null)
        expect(m.full_name).to.eq('Rita Recepción')
      })
    })
  })
})
