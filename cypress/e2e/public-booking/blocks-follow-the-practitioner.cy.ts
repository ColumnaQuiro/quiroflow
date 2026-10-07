import { weekdayKeyOf } from '../../../utils/bookingSlots'
import { clinicDateOf, wallClockToUtc } from '../../../utils/clinicClock'

// A practitioner who works at two clinics is one person, and their own blocked
// time is theirs wherever it was entered
// (20261003154500_blocks_follow_the_practitioner.sql).
//
// 1. A morning blocked off for them at their OTHER clinic did not block them
//    here: the booking page, the patient app, the public API and a waitlist
//    claim all read blocks for the clinic being booked only. A block for the
//    whole of the other clinic (a closure there) stays that clinic's own.
// 2. The public API offered, and booked, practitioners who do not work at the
//    clinic asked for at all -- every practitioner in the account.
// 3. "Bookable online" could be switched back on for somebody who has left.
const MADRID = 'Europe/Madrid'
const HOUR = 3600 * 1000

function nextDay(day: string, fromDays = 2): string {
  for (let n = fromDays; n < fromDays + 8; n++) {
    const date = clinicDateOf(new Date(Date.now() + n * 86400000), MADRID)
    if (weekdayKeyOf(date) === day) return date
  }
  throw new Error(`no ${day} ahead`)
}
const at = (date: string, hhmm: string) => new Date(wallClockToUtc(date, hhmm, MADRID)).toISOString()

