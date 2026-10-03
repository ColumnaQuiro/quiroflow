import type { StaffAccount } from '../../support/commands'

// Emailing a patient their appointment history or their account statement
// went to the patient's own address whatever their record said: a minor, or
// someone marked "do not contact", got it anyway. Every other way of reaching
// a patient refuses both -- the WhatsApp version of the same history, the
// plain email composer, the automations -- and the email versions now do too,
// with the buttons disabled on the record so nobody is offered a send that
// will be refused.

describe('History and statement emails', () => {
  function blockedPatient(account: StaffAccount, firstName: string, flags: { isMinor?: boolean; doNotContact?: boolean }) {
    return cy
      .task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Bloqueado', email: `${firstName.toLowerCase()}-${Date.now()}@example.test` })
      .then((p) => cy.task('db:setPatientContactFlags', { patientId: p.id, ...flags }).then(() => p))
  }

  it('are refused for a minor and for someone marked do not contact', () => {
    cy.seedStaffAccount().then((account) => {
      blockedPatient(account, 'Menor', { isMinor: true }).then((minor) => {
        blockedPatient(account, 'Nocontactar', { doNotContact: true }).then((dnc) => {
          cy.login(account.email, account.password)
          cy.visit('/dashboard')
          for (const p of [minor, dnc]) {
            for (const path of ['appointment-history/send', 'statement/send']) {
              cy.request({ method: 'POST', url: `/api/patients/${p.id}/${path}`, failOnStatusCode: false }).then((res) => {
                expect(res.status, path).to.eq(400)
                expect(res.body.statusMessage, path).to.eq('This patient cannot be contacted (under age or marked do not contact).')
              })
            }
          }
        })
      })
    })
  })

  it('are not offered on the record of a patient who must not be contacted', () => {
    cy.seedStaffAccount().then((account) => {
      blockedPatient(account, 'Nocontactar', { doNotContact: true }).then((dnc) => {
        cy.login(account.email, account.password)

        cy.visit(`/patients/${dnc.id}?tab=appointments`)
        cy.get('[data-cy=send-history]', { timeout: 15000 }).should('be.disabled')

        cy.visit(`/patients/${dnc.id}?tab=money`)
        cy.get('[data-cy=ledger-menu]', { timeout: 15000 }).click()
        cy.get('[data-cy=send-statement]').should('be.disabled')
      })
    })
  })
})
