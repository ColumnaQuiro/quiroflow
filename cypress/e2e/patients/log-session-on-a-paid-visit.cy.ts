// A visit paid at the walk-in price, then a bono bought: the visit becomes a
// session of it, and what was paid goes towards the bono.
//
// A patient paid 60 EUR for a visit, said they did not want a bono, and bought
// a 10-session bono (46 EUR a session) a few days later. The clinic counts the
// first visit as one of the ten. Log session would not offer a paid visit, so
// reception linked the 60 EUR to the bono instead -- which left it paying the
// visit too, counted twice.
//
// And a session logged here against the visit the patient was in stayed
// "booked" -- the calendar still showed it waiting to be charged.

/**
 * Polled: nothing on the page marks the moment the writes are done. The
 * session row is written before the charge and the completion, so waiting on
 * it alone reads the receipt half-way -- `done` names the last write a test
 * depends on.
 */
function sessionLogged(patientId: string, packagePurchaseId: string, done: (effects: any) => boolean, attempt = 0): Cypress.Chainable<any> {
  return cy.task<any>('db:packageSessionEffects', { patientId, packagePurchaseId }).then((effects) => {
    if ((effects.sessions.length > 0 && done(effects)) || attempt >= 40) return cy.wrap(effects)
    cy.wait(250)
    return sessionLogged(patientId, packagePurchaseId, done, attempt + 1)
  })
}

describe('Logging a bono session', () => {
  it('turns a visit paid at the walk-in price into a session, its money onto the bono', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ema', lastName: 'Walkin' }).then((patient: any) => {
        const yesterday = new Date(Date.now() - 86400000).toISOString()
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          practitionerId: account.teamMemberId,
          startsAt: yesterday,
          status: 'completed',
        }).then((appt: any) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, invoiceNumber: 'INV-WALK', totalCents: 6000, status: 'paid', appointmentId: appt.id }).then((inv: any) => {
            cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 6000, method: 'card', purpose: 'visit' })
            cy.task('db:createPackagePurchase', {
              accountId: account.accountId,
              patientId: patient.id,
              packageName: 'Bono 10 sesiones',
              sessionsTotal: 10,
              sessionsUsed: 0,
              priceCents: 46000,
              owedCents: 46000,
            }).then((purchase: any) => {
              cy.login(account.email, account.password)
              cy.visit(`/patients/${patient.id}?tab=billing`)

              // Paid is not missing anything, so the bono card does not nag.
              cy.get('[data-cy="log-session-open"]').should('exist')
              cy.get('[data-cy="bono-unlogged-visits"]').should('not.exist')

              cy.get('[data-cy="log-session-open"]').click()
              cy.get('[data-cy="log-session-paid-visit"]').should('contain', '60,00').and('contain', 'INV-WALK')
              // Never picked for anyone: moving money is a decision.
              cy.get('[data-cy="confirm-dialog-confirm"]').should('be.disabled')
              cy.get('[data-cy="log-session-visit"]').click()
              cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()

              // The receipt is zeroed before it is re-charged, so wait for the
              // charge itself, not merely for the walk-in price to be gone.
              sessionLogged(patient.id, purchase.id, (e) => e.invoices.every((i: any) => i.total_cents === 4600)).then((effects: any) => {
                expect(effects.sessions, 'one session, on that visit').to.have.length(1)
                expect(effects.sessions[0].appointment_id).to.eq(appt.id)
                expect(effects.sessions[0].amount_cents, 'at the bono rate').to.eq(4600)
                expect(effects.purchase.sessions_used).to.eq(1)

                // The same receipt, now the session's charge -- no second one.
                expect(effects.invoices, 'one receipt').to.have.length(1)
                expect(effects.invoices[0].id).to.eq(inv.id)
                expect(effects.invoices[0].total_cents).to.eq(4600)
                expect(effects.invoices[0].status).to.eq('paid')
                expect(effects.lineItems.map((l: any) => l.package_purchase_id)).to.deep.eq([purchase.id])
              })

              cy.task('db:paymentsFor', { patientId: patient.id }).then((rows: any) => {
                expect(rows, 'the 60 is still the only payment').to.have.length(1)
                // Off the visit, onto the bono: counted once.
                expect(rows[0].invoice_id).to.eq(null)
                expect(rows[0].purpose).to.eq('bono')
              })

              // 460 - 60 still owed on the bono.
              cy.contains('400,00').should('exist')
            })
          })
        })
      })
    })
  })

  it('completes the calendar visit it is logged against', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'En', lastName: 'Cobro' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 10 sesiones',
          sessionsTotal: 10,
          sessionsUsed: 0,
          priceCents: 46000,
        }).then((purchase: any) => {
          // Checked in and sent to checkout, not yet completed.
          cy.task('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            practitionerId: account.teamMemberId,
            startsAt: new Date().toISOString(),
            status: 'booked',
            checkedIn: true,
          }).then((appt: any) => {
            cy.login(account.email, account.password)
            cy.visit(`/patients/${patient.id}?tab=billing`)

            cy.get('[data-cy="log-session-open"]').click()
            cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()
            sessionLogged(patient.id, purchase.id, (e) => e.appointments.every((a: any) => a.status === 'completed')).then((effects: any) => {
              expect(effects.sessions[0].appointment_id).to.eq(appt.id)
              expect(effects.appointments.find((a: any) => a.id === appt.id).status, 'no longer waiting at checkout').to.eq('completed')
            })
          })
        })
      })
    })
  })
})
