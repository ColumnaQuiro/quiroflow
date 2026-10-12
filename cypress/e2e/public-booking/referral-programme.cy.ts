// The referral programme: a patient's own link to the booking page
// (my_referral_code), a newcomer booking through it recorded as referred by
// them (server/utils/bookingReferral.ts, via /api/public-booking/attribution),
// and the clinic marking the referrer's reward in Reports > Referrals.
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

describe('Referral programme', () => {
  it('a patient shares their link, a newcomer books with it, the clinic marks the reward', () => {
    const email = `referrer-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateRows', { table: 'accounts', values: { referral_program_enabled: true, referral_reward_text: 'Una sesión gratis' }, match: { id: account.accountId } })
      cy.task<{ slug: string }[]>('db:selectRows', { table: 'accounts', columns: 'slug', match: { id: account.accountId } }).then(([acc]) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Recomienda' }).then((referrer) => {
          cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: referrer.id, email, password })

          // Their link, on the portal home.
          cy.login(email, password)
          cy.visit('/portal')
          cy.get('[data-cy=patient-referral]').should('contain.text', 'Una sesión gratis')
          cy.get('[data-cy=patient-referral-link]').invoke('text').should('match', new RegExp(`/book/${acc!.slug}\\?ref=[A-Z2-9]{6}$`))
          cy.task<{ data: { code: string } }>('db:callRpcAs', { email, password, fn: 'my_referral_code', args: { p_patient_id: referrer.id } }).its('data.code').then((code) => {
            // A newcomer books online with it.
            cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bea', lastName: 'Nueva' }).then((friend) => {
              cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: friend.id, practitionerId: account.teamMemberId, startsAt: inDays(3), source: 'online' }).then((appt) => {
                cy.request({ method: 'POST', url: '/api/public-booking/attribution', body: { accountSlug: acc!.slug, appointmentId: appt.id, params: { ref: code } } }).its('body.referred').should('eq', true)
                cy.task<{ referred_by_patient_id: string | null }[]>('db:selectRows', { table: 'patients', columns: 'referred_by_patient_id', match: { id: friend.id } }).its('0.referred_by_patient_id').should('eq', referrer.id)
                // The same link again changes nothing.
                cy.request({ method: 'POST', url: '/api/public-booking/attribution', body: { accountSlug: acc!.slug, appointmentId: appt.id, params: { ref: code } } }).its('body.referred').should('eq', false)

                // Not for someone who has been before.
                cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Leo', lastName: 'Habitual' }).then((regular) => {
                  cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: regular.id, practitionerId: account.teamMemberId, startsAt: inDays(-30), status: 'completed' })
                  cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: regular.id, practitionerId: account.teamMemberId, startsAt: inDays(4), source: 'online' }).then((again) => {
                    cy.request({ method: 'POST', url: '/api/public-booking/attribution', body: { accountSlug: acc!.slug, appointmentId: again.id, params: { ref: code } } }).its('body.referred').should('eq', false)
                  })
                })

                // The friend comes; the clinic gives the reward and marks it.
                cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: friend.id, practitionerId: account.teamMemberId, startsAt: inDays(-1), status: 'completed' })
                cy.login(account.email, account.password)
                cy.visit('/reports/referrals')
                cy.get('[data-cy=referrals]').should('have.attr', 'data-ready', 'true')
                cy.get('[data-cy=referrals-row]').should('have.length', 1).and('contain.text', 'Ana Recomienda').and('contain.text', 'Bea Nueva')
                cy.get('[data-cy=referrals-owed]').should('have.text', '1')
                cy.get('[data-cy=referrals-mark]').click()
                cy.get('[data-cy=referrals-row]').should('contain.text', 'Given')
                cy.task<{ referral_rewarded_at: string | null }[]>('db:selectRows', { table: 'patients', columns: 'referral_rewarded_at', match: { id: friend.id } }).its('0.referral_rewarded_at').should('not.be.null')
              })
            })
          })
        })
      })
    })
  })

  it('shows patients nothing while the clinic has it off', () => {
    const email = `referrer-off-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Apagado' }).then((p) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: p.id, email, password })
        cy.task<{ data: { enabled: boolean } }>('db:callRpcAs', { email, password, fn: 'my_referral_code', args: { p_patient_id: p.id } }).its('data.enabled').should('eq', false)
        cy.login(email, password)
        cy.visit('/portal')
        cy.contains('Your next visit').should('be.visible')
        cy.get('[data-cy=patient-referral]').should('not.exist')
      })
    })
  })
})
