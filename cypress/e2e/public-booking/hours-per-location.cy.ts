import { weekdayKeyOf } from '../../../utils/bookingSlots'
import { clinicDateOf, wallClockToUtc } from '../../../utils/clinicClock'

// A practitioner's hours at each location they work at
// (20261119124321_hours_per_location.sql, utils/businessHours.ts
// practitionerHoursAt).
//
// Somebody had one week wherever they were. A chiropractor at the clinic all
// week and at a gym on Tuesday evenings was offered at the gym every morning
// of the week: tried on 19 Nov 2026, a location open Tue/Thu 17:00-20:00
// offered Wednesday 09:00.
//
// 1. With a week set for the gym, they are booked there only inside it.
// 2. That time comes out of their hours at the clinic by itself.
// 3. The public API's availability agrees with what booking accepts.
// 4. Settings -> Team is where the week is set.
const MADRID = 'Europe/Madrid'

function nextDay(day: string, fromDays = 2): string {
  for (let n = fromDays; n < fromDays + 8; n++) {
    const date = clinicDateOf(new Date(Date.now() + n * 86400000), MADRID)
    if (weekdayKeyOf(date) === day) return date
  }
  throw new Error(`no ${day} ahead`)
}
const at = (date: string, hhmm: string) => new Date(wallClockToUtc(date, hhmm, MADRID)).toISOString()

