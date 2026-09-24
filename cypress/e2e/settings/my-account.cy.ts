import type { StaffAccount } from '../../support/commands'

// "Mi cuenta" (/account): who you are, your schedule, your language, your
// security, and removing your own access. Every state is reached by clicking
// and asserted through data-cy hooks and the database, never by hovering.

const MON_WED_ONLY = { mon: [['09:00', '14:00']], wed: [['16:00', '21:00']] }

function teamMember(teamMemberId: string) {
  return cy.task<{ full_name: string; color: string; language_preference: string; theme_preference: string; deleted_at: string | null }>('db:teamMemberById', { teamMemberId })
}

// The server-rendered page is visible before it is interactive; the page
// marks itself ready once it has mounted and loaded, and every click waits.
function openAccount(account: { email: string; password: string }) {
  cy.login(account.email, account.password)
  cy.visit('/account')
  cy.get('[data-cy=account-page]').should('have.attr', 'data-ready', 'true')
}

describe('My account', () => {
  it('shows who you are and your schedule, and saves name and colour only on Save', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: MON_WED_ONLY })
      openAccount(account)

      // Tú: the login email is shown, not editable, with who to ask.
      cy.get('[data-cy=account-email]').should('contain.text', account.email).find('input').should('not.exist')
      cy.get('[data-cy=account-you]').should('contain.text', 'hola@quiroflow.com')
      cy.get('[data-cy=account-role]').should('contain.text', 'Owner')
      cy.get('[data-cy=account-clinics] span').should('have.length.at.least', 1)

      // Tu agenda: the seeded owner is a practitioner, with their own hours.
      cy.get('[data-cy=account-hours]').should('contain.text', 'Monday').and('contain.text', '09:00–14:00').and('contain.text', 'Wednesday').and('contain.text', '16:00–21:00')
      cy.get('[data-cy=account-hours]').contains('div', 'Tuesday').should('contain.text', 'Not working')

      // The seeded colour predates the palette: kept, as its own selected swatch.
      cy.get('[data-cy=account-palette] [role=radio]').should('have.length', 11)
      cy.get('[data-cy=account-palette] [aria-label=Custom]').should('have.attr', 'aria-checked', 'true')

      // Nothing waits for Save until something changes; Discard puts it back.
      cy.get('[data-cy=account-unsaved]').should('not.exist')
      cy.get('[data-cy=account-palette] [data-color="#3b82f6"]').click()
      cy.get('[data-cy=account-unsaved]').should('be.visible')
      cy.get('[data-cy=account-discard]').click()
      cy.get('[data-cy=account-unsaved]').should('not.exist')
      cy.get('[data-cy=account-palette] [aria-label=Custom]').should('have.attr', 'aria-checked', 'true')

      // Change both, save once.
      cy.get('[data-cy=account-name]').clear().type('Marta Vidal')
      cy.get('[data-cy=account-palette] [data-color="#3b82f6"]').click()
      cy.get('[data-cy=account-save]').click()
      cy.get('[data-cy=account-unsaved]').should('not.exist')
      teamMember(account.teamMemberId).then((tm) => {
        expect(tm.full_name).to.equal('Marta Vidal')
        expect(tm.color).to.equal('#3b82f6')
      })

      // After a reload the palette colour is chosen and the custom swatch is gone.
      cy.reload()
      cy.get('[data-cy=account-page]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=account-palette] [data-color="#3b82f6"]').should('have.attr', 'aria-checked', 'true')
      cy.get('[data-cy=account-palette] [role=radio]').should('have.length', 10)
      cy.get('[data-cy=account-name]').should('have.value', 'Marta Vidal')
    })
  })

  it('has no theme picker, and the top-bar theme survives a reload', () => {
    cy.seedStaffAccount().then((account) => {
      openAccount(account)
      cy.get('main').should('not.contain.text', 'Appearance').and('not.contain.text', 'Dark')

      cy.get('[data-cy=theme-toggle]').click()
      cy.get('[data-cy=theme-option-dark]').click()
      cy.get('html').should('have.attr', 'data-theme', 'dark')
      teamMember(account.teamMemberId).its('theme_preference').should('equal', 'dark')

      // The store re-applies the saved theme on load: saved, it stays.
      cy.reload()
      cy.get('[data-cy=account-page]').should('have.attr', 'data-ready', 'true')
      cy.get('html').should('have.attr', 'data-theme', 'dark')
    })
  })

  it('switches the language at once and saves it', () => {
    cy.seedStaffAccount().then((account) => {
      openAccount(account)
      cy.get('[data-cy=account-language] [data-lang=es]').click()
      cy.contains('h1', 'Mi cuenta').should('be.visible')
      cy.get('[data-cy=account-language] [data-lang=es]').should('have.attr', 'aria-checked', 'true')
      teamMember(account.teamMemberId).its('language_preference').should('equal', 'es')
    })
  })

  it('changes the password in its own form, and the new one signs in', () => {
    cy.seedStaffAccount().then((account) => {
      openAccount(account)
      const next = `Q-flow-${Date.now()}-renewed`
      cy.get('[data-cy=account-password-form]').should('not.exist')
      cy.get('[data-cy=account-password-open]').click()
      cy.get('[data-cy=account-new-password]').type(next)
      cy.get('[data-cy=account-confirm-password]').type(next.slice(0, -1))
      cy.get('[data-cy=account-password-form]').should('contain.text', "They don't match yet")
      cy.get('[data-cy=account-confirm-password]').type(next.slice(-1))
      cy.get('[data-cy=account-password-form]').should('contain.text', 'They match')
      cy.get('[data-cy=account-password-submit]').click()
      cy.contains('Password updated.').should('be.visible')
      cy.get('[data-cy=account-password-form]').should('not.exist')

      // Proof it took: a fresh sign-in with the new password gets in.
      cy.login(account.email, next)
      cy.visit('/account')
      cy.get('[data-cy=account-page]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=account-email]').should('contain.text', account.email)
    })
  })

  it('signs out the other devices', () => {
    cy.seedStaffAccount().then((account) => {
      openAccount(account)
      cy.get('[data-cy=account-last-sign-in]').should('contain.text', 'today at')
      cy.get('[data-cy=account-sign-out-others]').click()
      cy.get('[data-cy=account-sign-out-others]').should('contain.text', 'Signed out').and('be.disabled')
      // This session is the one kept.
      cy.reload()
      cy.get('[data-cy=account-page]').should('have.attr', 'data-ready', 'true')
    })
  })

  it('turns two-factor off only through its dialog', () => {
    cy.seedStaffAccount().then((account) => {
      openAccount(account)
      cy.get('[data-testid="two-factor-card"]').contains('button', 'Set up two-factor').click()
      cy.get('[data-testid="two-factor-secret"]', { timeout: 15000 })
        .invoke('attr', 'data-secret')
        .then((secret) => {
          cy.task<string>('totp:code', { secret }).then((code) => {
            cy.get('#two-factor-enroll-code').type(code)
            cy.contains('button', 'Turn on two-factor').click()
          })
        })
      cy.get('[data-testid="two-factor-card"]').should('contain.text', 'On').and('contain.text', 'With an authenticator app since')

      // Cancel keeps it on; Escape does too.
      cy.get('[data-cy=account-two-factor-off]').click()
      cy.get('[data-cy=confirm-dialog]').should('contain.text', 'Turn off two-factor authentication?')
      cy.get('[data-cy=confirm-dialog-cancel]').should('be.focused').click()
      cy.get('[data-cy=confirm-dialog]').should('not.exist')
      cy.get('[data-cy=account-two-factor-off]').click()
      cy.get('body').type('{esc}')
      cy.get('[data-cy=confirm-dialog]').should('not.exist')
      cy.get('[data-testid="two-factor-card"]').should('contain.text', 'On')

      cy.get('[data-cy=account-two-factor-off]').click()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-testid="two-factor-card"]').should('contain.text', 'Off')
    })
  })

  it('tells the only owner why they cannot remove their access', () => {
    cy.seedStaffAccount().then((account) => {
      openAccount(account)
      cy.get('[data-cy=account-sole-owner]').should('contain.text', "You're the only owner").and('contain.text', 'hola@quiroflow.com')
      cy.get('[data-cy=account-remove-access-open]').should('be.disabled')
    })
  })

  it('lets someone else remove their access once they type the word', () => {
    cy.seedStaffAccount().then((owner: StaffAccount) => {
      const email = `desk-${Date.now()}@example.test`
      cy.task<{ email: string; password: string; teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: owner.accountId,
        clinicId: owner.clinicId,
        roleName: 'Front Desk',
        email,
        password: 'Front-desk-password-1',
        fullName: 'Carmen Ruiz',
      }).then((desk) => {
        openAccount(desk)
        // Not a practitioner: no schedule section.
        cy.get('[data-cy=account-schedule]').should('not.exist')
        cy.get('[data-cy=account-role]').should('contain.text', 'Front Desk')
        cy.get('[data-cy=account-sole-owner]').should('not.exist')

        cy.get('[data-cy=account-remove-access-open]').click()
        cy.get('[data-cy=confirm-dialog]').should('contain.text', 'STAYS').and('contain.text', 'GOES')
        cy.get('[data-cy=confirm-dialog-confirm]').should('be.disabled')
        cy.get('[data-cy=confirm-dialog-word]').type('delet')
        cy.get('[data-cy=confirm-dialog-confirm]').should('be.disabled')
        cy.get('[data-cy=confirm-dialog-word]').type('e')
        cy.get('[data-cy=confirm-dialog-confirm]').should('not.be.disabled').click()

        cy.location('pathname', { timeout: 15000 }).should('eq', '/login')
        teamMember(desk.teamMemberId).its('deleted_at').should('not.equal', null)
      })
    })
  })
})
