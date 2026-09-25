import type { StaffAccount } from '../../support/commands'

// team_members used to be writable by any member of the account, straight
// through PostgREST: the only policy was FOR ALL is_account_member(account_id).
// A Front Desk login could give itself the Owner role, make itself an owner,
// or switch a colleague's practitioner status -- team_admin only hid the page.
//
// These drive the database with the app's own Supabase client, signed in as
// the person, because that is the path that was open. The UI never offered
// any of it, so UI assertions alone would never have caught it.

type TeamMemberRow = {
  full_name: string
  color: string
  is_owner: boolean
  role_id: string | null
  is_practitioner: boolean
  online_booking_enabled: boolean
}

function teamMember(teamMemberId: string) {
  return cy.task<TeamMemberRow>('db:teamMemberById', { teamMemberId })
}

function roleId(account: StaffAccount, name: string) {
  const role = account.roles.find((r) => r.name === name)
  if (!role) throw new Error(`no ${name} role on the seeded account`)
  return role.id
}

function signInAs(auth: { email: string; password: string }) {
  cy.login(auth.email, auth.password)
  cy.visit('/account')
  cy.get('[data-cy=account-page]').should('have.attr', 'data-ready', 'true')
}

/** Runs an update on team_members as the signed-in person. */
function updateTeamMember(id: string, patch: Record<string, unknown>) {
  return cy.get('#__nuxt').then(async ($root) => {
    const { client } = ($root[0] as any).__vue_app__.$nuxt.$supabase
    const { data, error } = await client.from('team_members').update(patch).eq('id', id).select('id')
    return { rows: (data ?? []).length, code: error?.code ?? null, message: error?.message ?? null }
  })
}

function staffOnRole(account: StaffAccount, roleName: string, label: string, isPractitioner = false) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
  const password = 'Test1234!'
  return cy
    .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      roleName,
      email,
      password,
      fullName: label,
      isPractitioner,
    })
    .then(({ teamMemberId }) => ({ email, password, teamMemberId }))
}

describe('team_members cannot be rewritten by any member', () => {
  it('refuses a Front Desk member their own role, ownership, and a colleague\'s practitioner status', () => {
    cy.seedStaffAccount().then((account) => {
      staffOnRole(account, 'Front Desk', 'Desk').then((desk) => {
        signInAs(desk)

        updateTeamMember(desk.teamMemberId, { role_id: roleId(account, 'Owner') }).its('code').should('eq', '42501')
        updateTeamMember(desk.teamMemberId, { is_owner: true }).its('code').should('eq', '42501')
        updateTeamMember(desk.teamMemberId, { is_practitioner: true }).its('code').should('eq', '42501')
        updateTeamMember(account.teamMemberId, { is_practitioner: false }).its('code').should('eq', '42501')
        updateTeamMember(account.teamMemberId, { full_name: 'Not the owner' }).its('code').should('eq', '42501')

        teamMember(desk.teamMemberId).then((row) => {
          expect(row.role_id, 'still Front Desk').to.eq(roleId(account, 'Front Desk'))
          expect(row.is_owner).to.eq(false)
          expect(row.is_practitioner).to.eq(false)
        })
        teamMember(account.teamMemberId).then((row) => {
          expect(row.is_practitioner, "the owner's practitioner status").to.eq(true)
          expect(row.full_name).to.eq('Test Owner')
        })

        // Assigning themselves to clinics is Team admin work too.
        cy.get('#__nuxt')
          .then(async ($root) => {
            const { client } = ($root[0] as any).__vue_app__.$nuxt.$supabase
            const { error } = await client.from('team_member_clinics').delete().eq('team_member_id', account.teamMemberId).select('team_member_id')
            const { data } = await client.from('team_member_clinics').select('team_member_id').eq('team_member_id', account.teamMemberId)
            return { error, remaining: (data ?? []).length }
          })
          .its('remaining')
          .should('eq', 1)
      })
    })
  })

  it('still lets the Front Desk member change their own name and colour on /account', () => {
    cy.seedStaffAccount().then((account) => {
      // The calendar colour is only offered to someone who sees patients, so
      // this one does -- which takes a second practitioner seat.
      cy.task('db:setExtraProfessionals', { accountId: account.accountId, extraProfessionals: 1 })
      staffOnRole(account, 'Front Desk', 'Desk', true).then((desk) => {
        signInAs(desk)
        cy.get('[data-cy=account-name]').clear().type('Lucia Ferrer')
        cy.get('[data-cy=account-palette] [data-color="#3b82f6"]').click()
        cy.get('[data-cy=account-save]').click()
        cy.get('[data-cy=account-unsaved]').should('not.exist')
        teamMember(desk.teamMemberId).then((row) => {
          expect(row.full_name).to.eq('Lucia Ferrer')
          expect(row.color).to.eq('#3b82f6')
        })
      })
    })
  })

  it('lets a team admin manage colleagues, but not ownership or their own role', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { team_admin: true, settings_access: true } })
      staffOnRole(account, 'Front Desk', 'Admin').then((admin) => {
        staffOnRole(account, 'Practitioner', 'Colleague').then((colleague) => {
          signInAs(admin)

          updateTeamMember(colleague.teamMemberId, { online_booking_enabled: false, full_name: 'Renamed' }).its('rows').should('eq', 1)
          updateTeamMember(colleague.teamMemberId, { role_id: roleId(account, 'Front Desk') }).its('rows').should('eq', 1)
          teamMember(colleague.teamMemberId).then((row) => {
            expect(row.online_booking_enabled).to.eq(false)
            expect(row.full_name).to.eq('Renamed')
            expect(row.role_id).to.eq(roleId(account, 'Front Desk'))
          })

          updateTeamMember(colleague.teamMemberId, { is_owner: true }).its('code').should('eq', '42501')
          updateTeamMember(admin.teamMemberId, { role_id: roleId(account, 'Owner') }).its('code').should('eq', '42501')
          teamMember(colleague.teamMemberId).its('is_owner').should('eq', false)
        })
      })
    })
  })

  it('lets an owner change roles and ownership, but never leave the account without one', () => {
    cy.seedStaffAccount().then((account) => {
      staffOnRole(account, 'Front Desk', 'Desk').then((desk) => {
        signInAs(account)

        // The only owner cannot step down.
        updateTeamMember(account.teamMemberId, { is_owner: false }).its('code').should('eq', '42501')

        updateTeamMember(desk.teamMemberId, { role_id: roleId(account, 'Practitioner') }).its('rows').should('eq', 1)
        updateTeamMember(desk.teamMemberId, { is_owner: true }).its('rows').should('eq', 1)
        teamMember(desk.teamMemberId).then((row) => {
          expect(row.role_id).to.eq(roleId(account, 'Practitioner'))
          expect(row.is_owner).to.eq(true)
        })

        // With a second owner in place, stepping down is allowed.
        updateTeamMember(account.teamMemberId, { is_owner: false }).its('rows').should('eq', 1)
        teamMember(account.teamMemberId).its('is_owner').should('eq', false)
      })
    })
  })
})
