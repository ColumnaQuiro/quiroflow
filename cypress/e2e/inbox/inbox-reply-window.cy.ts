// "Caduca en 3 h": a conversation where the patient wrote last and WhatsApp's
// 24-hour window is about to shut is marked in the list, so it is answered
// while a free reply is still possible -- unless what they wrote needs no
// answer, a "gracias" or the reminder's own Confirmar.

function openInbox() {
  cy.visit('/inbox')
  cy.get('[data-cy=inbox-list]').should('have.attr', 'data-ready', 'true')
}
function row(key: string) {
  return cy.get(`[data-cy=inbox-row][data-key="${key}"]`)
}
function hoursAgo(n: number) {
  return new Date(Date.now() - n * 3600_000).toISOString()
}

describe('Inbox, the 24-hour window', () => {
  it('marks a question about to lose its window, and leaves a thank-you alone', () => {
    cy.seedStaffAccount().then((account) => {
      const patient = (firstName: string) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Ventana' })

      patient('Pregunta').then((asking) => {
        patient('Gracias').then((thanking) => {
          patient('Reciente').then((recent) => {
            // 20 hours ago: four hours left.
            cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: asking.id, phoneNumber: '+34600111001', direction: 'inbound', bodyPreview: '¿Tenéis hueco el jueves?', createdAt: hoursAgo(20) })
            cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: thanking.id, phoneNumber: '+34600111002', direction: 'inbound', bodyPreview: 'Vale, muchas gracias 😊', createdAt: hoursAgo(20) })
            // Two hours ago: plenty of time, no pill yet.
            cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: recent.id, phoneNumber: '+34600111003', direction: 'inbound', bodyPreview: '¿Me llamáis?', createdAt: hoursAgo(2) })

            cy.login(account.email, account.password)
            openInbox()
            row(asking.id).find('[data-cy=inbox-row-window]').should('contain.text', '4 h')
            row(thanking.id).should('exist').find('[data-cy=inbox-row-window]').should('not.exist')
            row(recent.id).should('exist').find('[data-cy=inbox-row-window]').should('not.exist')
          })
        })
      })
    })
  })

  it('"Por caducar" lists only those, the least time left first', () => {
    cy.seedStaffAccount().then((account) => {
      const patient = (firstName: string) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Filtro' })

      patient('Urgente').then((urgent) => {
        patient('Pronto').then((soon) => {
          patient('Cerrada').then((closing) => {
            patient('Tranquila').then((calm) => {
              cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: urgent.id, phoneNumber: '+34600222001', direction: 'inbound', bodyPreview: '¿Me confirmáis la hora?', createdAt: hoursAgo(23.5) })
              cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: soon.id, phoneNumber: '+34600222002', direction: 'inbound', bodyPreview: 'Quería pedir cita', createdAt: hoursAgo(19) })
              cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: closing.id, phoneNumber: '+34600222003', direction: 'inbound', bodyPreview: 'Perfecto, gracias', createdAt: hoursAgo(21) })
              cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: calm.id, phoneNumber: '+34600222004', direction: 'inbound', bodyPreview: '¿Y el viernes?', createdAt: hoursAgo(3) })

              cy.login(account.email, account.password)
              openInbox()
              cy.get('[data-cy=inbox-filter-expiring]').should('contain.text', '2').click()
              cy.get('[data-cy=inbox-row]').should('have.length', 2)
              cy.get('[data-cy=inbox-row]').eq(0).should('have.attr', 'data-key', urgent.id)
              cy.get('[data-cy=inbox-row]').eq(1).should('have.attr', 'data-key', soon.id)

              cy.get('[data-cy=inbox-filter-expiring]').click()
              row(calm.id).should('exist')
              row(closing.id).should('exist')
            })
          })
        })
      })
    })
  })

  it('takes the pill off once we answer', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Contestada', lastName: 'Ventana' }).then((p) => {
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: p.id, phoneNumber: '+34600111004', direction: 'inbound', bodyPreview: '¿Hay cita mañana?', createdAt: hoursAgo(23.5) })
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: p.id, phoneNumber: '+34600111004', direction: 'outbound', bodyPreview: 'Sí, a las 10', createdAt: hoursAgo(23) })

        cy.login(account.email, account.password)
        openInbox()
        // Answered: out of Needs reply, and without the pill in the full list.
        row(p.id).should('not.exist')
        cy.showAllConversations()
        row(p.id).should('exist').find('[data-cy=inbox-row-window]').should('not.exist')
      })
    })
  })
})