describe('Hours per location', () => {
  beforeEach(() => {
    cy.seedStaffAccount().as('acct')
    cy.get('@acct').then((account: any) => {
      // Both locations: Monday to Friday, 08:00-19:00.
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consulta', durationMinutes: 30, onlineBookingEnabled: true }).as('type')
      cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Box Norte' }).then((gym) => {
        cy.task('db:enableOnlineBooking', { clinicId: gym.id })
        cy.wrap(gym.id).as('gymId')
      })
    })
  })

  /** At the gym on Tuesdays, 17:00-19:00, and nothing said about the clinic. */
  function worksTuesdayEveningsAtTheGym(account: any, gymId: string) {
    cy.task('db:linkTeamMemberToClinic', { teamMemberId: account.teamMemberId, clinicId: gymId, businessHours: { tue: [['17:00', '19:00']] } })
  }

  function bookOnline(account: any, clinicId: string, type: any, startsAt: string) {
    return cy.task<{ error: string | null }>('db:callPublicBookingAsAnon', {
      p_account_slug: account.accountSlug,
      p_clinic_id: clinicId,
      p_team_member_id: account.teamMemberId,
      p_appointment_type_id: type.id,
      p_starts_at: startsAt,
      p_first_name: 'Reserva',
      p_last_name: 'Online',
      p_email: `sedes-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`,
      p_phone: '600111222',
      p_country_code: 'ES',
      p_note: '',
    })
  }

  it('books them at the second location only in the week set for it, and not at the clinic meanwhile', () => {
    const tue = nextDay('tue')
    const wed = nextDay('wed')
    cy.get('@acct').then((account: any) => {
      cy.get<string>('@gymId').then((gymId) => {
        worksTuesdayEveningsAtTheGym(account, gymId)
        cy.get('@type').then((type: any) => {
          // The gym is open on Wednesday morning; they are not there.
          bookOnline(account, gymId, type, at(wed, '10:00')).its('error').should('contain', 'not available for booking')
          bookOnline(account, gymId, type, at(tue, '10:00')).its('error').should('contain', 'not available for booking')
          bookOnline(account, gymId, type, at(tue, '17:00')).its('error').should('eq', null)
          // At the clinic that evening is the gym's, with nothing booked in it.
          bookOnline(account, account.clinicId, type, at(tue, '18:00')).its('error').should('contain', 'not available for booking')
          // Ends as the gym starts: theirs to give.
          bookOnline(account, account.clinicId, type, at(tue, '16:30')).its('error').should('eq', null)
          bookOnline(account, account.clinicId, type, at(wed, '18:00')).its('error').should('eq', null)
        })
      })
    })
  })

  it('books somebody with no week per location exactly as before', () => {
    const wed = nextDay('wed')
    cy.get('@acct').then((account: any) => {
      cy.get<string>('@gymId').then((gymId) => {
        cy.task('db:linkTeamMemberToClinic', { teamMemberId: account.teamMemberId, clinicId: gymId })
        cy.get('@type').then((type: any) => {
          bookOnline(account, gymId, type, at(wed, '10:00')).its('error').should('eq', null)
          bookOnline(account, account.clinicId, type, at(wed, '18:00')).its('error').should('eq', null)
        })
      })
    })
  })

  it('offers the same through the public API and to the booking page', () => {
    const tue = nextDay('tue')
    const wed = nextDay('wed')
    cy.get('@acct').then((account: any) => {
      cy.get<string>('@gymId').then((gymId) => {
        worksTuesdayEveningsAtTheGym(account, gymId)
        cy.get('@type').then((type: any) => {
          cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['appointments:read'] }).then(({ token }) => {
            const starts = (clinicId: string) =>
              cy
                .request({ url: '/api/public/v1/availability', headers: { Authorization: `Bearer ${token}` }, qs: { clinic_id: clinicId, appointment_type_id: type.id, practitioner_id: account.teamMemberId, from: tue, to: wed } })
                .then((res) => res.body.data.days.flatMap((d: any) => d.slots.map((s: any) => s.starts_at)) as string[])
            starts(gymId).then((gym) => {
              expect(gym, 'the gym: Tuesday evening and nothing else').to.deep.eq([at(tue, '17:00'), at(tue, '17:30'), at(tue, '18:00'), at(tue, '18:30')])
            })
            starts(account.clinicId).then((clinic) => {
              expect(clinic, 'the clinic that morning').to.include(at(tue, '10:00'))
              expect(clinic, 'up to the gym').to.include(at(tue, '16:30'))
              expect(clinic, 'not while they are at the gym').not.to.include(at(tue, '17:00'))
              expect(clinic, 'nor later that evening').not.to.include(at(tue, '18:30'))
              expect(clinic, 'Wednesday evening is the clinic’s').to.include(at(wed, '18:00'))
            })
          })
        })
        // What the booking page asks for beside get_public_booking_info, as anon.
        cy.task<{ error: string | null; data: { team_member_id: string; clinic_id: string; business_hours: Record<string, [string, string][]> }[] | null }>('db:callRpcAsAnon', {
          fn: 'get_practitioner_location_hours',
          args: { p_team_member_ids: [account.teamMemberId] },
        }).then((r) => {
          expect(r.error).to.eq(null)
          expect(r.data, 'only the location with a week of its own').to.have.length(1)
          expect(r.data![0].clinic_id).to.eq(gymId)
          expect(r.data![0].business_hours).to.deep.eq({ tue: [['17:00', '19:00']] })
        })
      })
    })
  })

  it('is set per location in Settings -> Team, and taken away again', () => {
    cy.get('@acct').then((account: any) => {
      cy.get<string>('@gymId').then((gymId) => {
        cy.task('db:linkTeamMemberToClinic', { teamMemberId: account.teamMemberId, clinicId: gymId })
        cy.login(account.email, account.password)
        cy.visit(`/settings/team/${account.teamMemberId}`)
        cy.get('[data-cy=member-page]', { timeout: 20000 }).should('have.attr', 'data-ready', 'true')

        cy.get('[data-cy=member-location]').should('have.length', 2)
        cy.contains('[data-cy=member-location]', 'Box Norte').within(() => {
          cy.get('[data-cy=member-location-set]').click()
          cy.get('[data-cy=hours-not-set]').should('be.visible')
          cy.get('[data-cy=hours-day-toggle]').eq(1).click()
          cy.get('[data-cy=hours-range]').should('have.length', 1)
        })
        cy.get('[data-cy=member-save]').click()
        cy.get('[data-cy=member-save-bar]').should('not.exist')
        cy.task<{ businessHours: Record<string, [string, string][]> | null }>('db:teamMemberLocationHours', { teamMemberId: account.teamMemberId, clinicId: gymId }).then(({ businessHours }) => {
          expect(Object.keys(businessHours ?? {}).filter((d) => (businessHours ?? {})[d].length > 0), 'Tuesday, and only there').to.deep.eq(['tue'])
        })
        cy.task<{ businessHours: unknown }>('db:teamMemberLocationHours', { teamMemberId: account.teamMemberId, clinicId: account.clinicId }).its('businessHours').should('eq', null)

        cy.contains('[data-cy=member-location]', 'Box Norte').find('[data-cy=member-location-clear]').click()
        cy.get('[data-cy=member-save]').click()
        cy.get('[data-cy=member-save-bar]').should('not.exist')
        cy.task<{ businessHours: unknown }>('db:teamMemberLocationHours', { teamMemberId: account.teamMemberId, clinicId: gymId }).its('businessHours').should('eq', null)
      })
    })
  })
})
