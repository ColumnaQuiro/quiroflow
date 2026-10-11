// "Acciones" in an Inbox conversation (InboxChatActions): book the patient,
// open their record, or put the booking or a payment link in the reply --
// never sent from there, only put in the box. Stripe itself is not in CI, so
// the payment link is covered up to the clinic having no card payments, and
// the staff endpoint's own rules beside it.

function openInbox() {
  cy.visit('/inbox')
  cy.get('[data-cy=inbox-list]').should('have.attr', 'data-ready', 'true')
}
function row(key: string) {
  return cy.get(`[data-cy=inbox-row][data-key="${key}"]`)
}
function minutesAgo(n: number) {
  return new Date(Date.now() - n * 60000).toISOString()
}
const composer = () => cy.get('textarea[placeholder="Type a message…"]')

describe('Inbox, actions from the chat', () => {
  it('puts the booking link in the reply without sending it, and books from the conversation', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Vera', lastName: 'Vidal' }).then((vera) => {
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: vera.id, phoneNumber: '+34600123123', direction: 'inbound', bodyPreview: '¿Cómo reservo?', createdAt: minutesAgo(10) })

        cy.login(account.email, account.password)
        openInbox()
        row(vera.id).click()
        cy.get('[data-cy=thread-message]').should('have.length', 1)

        cy.get('[data-cy=thread-actions]').click()
        cy.get('[data-cy=thread-action-booking-link]').should('not.be.disabled').click()
        composer().invoke('val').should('contain', `/book/${account.accountSlug}`)
        // In the box, not sent.
        cy.get('[data-cy=thread-message]').should('have.length', 1)
        cy.task<unknown[]>('db:selectRows', { table: 'whatsapp_messages', columns: 'id', match: { patient_id: vera.id } }).should('have.length', 1)

        cy.get('[data-cy=thread-actions]').click()
        cy.get('[data-cy=thread-action-book]').click()
        cy.location('pathname').should('eq', '/calendar')
        cy.location('search').should('contain', `patient=${vera.id}`)
      })
    })
  })

  it("lists the patient's unpaid invoices for a payment link, and says when the clinic takes no card payments", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Wenceslao', lastName: 'Webb' }).then((w) => {
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: w.id, phoneNumber: '+34600321321', direction: 'inbound', bodyPreview: '¿Os debo algo?', createdAt: minutesAgo(10) })
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: w.id, totalCents: 4500, status: 'unpaid' })
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: w.id, totalCents: 3000, status: 'paid' })

        cy.login(account.email, account.password)
        openInbox()
        row(w.id).click()
        cy.get('[data-cy=thread-actions]').click()
        cy.get('[data-cy=thread-action-pay-link]').click()
        // The unpaid one only.
        cy.get('[data-cy=thread-action-invoice]').should('have.length', 1).and('contain.text', '45,00')
        cy.get('[data-cy=thread-action-invoice]').click()
        cy.get('[data-cy=thread-action-error]').should('contain.text', 'Online payment is not set up')
        composer().invoke('val').should('eq', '')
      })
    })
  })

  it('refuses a payment link for a settled invoice or one from another clinic', () => {
    cy.seedStaffAccount().then((account) => {
      cy.seedStaffAccount().then((other) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Xenia', lastName: 'Xifré' }).then((x) => {
          cy.task<{ id: string }>('db:createPatient', { accountId: other.accountId, clinicId: other.clinicId, firstName: 'Yago', lastName: 'Yuste' }).then((y) => {
            cy.task<{ id: string }>('db:createInvoice', { accountId: account.accountId, patientId: x.id, totalCents: 4500, status: 'paid' }).then((paid) => {
              cy.task<{ id: string }>('db:createInvoice', { accountId: other.accountId, patientId: y.id, totalCents: 4500, status: 'unpaid' }).then((theirs) => {
                cy.task('db:setStripePublishableKey', { accountId: account.accountId, key: 'pk_test_staff_link' })
                cy.task<string>('db:accessTokenFor', { email: account.email, password: account.password }).then((token) => {
                  const call = (id: string) => cy.request({ method: 'POST', url: `/api/invoices/${id}/pay-link`, headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false })
                  // Another clinic's invoice does not exist, as far as this member can tell.
                  call(theirs.id).its('status').should('eq', 404)
                  // Nothing to pay on a settled one.
                  call(paid.id).then((res) => {
                    expect(res.status).to.eq(400)
                    expect(res.body.statusMessage).to.eq('This invoice is already settled.')
                  })
                })
              })
            })
          })
        })
      })
    })
  })
})

describe('Inbox, the thread header', () => {
  it("says the patient's next visit, or that nothing is booked", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Zoe', lastName: 'Zamora' }).then((zoe) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Abel', lastName: 'Arias' }).then((abel) => {
          cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: zoe.id, phoneNumber: '+34600444555', direction: 'inbound', bodyPreview: '¿A qué hora era?', createdAt: minutesAgo(10) })
          cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: abel.id, phoneNumber: '+34600444666', direction: 'inbound', bodyPreview: 'Hola', createdAt: minutesAgo(20) })
          const inThreeDays = new Date(Date.now() + 3 * 86400000)
          inThreeDays.setUTCHours(8, 0, 0, 0)
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: zoe.id, startsAt: inThreeDays.toISOString(), status: 'booked' })

          cy.login(account.email, account.password)
          openInbox()
          row(zoe.id).click()
          cy.get('[data-cy=thread-next-visit]').should('contain.text', 'Next:')
          row(abel.id).click()
          cy.get('[data-cy=thread-next-visit]').should('contain.text', 'Nothing booked')
        })
      })
    })
  })
})
