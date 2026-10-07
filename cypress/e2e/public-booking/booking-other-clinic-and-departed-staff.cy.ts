import { weekdayKeyOf } from '../../../utils/bookingSlots'
import { clinicDateOf, wallClockToUtc } from '../../../utils/clinicClock'

// Two ways online booking offered a practitioner who could not be booked
// (20260930160011_booking_other_clinic_and_departed_staff.sql).
//
// 1. A practitioner working at two clinics was shown free at one while booked
//    at the other: get_booking_busy_times and the public API's availability
//    only read appointments at the clinic being booked. The final clash check
//    is not clinic-scoped, so the patient chose the slot, filled everything in
//    and was then refused.
// 2. Somebody who has left was still listed on the booking page and could be
//    booked through it, and a patient could move their visit with them to a
//    new time. Leaving switches "Bookable online" off, but the switch stays on
//    the departed member's settings page and nothing stopped it being turned
//    back on.
const MADRID = 'Europe/Madrid'

function nextDay(day: string, fromDays = 2): string {
  for (let n = fromDays; n < fromDays + 8; n++) {
    const date = clinicDateOf(new Date(Date.now() + n * 86400000), MADRID)
    if (weekdayKeyOf(date) === day) return date
  }
  throw new Error(`no ${day} ahead`)
}
const at = (date: string, hhmm: string) => new Date(wallClockToUtc(date, hhmm, MADRID)).toISOString()

