// Blind Spot (punto ciego, 20261126082211_blind_spot.sql): the test run in
// the browser (pages/patients/blind-spot/[id].vue), its tab on the patient
// record (components/blindspot/Tab.vue) and report, the add-on's gate, and the
// account that bought only Blind Spot (accounts.product = 'blind_spot').

/** A measured eye: n directions, all seen at radius r. */
function eye(n: number, r: number) {
  return { points: Array.from({ length: n }, (_, i) => ({ angle: (i * 360) / n, r })), catch_trials: 2, false_positives: 0 }
}

function seedPatient(name = 'Punto') {
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: name, lastName: 'Ciego' }).then((patient) => ({ account, patient })),
  )
}

describe('Blind Spot', () => {
  it('runs a test with only four points per eye and saves it', () => {
    seedPatient().then(({ account, patient }) => {
      cy.task('db:setSubscriptionStatus', { accountId: account.accountId, status: 'trialing' })
      cy.login(account.email, account.password)
      // The set-up is remembered per device: four points, as a clinic that
      // chose them last time.
      cy.visit(`/patients/blind-spot/${patient.id}`, { onBeforeLoad: (win) => win.localStorage.setItem('quiroflow-blind-spot-points', '4') })
      cy.get('[data-cy=blind-spot-points]').should('have.value', '4')
      cy.get('[data-cy=blind-spot-begin]').click()

      // Each eye: four directions and two catch trials, answered once the dot is out.
      // The dot hides for a moment between trials, so each answer waits for
      // it to go and come back: answering in the gap does nothing.
      for (let e = 0; e < 2; e++) {
        cy.get('[data-cy=blind-spot-start-eye]', { timeout: 10000 }).click()
        cy.get('[data-cy=blind-spot-progress]').should('contain', '/ 4')
        for (let i = 0; i < 6; i++) {
          cy.get('[data-cy=blind-spot-dot]', { timeout: 5000 }).should('be.visible')
          cy.wait(500)
          cy.get('body').trigger('keydown', { code: 'Space', key: ' ' })
          if (i < 5) cy.get('[data-cy=blind-spot-dot]').should('not.be.visible')
        }
      }

      cy.get('[data-cy=blind-spot-result]').should('be.visible')
      cy.get('[data-cy=blind-spot-left-area]').invoke('text').should('match', /\d/)
      cy.get('[data-cy=blind-spot-right-area]').invoke('text').should('match', /\d/)
      cy.get('[data-cy=blind-spot-save]').click()

      cy.location('search').should('contain', 'tab=blind-spot')
      cy.get('[data-cy=blind-spot-kpi-left]').should('be.visible')
      cy.task<Array<{ points_per_eye: number; phase: string; left_area: number | null }>>('db:selectRows', { table: 'blind_spot_tests', columns: 'points_per_eye, phase, left_area', match: { patient_id: patient.id } }).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]!.points_per_eye).to.eq(4)
        expect(rows[0]!.phase).to.eq('single')
        expect(Number(rows[0]!.left_area)).to.be.greaterThan(0)
      })
    })
  })

  it('shows a before/after pair on the record and builds the report', () => {
    seedPatient('Antes').then(({ account, patient }) => {
      cy.task('db:setSubscriptionStatus', { accountId: account.accountId, status: 'trialing' })
      const session = crypto.randomUUID()
      const common = { account_id: account.accountId, patient_id: patient.id, session_id: session, points_per_eye: 8, distance_cm: 50, px_per_mm: 3.78 }
      cy.task('db:insertRows', {
        table: 'blind_spot_tests',
        rows: [
          { ...common, phase: 'pre', right_eye: eye(8, 3.2), left_eye: eye(8, 3.6), right_area: 32.2, left_area: 40.7, tested_at: '2026-11-25T10:00:00Z' },
          { ...common, phase: 'post', right_eye: eye(8, 3.2), left_eye: eye(8, 3.3), right_area: 32.2, left_area: 34.2, tested_at: '2026-11-25T10:20:00Z', note: 'Ajuste cervical alto.' },
        ],
      })
      cy.login(account.email, account.password)
      cy.visit(`/patients/${patient.id}?tab=blind-spot`)
      cy.get('[data-cy=blind-spot-kpi-left]').should('contain', '→')
      cy.get('[data-cy=blind-spot-kpi-asymmetry]').should('contain', '26 %').and('contain', '6 %')
      cy.get('[data-cy=blind-spot-map-before]').should('have.length', 2)
      cy.get('[data-cy=blind-spot-map-after]').should('have.length', 2)

      cy.window().then((win) => cy.stub(win, 'open').returns({ location: { href: '' }, close: () => {} }))
      cy.intercept('POST', '/api/blind-spot/report').as('report')
      cy.get('[data-cy=blind-spot-report]').click()
      cy.wait('@report').its('response.statusCode').should('eq', 200)
    })
  })

  it('is not offered to an account that has not got it', () => {
    seedPatient('Sin').then(({ account, patient }) => {
      cy.task('db:setSubscriptionStatus', { accountId: account.accountId, status: 'active' })
      cy.task('db:setSubscriptionPlan', { accountId: account.accountId, planId: 'starter' })
      cy.login(account.email, account.password)
      cy.visit(`/patients/${patient.id}`)
      cy.get('[role=tablist]').should('contain', 'Overview').and('not.contain', 'Blind spot')
    })
  })

  it('keeps an account that bought only Blind Spot to its own pages', () => {
    seedPatient('Solo').then(({ account, patient }) => {
      cy.task('db:updateRows', { table: 'accounts', values: { product: 'blind_spot' }, match: { id: account.accountId } })
      cy.task('db:setSubscriptionPlan', { accountId: account.accountId, planId: 'blind_spot' })
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.location('pathname').should('eq', '/blind-spot')
      cy.visit('/calendar')
      cy.location('pathname').should('eq', '/blind-spot')
      cy.get('[data-cy=blind-spot-home-new]').should('be.visible')
      cy.visit(`/patients/${patient.id}`)
      // The record's own tab list (the Overview has tab lists of its own).
      cy.get('[role=tablist]').first().find('[role=tab]').should('have.length', 2)
      cy.get('[role=tablist]').first().should('contain', 'Blind spot').and('not.contain', 'Money')
    })
  })
})
