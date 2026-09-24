import type { StaffAccount } from '../../support/commands'

// Recordatorios (/recalls): the queue of lapsed patients, snoozing and
// dismissing with a way back, and overdue counted from the last visit the
// patient actually attended (20260924153000). Every state is reached by
// clicking and checked in the database, never by hovering.

function daysAgo(n: number, h = 10) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}
function daysAhead(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

interface Seeded {
  account: StaffAccount
  ids: Record<string, string>
}

function seed(): Cypress.Chainable<Seeded> {
  return cy.seedStaffAccount().then((account) => {
    const ids: Record<string, string> = {}
    const patient = (key: string, first: string, last: string, phone: boolean, visits: { at: string; status?: string }[]) =>
      cy
        .task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: last, defaultPractitionerId: account.teamMemberId, ...(phone ? { phone: '612345678' } : {}) })
        .then((p) => {
          ids[key] = p.id
          for (const v of visits) {
            cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: v.at, status: v.status ?? 'completed' })
          }
        })

    patient('laura', 'Laura', 'Gómez', true, [{ at: daysAgo(70) }])
    patient('pablo', 'Pablo', 'Ferrer', false, [{ at: daysAgo(56) }])
    // Came 6 weeks ago, did not come last week: 6 weeks overdue, not 1.
    patient('nuria', 'Nuria', 'Sala', true, [{ at: daysAgo(42) }, { at: daysAgo(7), status: 'no_show' }])
    // Has something booked ahead: not a recall.
    patient('sergio', 'Sergio', 'Navarro', true, [{ at: daysAgo(35) }, { at: daysAhead(5), status: 'booked' }])
    patient('elena', 'Elena', 'Castro', true, [{ at: daysAgo(30) }])
    // Dismissed a month ago, then came back 25 days ago and lapsed: back on their own.
    patient('marc', 'Marc', 'Puig', true, [{ at: daysAgo(60) }, { at: daysAgo(25) }]).then(() => {
      cy.task('db:setRecallState', { patientId: ids.marc, status: 'dismissed', dismissedAt: daysAgo(30) })
    })
    // Dismissed after their last visit: stays dismissed.
    patient('oscar', 'Óscar', 'Gil', true, [{ at: daysAgo(90) }]).then(() => {
      cy.task('db:setRecallState', { patientId: ids.oscar, status: 'dismissed', dismissedAt: daysAgo(20) })
    })
    return cy.wrap({ account, ids })
  })
}

function openRecalls(account: StaffAccount) {
  cy.login(account.email, account.password)
  cy.visit('/recalls')
  cy.get('[data-cy=recalls-page]').should('have.attr', 'data-ready', 'true')
}
function row(id: string) {
  return cy.get(`[data-cy=recall-row][data-patient-id="${id}"]`)
}