describe('Online booking: the other clinic, and staff who have left', () => {
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

  /** The practitioner's visit at their OTHER clinic, plus a cancelled and a deleted one that hold no time. */
  function bookAtOtherClinic(account: any, otherClinicId: string, date: string) {
    return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: otherClinicId, firstName: 'Norte', lastName: 'Privado' }).then((p) => {
      const visit = (hhmm: string, extra: Record<string, unknown> = {}) =>
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: otherClinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: at(date, hhmm), ...extra })
      visit('10:00')
      visit('12:00', { status: 'cancelled' })
      visit('13:00', { deletedAt: new Date().toISOString() })
    })
  }

  it('shows the practitioner busy while they are booked at their other clinic, and nothing but the times', () => {
    const tue = nextDay('tue')
    cy.get('@acct').then((account: any) => {
      cy.get<string>('@otherClinicId').then((otherClinicId) => {
        bookAtOtherClinic(account, otherClinicId, tue)
        // What the booking page and the app read to grey out a slot, as anon.
        cy.task<{ error: string | null; data: Record<string, unknown>[] | null }>('db:callRpcAsAnon', {
          fn: 'get_booking_busy_times',
          args: { p_clinic_id: account.clinicId, p_team_member_id: account.teamMemberId, p_from: at(tue, '00:00'), p_to: at(tue, '23:59') },
        }).then((r) => {
          expect(r.error).to.eq(null)
          expect(r.data, 'busy at the other clinic, not cancelled or deleted').to.have.length(1)
          expect(Object.keys(r.data![0]).sort(), 'no patient, no clinic, only the time').to.deep.eq(['ends_at', 'starts_at'])
          expect(new Date(r.data![0].starts_at as string).toISOString()).to.eq(at(tue, '10:00'))
        })
        cy.get('@type').then((type: any) => {
          cy.task<{ error: string | null }>('db:callPublicBookingAsAnon', {
            p_account_slug: account.accountSlug,
            p_clinic_id: account.clinicId,
            p_team_member_id: account.teamMemberId,
            p_appointment_type_id: type.id,
            p_starts_at: at(tue, '10:00'),
            p_first_name: 'Reserva',
            p_last_name: 'Online',
            p_email: `other-clinic-${Date.now()}@example.test`,
            p_phone: '600111222',
            p_country_code: 'ES',
            p_note: '',
          }).its('error').should('contain', 'no longer available')
        })
      })
    })
  })

  it("does not read another account's practitioner through a clinic that takes bookings", () => {
    const tue = nextDay('tue')
    cy.get('@acct').then((account: any) => {
      cy.seedStaffAccount().then((stranger: any) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: stranger.accountId, clinicId: stranger.clinicId, firstName: 'Ajeno' }).then((p) => {
          cy.task('db:createAppointment', { accountId: stranger.accountId, clinicId: stranger.clinicId, patientId: p.id, practitionerId: stranger.teamMemberId, startsAt: at(tue, '10:00') })
        })
        cy.task<{ error: string | null; data: unknown[] | null }>('db:callRpcAsAnon', {
          fn: 'get_booking_busy_times',
          args: { p_clinic_id: account.clinicId, p_team_member_id: stranger.teamMemberId, p_from: at(tue, '00:00'), p_to: at(tue, '23:59') },
        }).then((r) => {
          expect(r.error).to.eq(null)
          expect(r.data).to.have.length(0)
        })
      })
    })
  })

  it('leaves that time out of the public API availability as well', () => {
    const tue = nextDay('tue')
    cy.get('@acct').then((account: any) => {
      cy.get<string>('@otherClinicId').then((otherClinicId) => {
        bookAtOtherClinic(account, otherClinicId, tue)
        cy.get('@type').then((type: any) => {
          cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['appointments:read'] }).then(({ token }) => {
            cy.request({
              url: '/api/public/v1/availability',
              headers: { Authorization: `Bearer ${token}` },
              qs: { clinic_id: account.clinicId, appointment_type_id: type.id, practitioner_id: account.teamMemberId, from: tue, to: tue },
            }).then((res) => {
              const starts = res.body.data.days.flatMap((d: any) => d.slots.map((s: any) => s.starts_at))
              expect(starts, 'the practitioner is at the other clinic').not.to.include(at(tue, '10:00'))
              expect(starts, 'free again once that visit ends').to.include(at(tue, '10:30'))
              expect(starts, 'a cancelled visit holds nothing').to.include(at(tue, '12:00'))
              expect(starts, 'nor does a deleted one').to.include(at(tue, '13:00'))
            })
          })
        })
      })
    })
  })

  function formerColleague(account: any) {
    return cy.setExtraProfessionals(account.accountId, 3).then(() =>
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email: `antigua-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`,
        password: 'Test1234!',
        fullName: 'Antigua Fisio',
        isPractitioner: true,
      }),
    )
  }

  it('neither lists nor books somebody who has left, even with "Bookable online" switched back on', () => {
    cy.get('@acct').then((account: any) => {
      formerColleague(account).then((former) => {
        cy.task('db:setTeamMemberBookingFlags', { id: former.teamMemberId, deletedAt: new Date().toISOString() })
        // The toggle on a departed member's settings page, ticked again.
        cy.task('db:setTeamMemberBookingFlags', { id: former.teamMemberId, onlineBookingEnabled: true })
        cy.task<{ error: string | null; data: any }>('db:callRpcAsAnon', { fn: 'get_public_booking_info', args: { p_slug: account.accountSlug } }).then((r) => {
          expect(r.error).to.eq(null)
          const ids = r.data.team_members.map((m: any) => m.id)
          expect(ids, 'the practitioner still working there').to.include(account.teamMemberId)
          expect(ids, 'the one who has left').not.to.include(former.teamMemberId)
        })
        cy.get('@type').then((type: any) => {
          cy.task<{ error: string | null }>('db:callPublicBookingAsAnon', {
            p_account_slug: account.accountSlug,
            p_clinic_id: account.clinicId,
            p_team_member_id: former.teamMemberId,
            p_appointment_type_id: type.id,
            p_starts_at: at(nextDay('mon'), '10:00'),
            p_first_name: 'Reserva',
            p_last_name: 'Online',
            p_email: `former-${Date.now()}@example.test`,
            p_phone: '600111222',
            p_country_code: 'ES',
            p_note: '',
          }).its('error').should('contain', 'Practitioner not available')
        })
      })
    })
  })

  it('does not let a patient move their visit with somebody who has since left', () => {
    const email = `former-app-${Date.now()}@example.test`
    const password = 'Test1234!'
    cy.get('@acct').then((account: any) => {
      cy.get('@type').then((type: any) => {
        formerColleague(account).then((former) => {
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paciente', email }).then((p) => {
            cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: p.id, email, password })
            cy.task('db:setPatientAppReschedule', { accountId: account.accountId, enabled: true, noticeHours: 0 })
            cy.task<{ data: any; error: string | null }>('db:callRpcAsPatient', {
              email,
              password,
              fn: 'create_patient_booking',
              args: { p_clinic_id: account.clinicId, p_team_member_id: former.teamMemberId, p_appointment_type_id: type.id, p_starts_at: at(nextDay('tue'), '10:00'), p_note: '' },
            }).then((r) => {
              expect(r.error).to.eq(null)
              // They leave with the visit still on their calendar.
              cy.task('db:setTeamMemberBookingFlags', { id: former.teamMemberId, deletedAt: new Date().toISOString() })
              cy.task<{ data: any; error: string | null }>('db:callRpcAsPatient', {
                email,
                password,
                fn: 'reschedule_patient_appointment',
                args: { p_appointment_id: r.data.appointment_id, p_starts_at: at(nextDay('thu'), '10:00') },
              }).its('error').should('contain', 'Practitioner not available')
            })
          })
        })
      })
    })
  })
})