describe('Blocked time follows the practitioner; the API books only who works there', () => {
  beforeEach(() => {
    cy.seedStaffAccount().as('acct')
    cy.get('@acct').then((account: any) => {
      // Monday to Friday, 08:00-19:00.
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consulta', durationMinutes: 30, onlineBookingEnabled: true }).as('type')
      cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Sede Norte' }).then((other) => {
        cy.task('db:linkTeamMemberToClinic', { teamMemberId: account.teamMemberId, clinicId: other.id })
        cy.wrap(other.id).as('otherClinicId')
      })
    })
  })

  /** At the OTHER clinic: the practitioner's own 10:00-11:00, and a closure of the whole clinic 12:00-13:00. */
  function blocksAtOtherClinic(account: any, otherClinicId: string, date: string) {
    cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: otherClinicId, practitionerId: account.teamMemberId, startsAt: at(date, '10:00'), endsAt: at(date, '11:00') })
    cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: otherClinicId, startsAt: at(date, '12:00'), endsAt: at(date, '13:00') })
  }

  function bookOnline(account: any, type: any, startsAt: string) {
    return cy.task<{ error: string | null }>('db:callPublicBookingAsAnon', {
      p_account_slug: account.accountSlug,
      p_clinic_id: account.clinicId,
      p_team_member_id: account.teamMemberId,
      p_appointment_type_id: type.id,
      p_starts_at: startsAt,
      p_first_name: 'Reserva',
      p_last_name: 'Online',
      p_email: `blocks-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`,
      p_phone: '600111222',
      p_country_code: 'ES',
      p_note: '',
    })
  }

  it('keeps the practitioner off the booking page here while they are blocked at their other clinic', () => {
    const tue = nextDay('tue')
    cy.get('@acct').then((account: any) => {
      cy.get<string>('@otherClinicId').then((otherClinicId) => {
        blocksAtOtherClinic(account, otherClinicId, tue)
        // What the booking page and the app read, as anon.
        cy.task<{ error: string | null; data: { starts_at: string; practitioner_id: string | null }[] | null }>('db:callRpcAsAnon', {
          fn: 'get_booking_blocked_times',
          args: { p_clinic_id: account.clinicId, p_from: at(tue, '00:00'), p_to: at(tue, '23:59') },
        }).then((r) => {
          expect(r.error).to.eq(null)
          expect(r.data, 'their own block there, not the other clinic’s closure').to.have.length(1)
          expect(r.data![0].practitioner_id).to.eq(account.teamMemberId)
          expect(new Date(r.data![0].starts_at).toISOString()).to.eq(at(tue, '10:00'))
        })
        cy.get('@type').then((type: any) => {
          bookOnline(account, type, at(tue, '10:00')).its('error').should('contain', 'not available for booking')
          bookOnline(account, type, at(tue, '12:00')).its('error').should('eq', null)
        })
      })
    })
  })

  it('leaves that time out of the public API availability as well', () => {
    const tue = nextDay('tue')
    cy.get('@acct').then((account: any) => {
      cy.get<string>('@otherClinicId').then((otherClinicId) => {
        blocksAtOtherClinic(account, otherClinicId, tue)
        cy.get('@type').then((type: any) => {
          cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['appointments:read'] }).then(({ token }) => {
            cy.request({
              url: '/api/public/v1/availability',
              headers: { Authorization: `Bearer ${token}` },
              qs: { clinic_id: account.clinicId, appointment_type_id: type.id, practitioner_id: account.teamMemberId, from: tue, to: tue },
            }).then((res) => {
              const starts = res.body.data.days.flatMap((d: any) => d.slots.map((s: any) => s.starts_at))
              expect(starts, 'blocked at the other clinic').not.to.include(at(tue, '10:00'))
              expect(starts, 'still blocked at half past').not.to.include(at(tue, '10:30'))
              expect(starts, 'free once the block ends').to.include(at(tue, '11:00'))
              expect(starts, 'the other clinic’s closure is not this one’s').to.include(at(tue, '12:00'))
            })
          })
        })
      })
    })
  })

  it('refuses a waitlist claim on time the practitioner has blocked off at their other clinic', () => {
    cy.get('@acct').then((account: any) => {
      cy.get<string>('@otherClinicId').then((otherClinicId) => {
        const start = new Date(Date.now() + 3 * 24 * HOUR)
        start.setUTCHours(10, 0, 0, 0)
        const s = { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 60000).toISOString() }
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Espera', lastName: 'Norte' }).then((waiting) => {
          cy.task<{ id: string }>('db:createWaitlistEntry', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: waiting.id,
            status: 'offered',
            offered: { startsAt: s.startsAt, endsAt: s.endsAt, roomId: null, practitionerId: account.teamMemberId, expiresAt: new Date(Date.now() + 2 * HOUR).toISOString() },
          }).then((entry) => {
            cy.task<{ claim_token: string }[]>('db:selectRows', { table: 'waitlist_entries', columns: 'claim_token', match: { id: entry.id } }).then((rows) => {
              cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: otherClinicId, practitionerId: account.teamMemberId, startsAt: s.startsAt, endsAt: s.endsAt })
              cy.request({ method: 'POST', url: `/api/waitlist/${rows[0]!.claim_token}`, failOnStatusCode: false }).its('status').should('eq', 409)
              cy.task<unknown[]>('db:selectRows', { table: 'appointments', columns: 'id', match: { patient_id: waiting.id } }).should('have.length', 0)
            })
          })
        })
      })
    })
  })

  it('offers and books through the API only practitioners who work at the clinic', () => {
    const tue = nextDay('tue')
    cy.get('@acct').then((account: any) => {
      cy.get<string>('@otherClinicId').then((otherClinicId) => {
        cy.setExtraProfessionals(account.accountId, 3)
        // Works only at the other clinic.
        cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
          accountId: account.accountId,
          clinicId: otherClinicId,
          roleName: 'Practitioner',
          email: `norte-${Date.now()}@example.test`,
          password: 'Test1234!',
          fullName: 'Nora Norte',
          isPractitioner: true,
        }).then((norte) => {
          cy.get('@type').then((type: any) => {
            cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['appointments:read', 'appointments:write'] }).then(({ token }) => {
              const headers = { Authorization: `Bearer ${token}` }
              cy.request({ url: '/api/public/v1/availability', headers, qs: { clinic_id: account.clinicId, appointment_type_id: type.id, from: tue, to: tue } }).then((res) => {
                const listed = res.body.data.practitioners.map((p: any) => p.id)
                expect(listed, 'works here').to.include(account.teamMemberId)
                expect(listed, 'works only at the other clinic').not.to.include(norte.teamMemberId)
                const slotOwners = new Set(res.body.data.days.flatMap((d: any) => d.slots.map((s: any) => s.practitioner_id)))
                expect([...slotOwners]).not.to.include(norte.teamMemberId)
              })
              cy.request({
                url: '/api/public/v1/availability',
                headers,
                qs: { clinic_id: account.clinicId, appointment_type_id: type.id, practitioner_id: norte.teamMemberId, from: tue, to: tue },
                failOnStatusCode: false,
              }).then((res) => {
                expect(res.status).to.eq(400)
                expect(JSON.stringify(res.body)).to.contain('practitioner_id')
              })
              // ...and at the clinic they do work at, they are there.
              cy.request({ url: '/api/public/v1/availability', headers, qs: { clinic_id: otherClinicId, appointment_type_id: type.id, from: tue, to: tue } })
                .its('body.data.practitioners')
                .then((ps: any[]) => expect(ps.map((p) => p.id)).to.include(norte.teamMemberId))

              cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Api', lastName: 'Sede' }).then((p) => {
                cy.request({
                  method: 'POST',
                  url: '/api/public/v1/appointments',
                  headers,
                  body: { patient_id: p.id, clinic_id: account.clinicId, practitioner_id: norte.teamMemberId, appointment_type_id: type.id, starts_at: at(tue, '10:00') },
                  failOnStatusCode: false,
                }).then((res) => {
                  expect(res.status).to.eq(400)
                  expect(res.body.error.field).to.eq('practitioner_id')
                })
                cy.task<unknown[]>('db:selectRows', { table: 'appointments', columns: 'id', match: { patient_id: p.id } }).should('have.length', 0)

                // Handing an existing visit here to them is refused the same way.
                cy.request({
                  method: 'POST',
                  url: '/api/public/v1/appointments',
                  headers,
                  body: { patient_id: p.id, clinic_id: account.clinicId, practitioner_id: account.teamMemberId, appointment_type_id: type.id, starts_at: at(tue, '11:00') },
                }).then((created) => {
                  expect(created.status).to.eq(201)
                  cy.request({
                    method: 'PATCH',
                    url: `/api/public/v1/appointments/${created.body.data.id}`,
                    headers,
                    body: { practitioner_id: norte.teamMemberId },
                    failOnStatusCode: false,
                  }).then((res) => {
                    expect(res.status).to.eq(400)
                    expect(res.body.error.field).to.eq('practitioner_id')
                  })
                  cy.task<{ practitioner_id: string }>('db:appointmentById', { appointmentId: created.body.data.id }).its('practitioner_id').should('eq', account.teamMemberId)
                })
              })
            })
          })
        })
      })
    })
  })

  it('cannot make somebody who has left bookable online again, from any client', () => {
    cy.get('@acct').then((account: any) => {
      cy.setExtraProfessionals(account.accountId, 3)
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email: `ida-${Date.now()}@example.test`,
        password: 'Test1234!',
        fullName: 'Ida Sevaya',
        isPractitioner: true,
      }).then((former) => {
        cy.task('db:setTeamMemberBookingFlags', { id: former.teamMemberId, deletedAt: new Date().toISOString() })
        cy.task('db:setTeamMemberBookingFlags', { id: former.teamMemberId, onlineBookingEnabled: true })
        cy.task<any>('db:teamMemberDetail', { teamMemberId: former.teamMemberId }).its('online_booking_enabled').should('eq', false)
        // Back on the team, it is theirs to switch on again.
        cy.task('db:setTeamMemberBookingFlags', { id: former.teamMemberId, deletedAt: null })
        cy.task('db:setTeamMemberBookingFlags', { id: former.teamMemberId, onlineBookingEnabled: true })
        cy.task<any>('db:teamMemberDetail', { teamMemberId: former.teamMemberId }).its('online_booking_enabled').should('eq', true)
      })
    })
  })
})
