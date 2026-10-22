// What the app's home-screen widget is handed (get_home_widget,
// 20261020142327_home_widget.sql). The RPC decides from WHO is asking:
// an owner gets the clinic's month (money taken, visits, bonos sold), a
// practitioner their own day, the front desk the clinic's day.
//
// The money gate is the point of this spec. The payments select policy lets
// the seeded Front Desk role read every payment, so nothing but the function
// itself keeps the clinic's takings off a receptionist's home screen.

const PASSWORD = 'Test1234!'

/** An instant at hh:mm today, in the clinic's (Madrid) day. */
function madridToday(hh: number, mm = 0): string {
  const now = new Date()
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
  const offset = wall - Math.floor(now.getTime() / 60000) * 60000
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, hh, mm) - offset).toISOString()
}

/** Noon on the 1st of last month: money and bonos outside this month. */
function lastMonth(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 12)).toISOString()
}

describe('Home-screen widget data', () => {
  it('gives the clinic figures to the owner and no money to anyone else', () => {
    const stamp = Date.now()
    cy.seedStaffAccount().then((account: any) => {
      const base = { accountId: account.accountId, clinicId: account.clinicId }
      cy.task<any>('db:createTeamMemberWithRole', { ...base, roleName: 'Practitioner', email: `prac-${stamp}@example.test`, password: PASSWORD, fullName: 'Lucía Ferrer', isPractitioner: true }).then((prac) => {
        cy.task<any>('db:createTeamMemberWithRole', { ...base, roleName: 'Front Desk', email: `desk-${stamp}@example.test`, password: PASSWORD, fullName: 'Recepción Demo' }).then((desk) => {
          cy.task<any>('db:createPatient', { ...base, firstName: 'Carmen', lastName: 'Ruiz' }).then((patient) => {
            const visit = (startsAt: string, extra: Record<string, unknown> = {}) =>
              cy.task('db:createAppointment', { ...base, patientId: patient.id, practitionerId: prac.teamMemberId, startsAt, ...extra })

            // Today: one done, one still to come, one no-show; a cancelled
            // and a deleted visit count for nothing.
            visit(madridToday(9, 0), { status: 'completed' })
            visit(madridToday(23, 50))
            visit(madridToday(10, 0), { status: 'no_show' })
            visit(madridToday(11, 0), { status: 'cancelled' })
            visit(madridToday(12, 0), { deletedAt: new Date().toISOString() })

            // Money this month: 50 EUR cash counts. Credit spent, a
            // write-off, a payment against a voided invoice and last
            // month's money do not.
            cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 5000, method: 'cash' })
            cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 2000, method: 'credit' })
            cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 1000, method: 'write_off' })
            cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 9900, method: 'card', paidAt: lastMonth() })
            cy.task<any>('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 3000, status: 'void' }).then((inv) => {
              cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 3000, method: 'card' })
            })

            // Two bonos sold this month, one last month.
            cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, priceCents: 30000 })
            cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, priceCents: 12000 })
            cy.task<any>('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, priceCents: 50000 }).then((old) => {
              cy.task('db:setPackagePurchasedAt', { id: old.id, purchasedAt: lastMonth() })
            })

            cy.task<any>('db:homeWidgetAs', { email: account.email, password: account.password, accountId: account.accountId }).then(({ data, error }) => {
              expect(error).to.eq(null)
              expect(data.view).to.eq('clinic')
              expect(data.figures).to.deep.eq({ payments_cents: 5000, visits_done: 1, visits_total: 2, no_shows: 1, bonos_count: 2, bonos_cents: 42000 })
            })

            cy.task<any>('db:homeWidgetAs', { email: prac.email, password: PASSWORD, accountId: account.accountId }).then(({ data, error }) => {
              expect(error).to.eq(null)
              expect(data.view).to.eq('day')
              expect(data).not.to.have.property('figures')
              expect(data.day.scope).to.eq('own')
              expect(data.day.total).to.eq(2)
              expect(data.day.done).to.eq(1)
              expect(data.day.next.map((n: any) => n.first_name)).to.deep.eq(['Carmen'])
            })

            // The seeded Front Desk role sees money on the web dashboard and
            // can read every payment. The widget still hands it none.
            cy.task<any>('db:homeWidgetAs', { email: desk.email, password: PASSWORD, accountId: account.accountId }).then(({ data, error }) => {
              expect(error).to.eq(null)
              expect(data.view).to.eq('desk')
              expect(data).not.to.have.property('figures')
              expect(JSON.stringify(data)).not.to.match(/cents/)
              expect(data.day.scope).to.eq('clinic')
              expect(data.day.next[0].practitioner).to.eq('Lucía Ferrer')
            })
          })
        })
      })
    })
  })

  it('refuses someone from another clinic', () => {
    cy.seedStaffAccount().then((mine: any) => {
      cy.seedStaffAccount().then((theirs: any) => {
        cy.task<any>('db:homeWidgetAs', { email: theirs.email, password: theirs.password, accountId: mine.accountId }).then(({ data, error }) => {
          expect(data).to.eq(null)
          expect(error).to.match(/Not a member/)
        })
      })
    })
  })
})