describe('Recalls', () => {
  it('lists who lapsed, counting from the last visit they came to', () => {
    seed().then(({ account, ids }) => {
      openRecalls(account)
      row(ids.laura).should('contain.text', 'Laura Gómez').find('[data-cy=recall-overdue]').should('contain.text', '10 weeks overdue')
      // The no-show does not reset the clock; it is named instead.
      row(ids.nuria).find('[data-cy=recall-overdue]').should('contain.text', '6 weeks overdue')
      row(ids.nuria).find('[data-cy=recall-no-show]').should('contain.text', "Didn't come on")
      // Something booked ahead: not here.
      cy.get(`[data-cy=recall-row][data-patient-id="${ids.sergio}"]`).should('not.exist')
      // Dismissed, then came back and lapsed: back on their own.
      row(ids.marc).should('contain.text', 'Marc Puig')
      cy.get(`[data-cy=recall-row][data-patient-id="${ids.oscar}"]`).should('not.exist')

      // No phone: WhatsApp is off, and says why.
      row(ids.pablo).find('[data-cy=recall-whatsapp]').should('be.disabled')
      row(ids.pablo).find('[data-cy=recall-last-contact]').should('contain.text', 'No phone or email')
      row(ids.laura).find('[data-cy=recall-whatsapp]').should('not.be.disabled')
    })
  })

  it('logs a call, then snoozes it from the offer that follows, and brings it back', () => {
    seed().then(({ account, ids }) => {
      openRecalls(account)
      row(ids.laura).find('[data-cy=recall-log]').click()
      cy.get('[data-cy=recall-log-no-answer]').click()
      row(ids.laura).find('[data-cy=recall-last-contact]').should('contain.text', 'Called, no answer')

      // "Not contacted yet" now leaves her out.
      cy.get('[data-cy=recalls-not-contacted]').click()
      cy.get(`[data-cy=recall-row][data-patient-id="${ids.laura}"]`).should('not.exist')
      row(ids.elena).should('exist')
      cy.get('[data-cy=recalls-not-contacted]').click()

      cy.get('[data-cy=recall-follow-up]').should('contain.text', 'Laura Gómez')
      cy.get('[data-cy=recall-follow-up-2d]').click()
      cy.get(`[data-cy=recall-row][data-patient-id="${ids.laura}"]`).should('not.exist')
      cy.task<{ recall_snoozed_until: string | null }>('db:recallState', { patientId: ids.laura }).its('recall_snoozed_until').should('not.equal', null)

      cy.get('[data-cy=recalls-tab-snoozed]').should('contain.text', '1').click()
      cy.contains('[data-cy=parked-row]', 'Laura Gómez').within(() => {
        cy.get('[data-cy=parked-when]').should('contain.text', 'Back on')
        cy.get('[data-cy=parked-restore]').should('contain.text', 'Bring back now').click()
      })
      cy.get('[data-cy=parked-row]').should('not.exist')
      cy.task<{ recall_snoozed_until: string | null }>('db:recallState', { patientId: ids.laura }).then((s) => expect(s.recall_snoozed_until).to.equal(null))
      cy.get('[data-cy=recalls-tab-queue]').click()
      row(ids.laura).should('exist')
    })
  })

  it('snoozes to a chosen date from the dialog', () => {
    seed().then(({ account, ids }) => {
      openRecalls(account)
      row(ids.elena).find('[data-cy=recall-more]').click()
      cy.get('[data-cy=recall-snooze]').click()
      cy.get('[data-cy=confirm-dialog]').should('contain.text', 'Snooze Elena Castro')
      const until = new Date()
      until.setDate(until.getDate() + 40)
      const iso = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`
      cy.get('[data-cy=snooze-date]').clear().type(iso)
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get(`[data-cy=recall-row][data-patient-id="${ids.elena}"]`).should('not.exist')
      cy.task<{ recall_snoozed_until: string | null }>('db:recallState', { patientId: ids.elena }).its('recall_snoozed_until').should('equal', iso)
    })
  })

  it('dismisses with a way back, and restores', () => {
    seed().then(({ account, ids }) => {
      openRecalls(account)
      row(ids.elena).find('[data-cy=recall-more]').click()
      cy.get('[data-cy=recall-dismiss]').click()
      cy.get('[data-cy=confirm-dialog]').should('contain.text', 'Dismiss Elena Castro?').and('contain.text', 'they come back on their own')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get(`[data-cy=recall-row][data-patient-id="${ids.elena}"]`).should('not.exist')
      cy.task<{ recall_status: string; recall_dismissed_at: string | null }>('db:recallState', { patientId: ids.elena }).then((s) => {
        expect(s.recall_status).to.equal('dismissed')
        expect(s.recall_dismissed_at).to.not.equal(null)
      })

      // Óscar (seeded) and Elena are dismissed; Marc came back on his own.
      cy.get('[data-cy=recalls-tab-dismissed]').should('contain.text', '2').click()
      cy.get('[data-cy=parked-row]').should('have.length', 2)
      cy.contains('[data-cy=parked-row]', 'Elena Castro').find('[data-cy=parked-restore]').should('contain.text', 'Restore').click()
      cy.get('[data-cy=parked-row]').should('have.length', 1)
      cy.task<{ recall_status: string; recall_dismissed_at: string | null }>('db:recallState', { patientId: ids.elena }).then((s) => {
        expect(s.recall_status).to.equal('active')
        expect(s.recall_dismissed_at).to.equal(null)
      })
    })
  })

  it('marks priority, and sends WhatsApp in bulk only to those with a phone', () => {
    seed().then(({ account, ids }) => {
      openRecalls(account)
      row(ids.elena).find('[data-cy=recall-more]').click()
      cy.get('[data-cy=recall-priority-toggle]').click()
      row(ids.elena).find('[data-cy=recall-priority]').should('exist')
      cy.task<{ recall_priority: boolean }>('db:recallState', { patientId: ids.elena }).its('recall_priority').should('equal', true)

      row(ids.laura).find('input[type=checkbox]').check()
      row(ids.pablo).find('input[type=checkbox]').check()
      cy.get('[data-cy=recalls-bulk]').within(() => {
        cy.contains('2 selected')
        cy.get('[data-cy=recalls-bulk-whatsapp]').should('contain.text', 'WhatsApp to 1')
        cy.get('[data-cy=recalls-bulk-skipped]').should('contain.text', '1 without a phone, skipped')
      })
    })
  })
})
