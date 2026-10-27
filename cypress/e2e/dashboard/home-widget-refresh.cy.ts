// The iOS widget fetching its own snapshot while the app is closed
// (server/api/widget/home.get.ts, 20261027172713_home_widget_refresh.sql).
// It holds a widget token, not a session: good only while the session that
// issued it is, and only for running get_home_widget as that person -- with
// RLS, the money gate and two-factor exactly as the app gets them.

const PASSWORD = 'Test1234!'

function widget(token: string, accountId: string, extra: Record<string, string> = {}) {
  return cy.request({
    url: `/api/widget/home?${new URLSearchParams({ account: accountId, tz: 'Europe/Madrid', lang: 'es', privacy: '0', ...extra })}`,
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  })
}

describe('Home-screen widget refreshing itself', () => {
  it('hands the owner the snapshot the app would write, until they sign out', () => {
    cy.seedStaffAccount().then((account: any) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Carmen', lastName: 'Ruiz' }).then((patient) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 5000, method: 'cash' })
      })
      cy.task<any>('db:homeWidgetTokenAs', { email: account.email, password: account.password }).then(({ token, error }) => {
        expect(error).to.eq(null)
        expect(token).to.match(/^[0-9a-f]{64}$/)

        // Mapped by widgetSnapshotFromRpc, in the person's language.
        widget(token, account.accountId).then((res) => {
          expect(res.status).to.eq(200)
          expect(res.headers['cache-control']).to.eq('no-store')
          expect(res.body.kind).to.eq('clinic')
          expect(res.body.money.label).to.eq('Cobrado')
          expect(res.body.money.value).to.match(/^50\s€$/)
          expect(res.body.labels.now).to.eq('ahora')
        })
        widget(token, account.accountId, { lang: 'en', privacy: '1' }).then((res) => {
          expect(res.status).to.eq(200)
          expect(res.body.money.label).to.eq('Taken')
          expect(res.body.money.value).to.eq('€••••')
        })

        // Signing out ends the session, and the token with it.
        cy.task('db:signOutHomeWidgetSession', { token })
        widget(token, account.accountId).its('status').should('eq', 401)
      })
    })
  })

  it('gives the front desk no money, and nobody another clinic', () => {
    const stamp = Date.now()
    cy.seedStaffAccount().then((mine: any) => {
      cy.task<any>('db:createTeamMemberWithRole', { accountId: mine.accountId, clinicId: mine.clinicId, roleName: 'Front Desk', email: `desk-${stamp}@example.test`, password: PASSWORD, fullName: 'Recepción Demo' }).then((desk) => {
        cy.task<any>('db:homeWidgetTokenAs', { email: desk.email, password: PASSWORD }).then(({ token }) => {
          widget(token, mine.accountId).then((res) => {
            expect(res.status).to.eq(200)
            expect(res.body.kind).to.eq('staff')
            expect(res.body.scope).to.eq('clinic')
            expect(JSON.stringify(res.body)).not.to.match(/money|€/)
          })
        })
      })
      cy.seedStaffAccount().then((theirs: any) => {
        cy.task<any>('db:homeWidgetTokenAs', { email: theirs.email, password: theirs.password }).then(({ token }) => {
          widget(token, mine.accountId).its('status').should('eq', 403)
        })
      })
    })
  })

  it('stops a password-only session once the clinic requires two-factor', () => {
    cy.seedStaffAccount().then((account: any) => {
      cy.task<any>('db:homeWidgetTokenAs', { email: account.email, password: account.password }).then(({ token }) => {
        widget(token, account.accountId).its('status').should('eq', 200)
        cy.task('db:setRequireTwoFactor', { accountId: account.accountId, required: true })
        widget(token, account.accountId).its('status').should('eq', 403)
        // ...and a session still waiting for its code cannot get a token at all.
        cy.task<any>('db:homeWidgetTokenAs', { email: account.email, password: account.password }).its('error').should('match', /Two-factor/)
      })
    })
  })

  it('refuses a made-up token', () => {
    cy.seedStaffAccount().then((account: any) => {
      widget('0'.repeat(64), account.accountId).its('status').should('eq', 401)
      cy.request({ url: `/api/widget/home?account=${account.accountId}`, failOnStatusCode: false }).its('status').should('eq', 401)
    })
  })
})
