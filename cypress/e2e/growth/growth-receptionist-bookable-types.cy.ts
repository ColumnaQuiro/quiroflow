// Which appointment types the AI receptionist may offer.
//
// receptionist_config.bookable_appointment_type_ids was stored and read by
// nothing, with no way to set it, so every receptionist offered any type.
// It now decides what the prompt is told, and the server reports that same
// list as `offeredTypes` -- which is what these assert, since the model itself
// is not run here (CI has no key; see growth-receptionist.cy.ts).
//
// Empty is "any active type", deliberately: it is what every production row
// holds, and it is what they have always had.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

function apiRequest(options: Partial<Cypress.RequestOptions> & { url: string }) {
  return cy.request({ failOnStatusCode: false, ...options })
}

function createType(account: SeededAccount, name: string, extra: Record<string, unknown> = {}) {
  return cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name, ...extra })
}

function offeredNames() {
  return apiRequest({ url: '/api/growth/receptionist/config' }).then((res) => {
    expect(res.status).to.eq(200)
    return (res.body.offeredTypes as { name: string }[]).map((type) => type.name)
  })
}

describe('Growth AI receptionist: appointment types it may offer', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  it('offers any active type until told otherwise, and is restricted from its own screen', () => {
    createType(account, 'Primera visita', { sortOrder: 0, durationMinutes: 45 })
    createType(account, 'Ajuste', { sortOrder: 1 }).then((ajuste) => {
      createType(account, 'Revisión antigua', { archivedAt: new Date().toISOString() })

      cy.visit('/growth/receptionist?growth=1')
      cy.get('[data-test="bookable-types"]').should('be.visible')

      // Untouched: any active type, which includes both, never the archived one.
      cy.get('[data-test="bookable-mode-any"] input').should('be.checked')
      cy.get('[data-test="offered-types"]').should('contain', 'Primera visita').and('contain', 'Ajuste').and('not.contain', 'Revisión antigua')
      cy.get('[data-test="may-book-summary"]').should('contain', 'Any active type')

      // Restrict to one. The archived type is not even listed to choose.
      cy.get('[data-test="bookable-mode-only"]').click()
      cy.get('[data-test="bookable-type-list"]').should('contain', 'Primera visita').and('not.contain', 'Revisión antigua')
      cy.get('[data-test="bookable-type-list"] li').first().should('contain', 'Primera visita')

      // "Only these" with none ticked would save as empty, which reads as
      // everything -- so it cannot be saved.
      cy.get('[data-test="bookable-needs-one"]').should('be.visible')
      cy.get('[data-test="bookable-save"]').should('be.disabled')

      cy.get(`[data-test="bookable-type-${ajuste.id}"]`).click()
      cy.get('[data-test="bookable-save"]').click()
      cy.contains('Saved.').should('be.visible')
      cy.get('[data-test="offered-types"]').should('contain', 'Ajuste').and('not.contain', 'Primera visita')
      cy.get('[data-test="may-book-summary"]').should('contain', '1 appointment type')

      // What the drafts are given, as the server computes it.
      offeredNames().should('deep.equal', ['Ajuste'])

      cy.reload()
      cy.get('[data-test="bookable-mode-only"] input').should('be.checked')
      cy.get(`[data-test="bookable-type-${ajuste.id}"] input`).should('be.checked')

      // Widening back to any type asks first.
      cy.get('[data-test="bookable-mode-any"]').click()
      cy.get('[data-test="bookable-save"]').click()
      cy.get('[role="dialog"]').should('contain', 'Offer any active type?')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-test="offered-types"]').should('contain', 'Primera visita').and('contain', 'Ajuste')
      apiRequest({ url: '/api/growth/receptionist/config' }).its('body.config.bookableAppointmentTypeIds').should('deep.equal', [])
    })
  })

  it('refuses to save an archived type or another clinic type', () => {
    createType(account, 'Ajuste').then((ajuste) => {
      createType(account, 'Revisión antigua', { archivedAt: new Date().toISOString() }).then((archived) => {
        cy.visit('/growth/receptionist?growth=1')
        cy.get('[data-test="bookable-types"]').should('be.visible')

        apiRequest({ method: 'PUT', url: '/api/growth/receptionist/config', body: { bookableAppointmentTypeIds: [ajuste.id, archived.id] } }).then((res) => {
          expect(res.status).to.eq(400)
          expect(res.body.statusMessage ?? res.body.message).to.contain('archived')
        })
        apiRequest({ method: 'PUT', url: '/api/growth/receptionist/config', body: { bookableAppointmentTypeIds: ['00000000-0000-4000-8000-000000000000'] } })
          .its('status')
          .should('eq', 400)
        apiRequest({ method: 'PUT', url: '/api/growth/receptionist/config', body: { bookableAppointmentTypeIds: 'all' } })
          .its('status')
          .should('eq', 400)

        // None of them changed anything.
        apiRequest({ url: '/api/growth/receptionist/config' }).its('body.config.bookableAppointmentTypeIds').should('deep.equal', [])
      })
    })
  })

  it('stops offering a chosen type once it is archived, without it being unticked', () => {
    createType(account, 'Ajuste').then((ajuste) => {
      // Chosen, then archived: the id stays in the stored list, which is how
      // a list saved before an archive looks.
      createType(account, 'Revisión', { archivedAt: new Date().toISOString() }).then((archived) => {
        cy.task('db:setReceptionistTypes', { accountId: account.accountId, appointmentTypeIds: [archived.id] })

        offeredNames().should('deep.equal', [])

        cy.visit('/growth/receptionist?growth=1')
        cy.get('[data-test="offered-types"]').should('contain', 'Offers no appointment type now')
        cy.get('[data-test="bookable-archived-note"]').should('contain', '1 type on this list is archived')
        // Not "any type": a list that names only archived types offers none,
        // it does not widen to everything.
        cy.get('[data-test="bookable-mode-only"] input').should('be.checked')

        cy.task('db:setReceptionistTypes', { accountId: account.accountId, appointmentTypeIds: [archived.id, ajuste.id] })
        offeredNames().should('deep.equal', ['Ajuste'])
      })
    })
  })

  it('is linked from an appointment type, and not from an archived one', () => {
    createType(account, 'Ajuste').then((ajuste) => {
      createType(account, 'Revisión', { archivedAt: new Date().toISOString() }).then((archived) => {
        const withGrowth = { onBeforeLoad: (win: Window) => win.localStorage.setItem('quiroflow-growth-preview', '1') }

        cy.visit(`/settings/appointment-types/${archived.id}`, withGrowth)
        cy.get('[data-cy=type-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=type-usage]').should('be.visible')
        cy.get('[data-cy=type-usage-receptionist]').should('not.exist')

        cy.visit(`/settings/appointment-types/${ajuste.id}`, withGrowth)
        cy.get('[data-cy=type-page]').should('have.attr', 'data-ready', 'true')
        // No list set: offered like every active type, and said so.
        cy.get('[data-cy=type-usage-receptionist]').should('contain', 'like every active type').click()
        cy.location('pathname').should('eq', '/growth/receptionist')
        cy.location('hash').should('eq', '#bookable-types')
        cy.get('[data-test="bookable-types"]').should('be.visible')
      })
    })
  })
})
