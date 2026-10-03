// "Log session" on the Money tab voided whatever unpaid receipt the visit
// carried and raised a fresh one for the bono session. Voiding took any
// extras on that receipt with it -- a product sold at the visit stopped being
// owed -- and left the appointment with two receipts, which the calendar's
// billing tab cannot read. It now does what the calendar does: the visit's
// own line is replaced, extras stay owed, and one receipt with nothing else on
// it is reused rather than duplicated.
function sessionLogged(patientId: string, packagePurchaseId: string, attempt = 0): Cypress.Chainable<any> {
  return cy.task<any>('db:packageSessionEffects', { patientId, packagePurchaseId }).then((effects) => {
    if (effects.sessions.length > 0 || attempt >= 40) return cy.wrap(effects)
    cy.wait(250)
    return sessionLogged(patientId, packagePurchaseId, attempt + 1)
  })
}

// The session's charge is the last thing written, so wait for it before
// reading what happened to the receipt.
function chargedFor(appointmentId: string, attempt = 0): Cypress.Chainable<any[]> {
  return cy.task<any[]>('db:invoicesForAppointment', { appointmentId }).then((rows) => {
    const charged = rows.some((r) => r.invoice_line_items.some((l: any) => l.package_purchase_id))
    if (charged || attempt >= 40) return cy.wrap(rows)
    cy.wait(250)
    return chargedFor(appointmentId, attempt + 1)
  })
}

function yesterdayAt(hour: number): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

describe('Logging a bono session on a visit with a receipt', () => {
  it('keeps the extras owed instead of voiding them', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createServiceProduct', { accountId: account.accountId, name: 'Crema', priceCents: 1000 }).then((service) => {
        cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lola', lastName: 'Extras' }).then((patient) => {
          cy.task<any>('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, packageName: 'Bono 12', sessionsTotal: 12, sessionsUsed: 0, priceCents: 52800 }).then((purchase) => {
            cy.task<any>('db:createAppointment', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              patientId: patient.id,
              practitionerId: account.teamMemberId,
              startsAt: yesterdayAt(10),
              status: 'completed',
            }).then((appt) => {
              cy.task<any>('db:createInvoice', { accountId: account.accountId, patientId: patient.id, appointmentId: appt.id, invoiceNumber: 'INV-LOLA', totalCents: 6000, status: 'unpaid' }).then((invoice) => {
                cy.task('db:addInvoiceLine', { accountId: account.accountId, invoiceId: invoice.id, description: 'Consulta', priceCents: 5000 })
                cy.task('db:addInvoiceLine', { accountId: account.accountId, invoiceId: invoice.id, description: 'Crema', priceCents: 1000, serviceId: service.id })

                cy.login(account.email, account.password)
                cy.visit(`/patients/${patient.id}?tab=billing`)
                cy.get('[data-cy="log-session-open"]').click()
                cy.get(`input[name="log-session-visit"][value="${appt.id}"]`).check()
                cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()

                sessionLogged(patient.id, purchase.id).then((effects: any) => {
                  expect(effects.sessions[0].appointment_id, 'on the real visit').to.eq(appt.id)
                })
                chargedFor(appt.id).then((rows) => {
                  const original = rows.find((r) => r.id === invoice.id)
                  expect(original.status, 'not voided: the cream is still owed').to.eq('unpaid')
                  expect(original.total_cents).to.eq(1000)
                  expect(original.invoice_line_items.map((l: any) => l.description)).to.deep.eq(['Crema'])
                })
              })
            })
          })
        })
      })
    })
  })

  it('reuses a receipt that held only the visit, rather than voiding it and raising another', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Uno', lastName: 'Solo' }).then((patient) => {
        cy.task<any>('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, packageName: 'Bono 12', sessionsTotal: 12, sessionsUsed: 0, priceCents: 52800 }).then((purchase) => {
          cy.task<any>('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            practitionerId: account.teamMemberId,
            startsAt: yesterdayAt(11),
            status: 'completed',
          }).then((appt) => {
            cy.task<any>('db:createInvoice', { accountId: account.accountId, patientId: patient.id, appointmentId: appt.id, invoiceNumber: 'INV-UNO', totalCents: 5000, status: 'unpaid' }).then((invoice) => {
              cy.task('db:addInvoiceLine', { accountId: account.accountId, invoiceId: invoice.id, description: 'Consulta', priceCents: 5000 })

              cy.login(account.email, account.password)
              cy.visit(`/patients/${patient.id}?tab=billing`)
              cy.get('[data-cy="log-session-open"]').click()
                cy.get(`input[name="log-session-visit"][value="${appt.id}"]`).check()
              cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()

              sessionLogged(patient.id, purchase.id)
              chargedFor(appt.id).then((rows) => {
                expect(rows, 'one receipt, not a void one and a new one').to.have.length(1)
                expect(rows[0].id).to.eq(invoice.id)
                expect(rows[0].total_cents, 'at the bono rate').to.eq(4400)
                expect(rows[0].invoice_line_items[0].package_purchase_id).to.eq(purchase.id)
              })
            })
          })
        })
      })
    })
  })
})
