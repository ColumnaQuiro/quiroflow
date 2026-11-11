// Settings > Brand: the clinic's own logo, name and colour in the patient app.
//
// Two things have to hold. A clinic can set its look up and see it before
// buying anything, and none of it reaches a patient until the account has the
// add-on -- which the database decides (get_clinic_branding), since that is
// what the app asks, signed out, with nothing but the join code.

interface Branding { name: string; color: string | null; logo_path: string | null; active: boolean }

function brandingFor(slug: string) {
  return cy.task<{ error: string | null; data: Branding | null }>('db:callRpcAsAnon', { fn: 'get_clinic_branding', args: { p_slug: slug } })
}

describe('Settings > Brand', () => {
  it('lets a clinic set its look up as a preview, and gives patients nothing without the add-on', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/branding')

      cy.get('[data-cy=branding-status]').should('contain', 'Preview only')
      cy.get('[data-cy=branding-save]').should('be.disabled')

      cy.get('[data-cy=branding-name]').type('Clínica Demo')
      cy.get('[data-cy=branding-preset-0f766e]').click()
      cy.get('[data-cy=branding-colour]').should('have.value', '#0f766e')
      // The preview is the clinic's from the first keystroke, in both themes.
      cy.get('[data-cy=branding-preview-light] [data-cy=branding-preview-name]').should('have.text', 'Clínica Demo')
      cy.get('[data-cy=branding-preview-dark]').should('have.attr', 'style').and('contain', '--color-brand:')
      cy.get('[data-cy=branding-preview-light]').should('have.attr', 'style').and('contain', '--color-brand: 15 118 110;')

      cy.get('[data-cy=branding-save]').click()
      cy.contains('Saved.').should('be.visible')
      cy.get('[data-cy=branding-save]').should('be.disabled')

      // Saved, and still nothing for a patient's phone to draw with.
      brandingFor(account.accountSlug).then((r) => {
        expect(r.error).to.be.null
        expect(r.data).to.be.null
      })

      // And it is still there after a reload.
      cy.reload()
      cy.get('[data-cy=branding-name]').should('have.value', 'Clínica Demo')
      cy.get('[data-cy=branding-colour]').should('have.value', '#0f766e')
    })
  })

  it('reaches patients once the account has the add-on, and stops when it is locked', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateRows', { table: 'accounts', values: { patient_app_brand_name: 'Clínica Demo', patient_app_brand_color: '#be123c' }, match: { id: account.accountId } })
      cy.task('db:updateRows', { table: 'subscriptions', values: { branding_addon: true }, match: { account_id: account.accountId } })

      brandingFor(account.accountSlug).then((r) => {
        expect(r.error).to.be.null
        expect(r.data).to.deep.include({ name: 'Clínica Demo', color: '#be123c', active: true })
      })

      cy.login(account.email, account.password)
      cy.visit('/settings/branding')
      cy.get('[data-cy=branding-status]').should('contain', 'Your patients see this look')
      cy.get('[data-cy=branding-contact]').should('not.exist')

      // A locked account keeps nothing it had bought.
      cy.setSubscriptionStatus(account.accountId, 'locked')
      brandingFor(account.accountSlug).then((r) => expect(r.data).to.be.null)
    })
  })

  it('falls back to the clinic name, and answers nothing for an unknown code', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateRows', { table: 'subscriptions', values: { branding_addon: true }, match: { account_id: account.accountId } })
      brandingFor(account.accountSlug).then((r) => {
        expect(r.data).to.deep.include({ name: account.accountName, color: null, active: true })
      })
      brandingFor('no-such-clinic-code').then((r) => {
        expect(r.error).to.be.null
        expect(r.data).to.be.null
      })
      // Asking for the preview is for the clinic's own staff: a stranger
      // adding the flag to another clinic's code gets what a patient gets.
      cy.task('db:updateRows', { table: 'subscriptions', values: { branding_addon: false }, match: { account_id: account.accountId } })
      cy.task<{ data: Branding | null }>('db:callRpcAsAnon', { fn: 'get_clinic_branding', args: { p_slug: account.accountSlug, p_preview: true } }).then((r) => expect(r.data).to.be.null)
    })
  })

  it('refuses a colour that is not one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/branding')
      cy.get('[data-cy=branding-colour]').type('teal')
      cy.get('[data-cy=branding-colour]').should('have.attr', 'aria-invalid', 'true')
      cy.get('[data-cy=branding-name]').type('Clínica Demo')
      cy.get('[data-cy=branding-save]').click()
      cy.contains('That is not a colour').should('be.visible')
    })
  })
})
