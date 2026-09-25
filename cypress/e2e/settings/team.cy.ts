// Settings > Team: the list of everyone who signs in, one page per person,
// invites that say outright who will see patients, and the imported
// PracticeHub names that used to live on Settings > Practitioners.
describe('Settings > Team', () => {
  function openTeam() {
    cy.visit('/settings/team')
    cy.get('[data-cy=team-page]').should('have.attr', 'data-ready', 'true')
  }
  function openMember(name: string) {
    openTeam()
    cy.contains('[data-cy=team-member-row]', name).click()
    cy.get('[data-cy=member-page]').should('have.attr', 'data-ready', 'true')
    cy.get('[data-cy=member-title]').should('have.text', name)
  }
  function confirm() {
    cy.get('[data-cy=confirm-dialog-confirm]').click()
  }

  it('lists the team and edits one person on their own page, with one save', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      openTeam()
      cy.contains('[data-cy=team-member-row]', 'Test Owner').within(() => {
        cy.contains('You').should('exist')
        cy.get('[data-cy=team-row-owner]').should('exist')
        cy.get('[data-cy=team-row-practitioner]').should('exist')
      })

      openMember('Test Owner')
      // Your own role is not yours to change.
      cy.get('[data-cy=member-role]').should('be.disabled')

      cy.get('[data-cy=member-name]').clear().type('Olga Owner')
      cy.get('[data-cy=member-color]').eq(3).click()
      // No hours of their own: the week stays hidden rather than reading
      // "Closed" seven times.
      cy.get('[data-cy=member-hours-none]').should('contain', 'No hours of their own')
      cy.get('[data-cy=hours-not-set]').should('not.exist')
      cy.get('[data-cy=member-save-bar]').should('be.visible')

      // Leaving with changes asks first.
      cy.get('[data-cy=member-back]').click()
      cy.get('[data-cy=confirm-dialog]').should('contain', 'Leave without saving?')
      cy.get('[data-cy=confirm-dialog-cancel]').click()
      cy.location('pathname').should('match', /^\/settings\/team\/[0-9a-f-]+$/)

      cy.get('[data-cy=member-save]').click()
      cy.get('[data-cy=member-save-bar]').should('not.exist')

      cy.task('db:teamMemberDetail', { teamMemberId: account.teamMemberId }).then((m: any) => {
        expect(m.full_name).to.eq('Olga Owner')
        expect(m.color).to.eq('#14b8a6')
      })
      cy.reload()
      cy.get('[data-cy=member-title]').should('have.text', 'Olga Owner')
    })
  })

  it('turns someone into a practitioner, bookable online, at one clinic, with their own hours', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Sede Norte' }).then((north) => {
        cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          roleName: 'Front Desk',
          email: `desk-${Date.now()}@example.test`,
          password: 'Test1234!',
          fullName: 'Rita Recepción',
        }).then((desk) => {
          cy.login(account.email, account.password)
          openMember('Rita Recepción')

          // Not a practitioner: nothing about seeing patients is shown.
          cy.get('[data-cy=member-online]').should('not.exist')
          cy.get('[data-cy=member-practitioner]').click()
          // Bookable online is on by default once they see patients.
          cy.get('[data-cy=member-online]').should('have.attr', 'aria-checked', 'true')
          cy.contains('[data-cy=member-clinic]', 'Sede Norte').click()
          // Their own hours: Monday morning only.
          cy.get('[data-cy=member-hours-set]').click()
          cy.get('[data-cy=hours-not-set]').should('be.visible')
          cy.get('[data-cy=hours-day-toggle]').first().click()
          cy.get('[data-cy=member-save]').click()
          cy.get('[data-cy=member-save-bar]').should('not.exist')

          cy.task('db:teamMemberDetail', { teamMemberId: desk.teamMemberId }).then((m: any) => {
            expect(m.is_practitioner).to.eq(true)
            expect(m.online_booking_enabled).to.eq(true)
            expect(m.clinicIds).to.have.members([account.clinicId, north.id])
            expect(m.business_hours.mon).to.deep.eq([['09:00', '14:00']])
            expect(m.business_hours.tue).to.deep.eq([])
          })

          // Untick every clinic: a practitioner needs at least one.
          cy.contains('[data-cy=member-clinic]', 'Sede Norte').click()
          cy.get('[data-cy=member-clinic]').first().click()
          cy.contains('Pick at least one clinic.').should('be.visible')
          cy.get('[data-cy=member-discard]').click()
          cy.get('[data-cy=member-save-bar]').should('not.exist')

          openTeam()
          cy.contains('[data-cy=team-member-row]', 'Rita Recepción').should('contain', 'Online booking').and('contain', '2 clinics').and('contain', 'Own hours')
        })
      })
    })
  })

  it('invites someone who will not see patients, only to the clinic chosen, and they join that way', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Sede Norte' }).then((north) => {
        const email = `admin-${Date.now()}@example.test`
        cy.login(account.email, account.password)
        cy.intercept('POST', '/api/invites/send', { statusCode: 200, body: { sent: true } }).as('sendInvite')
        openTeam()

        cy.get('[data-cy=team-invite]').click()
        cy.get('[data-cy=invite-email]').type(email).should('have.value', email)
        cy.get('[data-cy=invite-name]').type('Ana Admin')
        cy.get('[data-cy=invite-role]').select('Front Desk')
        cy.get('[data-cy=invite-practitioner]').uncheck()
        cy.get('[data-cy=invite-dialog]').contains('label', 'Sede Norte').click()
        confirm()
        cy.wait('@sendInvite')
        cy.get('[data-cy=invite-sent]').should('contain', email)
        cy.get('[data-cy=invite-link]').invoke('val').should('match', /\/join\?token=/)
        confirm()

        cy.contains('[data-cy=team-invite-row]', email).should('contain', 'will not see patients')

        cy.task<any>('db:latestInvite', { accountId: account.accountId }).then((invite) => {
          expect(invite.is_practitioner).to.eq(false)
          expect(invite.role).to.eq('front_desk')
          expect(invite.clinic_ids).to.deep.eq([account.clinicId])
          cy.task('db:createLoneUser', { email, password: 'Test1234!' })
          cy.task<any>('db:acceptInviteAs', { email, password: 'Test1234!', token: invite.token }).then((member) => {
            expect(member.is_practitioner).to.eq(false)
            expect(member.clinicIds).to.deep.eq([account.clinicId])
            expect(member.clinicIds).not.to.include(north.id)
          })
        })
      })
    })
  })

  it('makes a link-only invite, lists it as pending, and revokes it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      openTeam()
      cy.get('[data-cy=team-invite]').click()
      // Neither an email nor a name: nothing to create yet.
      cy.get('[data-cy=confirm-dialog-confirm]').should('be.disabled')
      cy.get('[data-cy=invite-email]').type('not-an-email')
      cy.get('[data-cy=confirm-dialog-confirm]').should('be.disabled')
      cy.get('[data-cy=invite-email]').clear()
      cy.get('[data-cy=invite-name]').type('Pablo Sinemail')
      confirm()
      cy.get('[data-cy=invite-result]').should('contain', 'Share this link')
      confirm()

      cy.contains('[data-cy=team-invite-row]', 'Pablo Sinemail').within(() => {
        cy.contains('will see patients').should('exist')
        cy.get('[data-cy=team-invite-resend]').should('not.exist')
        cy.get('[data-cy=team-invite-revoke]').click()
      })
      cy.get('[data-cy=confirm-dialog]').should('contain', 'Revoke the invite for Pablo Sinemail?')
      confirm()
      cy.get('[data-cy=team-invites]').should('not.exist')
    })
  })

  it('links imported PracticeHub names to someone on the team (formerly Settings > Practitioners)', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Imp', lastName: 'Orted' }).then((patient) => {
        cy.task('db:createImportedAppointments', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerName: 'Dr. Legacy', count: 3 })
        cy.login(account.email, account.password)

        // The old page lands on this section.
        cy.visit('/settings/practitioners')
        cy.location('pathname').should('eq', '/settings/team')
        cy.location('hash').should('eq', '#importados')

        cy.get('[data-cy=team-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=team-imported-row][data-name="Dr. Legacy"]').within(() => {
          cy.contains('3 appointments').should('exist')
          cy.get('[data-cy=team-imported-link]').should('be.disabled')
          cy.get('[data-cy=team-imported-target]').select('Test Owner')
          cy.get('[data-cy=team-imported-link]').click()
        })
        cy.get('[data-cy=confirm-dialog]').should('contain', 'Link 3 appointments to Test Owner?')
        confirm()
        cy.contains('3 appointments linked.').should('be.visible')
        cy.get('[data-cy=team-imported]').should('not.exist')
        cy.task<(string | null)[]>('db:importedAppointmentsLinks', { accountId: account.accountId, practitionerName: 'Dr. Legacy' }).then((ids) => {
          expect(ids).to.have.length(3)
          expect(ids.every((id) => id === account.teamMemberId)).to.eq(true)
        })
      })
    })
  })

  it('invites an imported name as a practitioner, carrying the name to link', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Imp', lastName: 'Orted' }).then((patient) => {
        cy.task('db:createImportedAppointments', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerName: 'Dra. Pasado', count: 2 })
        cy.login(account.email, account.password)
        openTeam()
        cy.get('[data-cy=team-imported-row][data-name="Dra. Pasado"] [data-cy=team-imported-invite]').click()
        cy.get('[data-cy=invite-name]').should('have.value', 'Dra. Pasado')
        cy.get('[data-cy=invite-practitioner]').should('be.checked')
        confirm()
        confirm()
        cy.contains('[data-cy=team-invite-row]', 'Dra. Pasado').should('contain', 'gets the imported appointments of "Dra. Pasado"')
        cy.task<any>('db:latestInvite', { accountId: account.accountId }).its('link_practitioner_name').should('eq', 'Dra. Pasado')
      })
    })
  })

  it('deactivates someone who left, passing their future appointments on, and reactivates them', () => {
    cy.seedStaffAccount().then((account) => {
      const email = `leaver-${Date.now()}@example.test`
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email,
        password: 'Test1234!',
        fullName: 'Leo Leaving',
      }).then((leaver) => {
        cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Fut', lastName: 'Ure' }).then((patient) => {
          const soon = new Date(Date.now() + 3 * 86400000).toISOString()
          cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, startsAt: soon, practitionerId: leaver.teamMemberId }).then((appt) => {
            cy.login(account.email, account.password)
            openMember('Leo Leaving')
            cy.get('[data-cy=member-deactivate]').click()
            cy.get('[data-cy=member-deactivate-future]').should('contain', '1 appointments from now on')
            cy.get('[data-cy=member-reassign]').select('Test Owner')
            confirm()
            cy.location('pathname').should('eq', '/settings/team')
            cy.contains('[data-cy=team-member-row]', 'Leo Leaving').should('not.exist')
            cy.contains('[data-cy=team-deactivated-row]', 'Leo Leaving').should('be.visible')

            cy.task<any>('db:teamMemberDetail', { teamMemberId: leaver.teamMemberId }).then((m) => {
              expect(m.deleted_at).to.be.a('string')
              expect(m.online_booking_enabled).to.eq(false)
              expect(new Date(m.bannedUntil).getTime()).to.be.greaterThan(Date.now())
            })
            cy.task<any>('db:appointmentById', { appointmentId: appt.id }).its('practitioner_id').should('eq', account.teamMemberId)

            cy.contains('[data-cy=team-deactivated-row]', 'Leo Leaving').find('[data-cy=team-reactivate]').click()
            cy.contains('Leo Leaving is back.').should('be.visible')
            cy.contains('[data-cy=team-member-row]', 'Leo Leaving').should('exist')
            cy.task<any>('db:teamMemberDetail', { teamMemberId: leaver.teamMemberId }).then((m) => {
              expect(m.deleted_at).to.eq(null)
              expect(m.bannedUntil === null || new Date(m.bannedUntil).getTime() <= Date.now()).to.eq(true)
            })
          })
        })
      })
    })
  })

  it('lets an owner make someone else an owner, and refuses deactivating yourself', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email: `partner-${Date.now()}@example.test`,
        password: 'Test1234!',
        fullName: 'Paula Partner',
      }).then((partner) => {
        cy.login(account.email, account.password)
        openMember('Paula Partner')
        cy.get('[data-cy=member-owner]').should('have.attr', 'aria-checked', 'false').click()
        cy.get('[data-cy=confirm-dialog]').should('contain', 'Make Paula Partner an owner?')
        confirm()
        cy.get('[data-cy=member-owner]').should('have.attr', 'aria-checked', 'true')
        cy.get('[data-cy=member-owner-chip]').should('exist')
        cy.task('db:teamMemberDetail', { teamMemberId: partner.teamMemberId }).its('is_owner').should('eq', true)

        openMember('Test Owner')
        cy.get('[data-cy=member-deactivate]').should('not.exist')
        cy.get('[data-cy=member-reset-password]').should('not.exist')
      })
    })
  })
})
