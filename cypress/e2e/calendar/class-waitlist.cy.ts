import type { StaffAccount } from '../../support/commands'

// The waitlist for a full group class (20261015165454_class_waitlist.sql):
// joined online or at the desk, offered only that class's place when one is
// cancelled -- and a plain waitlist entry never is -- claimed into the class
// through the usual link, or given at the desk.
describe('Class waitlist', () => {
  type Seeded = { account: StaffAccount; typeId: string; sessionId: string; startsAt: string; placeId: string }
  // A class of one, two days off, already full.
  function fullClass(online = false): Cypress.Chainable<Seeded> {
    return cy.seedStaffAccount().then((account) => {
      if (online) cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      const startsAt = new Date(Date.now() + 2 * 86400_000)
      startsAt.setMinutes(0, 0, 0)
      return cy
        .task<{ id: string }[]>('db:insertRows', { table: 'appointment_types', rows: [{ account_id: account.accountId, name: 'Escuela de espalda', duration_minutes: 60, class_capacity: 4, online_booking_enabled: online }] })
        .then(([type]) =>
          cy
            .task<{ id: string }[]>('db:insertRows', {
              table: 'class_sessions',
              rows: [{ account_id: account.accountId, clinic_id: account.clinicId, appointment_type_id: type!.id, practitioner_id: account.teamMemberId, starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 3600_000).toISOString(), capacity: 1 }],
            })
            .then(([session]) =>
              cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Plaza' }).then((ana) =>
                cy
                  .task<{ id: string }[]>('db:insertRows', {
                    table: 'appointments',
                    rows: [{ account_id: account.accountId, clinic_id: account.clinicId, patient_id: ana.id, appointment_type_id: type!.id, practitioner_id: account.teamMemberId, starts_at: startsAt.toISOString(), ends_at: startsAt.toISOString(), class_session_id: session!.id }],
                  })
                  .then(([place]) => cy.wrap({ account, typeId: type!.id, sessionId: session!.id, startsAt: startsAt.toISOString(), placeId: place!.id })),
              ),
            ),
        )
    })
  }
  type Entry = { id: string; patient_id: string; status: string; claim_token: string | null; source: string; class_session_id: string | null; booked_appointment_id: string | null }
  const entries = (accountId: string) =>
    cy.task<Entry[]>('db:selectRows', { table: 'waitlist_entries', columns: 'id, patient_id, status, claim_token, source, class_session_id, booked_appointment_id', match: { account_id: accountId } })

  it('joins the waitlist online when the class is full', () => {
    fullClass(true).then(({ account, typeId, sessionId }) => {
      cy.visit(`/book/${account.accountSlug}?type=${typeId}`)
      cy.get('[data-cy=class-session-option]', { timeout: 20000 }).should('have.length', 1).and('contain', 'Completa').click()
      cy.get('[data-cy=class-waitlist-join]').should('contain', 'La clase está completa')
      cy.get('[data-cy=waitlist-first-name]').type('Rosa')
      cy.get('[data-cy=waitlist-last-name]').type('Espera')
      cy.get('[data-cy=waitlist-email]').type('rosa.espera@example.test')
      cy.get('[data-cy=waitlist-phone]').type('600111055')
      cy.get('[data-cy=waitlist-join]').click()
      cy.get('[data-cy=waitlist-position]').should('have.text', '1')
      entries(account.accountId).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]).to.include({ status: 'waiting', source: 'online', class_session_id: sessionId })
      })
    })
  })

  it('offers a cancelled place to the class queue only, and the link books it into the class', () => {
    fullClass().then(({ account, sessionId, placeId, startsAt }) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Beto', lastName: 'Clase' }).then((beto) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Carla', lastName: 'Suelta' }).then((carla) => {
          // Carla is on the ordinary waitlist, older than Beto's class entry:
          // she must not be offered a class's place.
          cy.task('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: carla.id, createdAt: new Date(Date.now() - 9 * 86400_000).toISOString() })
          cy.task('db:insertRows', { table: 'waitlist_entries', rows: [{ account_id: account.accountId, clinic_id: account.clinicId, patient_id: beto.id, status: 'waiting', class_session_id: sessionId }] })

          cy.task('db:updateRows', { table: 'appointments', values: { status: 'cancelled' }, match: { id: placeId } })
          cy.task<string>('db:accessTokenFor', { email: account.email, password: account.password }).then((token) => {
            cy.request({ method: 'POST', url: '/api/waitlist/offer-next', headers: { Authorization: `Bearer ${token}` }, body: { appointmentId: placeId } }).its('body').should('deep.eq', { offered: true, count: 1 })
          })
          entries(account.accountId).then((rows) => {
            const forBeto = rows.find((r) => r.patient_id === beto.id)!
            const forCarla = rows.find((r) => r.patient_id === carla.id)!
            expect(forBeto.status).to.eq('offered')
            expect(forCarla.status).to.eq('waiting')

            cy.request({ method: 'POST', url: `/api/waitlist/${forBeto.claim_token}` }).its('body.success').should('eq', true)
            cy.task<{ id: string; starts_at: string; source: string }[]>('db:selectRows', { table: 'appointments', columns: 'id, starts_at, source', match: { class_session_id: sessionId, patient_id: beto.id } }).then((places) => {
              expect(places).to.have.length(1)
              expect(places[0]!.source).to.eq('waitlist')
              expect(Date.parse(places[0]!.starts_at)).to.eq(Date.parse(startsAt))
            })
          })
        })
      })
    })
  })

  it('is kept at the desk: added from the class panel when full, and given the place when one frees', () => {
    cy.seedStaffAccount().then((account) => {
      // Earlier today, so the class is in today's view.
      const startsAt = new Date(Date.now() - 3600_000)
      if (startsAt.getDate() !== new Date().getDate()) startsAt.setTime(Date.now() - 60_000)
      cy.task<{ id: string }[]>('db:insertRows', { table: 'appointment_types', rows: [{ account_id: account.accountId, name: 'Pilates', duration_minutes: 60, class_capacity: 4 }] }).then(([type]) => {
        cy.task<{ id: string }[]>('db:insertRows', {
          table: 'class_sessions',
          rows: [{ account_id: account.accountId, clinic_id: account.clinicId, appointment_type_id: type!.id, practitioner_id: account.teamMemberId, starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 3600_000).toISOString(), capacity: 1 }],
        }).then(([session]) => {
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Plaza' }).then((ana) => {
            cy.task<{ id: string }[]>('db:insertRows', {
              table: 'appointments',
              rows: [{ account_id: account.accountId, clinic_id: account.clinicId, patient_id: ana.id, appointment_type_id: type!.id, practitioner_id: account.teamMemberId, starts_at: startsAt.toISOString(), ends_at: startsAt.toISOString(), class_session_id: session!.id }],
            }).then(([place]) => {
              cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Dora', lastName: 'Espera' })
              cy.login(account.email, account.password)
              cy.visit('/calendar')
              cy.get(`[data-cy=class-block][data-session-id=${session!.id}]`, { timeout: 20000 }).scrollIntoView().click({ force: true })
              cy.get('[data-cy=class-panel]').should('contain', 'Full')
              cy.get('[data-cy=class-add-search]').type('Dora')
              cy.get('[data-cy=class-add-result]').should('contain', 'Dora').click()
              cy.get('[data-cy=class-waiting][data-name="Dora Espera"]').should('exist')
              cy.get('[data-cy=class-waiting-give]').should('not.exist')

              // Ana's place is cancelled elsewhere; reopening shows a place to give.
              cy.task('db:updateRows', { table: 'appointments', values: { status: 'cancelled' }, match: { id: place!.id } })
              cy.get('[data-cy=class-panel] button[aria-label=Close]').click()
              cy.reload()
              cy.get(`[data-cy=class-block][data-session-id=${session!.id}]`, { timeout: 20000 }).should('contain', '0/1').scrollIntoView().click({ force: true })
              cy.get('[data-cy=class-waiting][data-name="Dora Espera"]').find('[data-cy=class-waiting-give]').click()
              cy.get('[data-cy=class-place][data-name="Dora Espera"]').should('exist')
              cy.get('[data-cy=class-waitlist]').should('not.exist')
              entries(account.accountId).then((rows) => {
                expect(rows).to.have.length(1)
                expect(rows[0]!.status).to.eq('booked')
                expect(rows[0]!.booked_appointment_id).to.be.a('string')
              })
            })
          })
        })
      })
    })
  })
})
