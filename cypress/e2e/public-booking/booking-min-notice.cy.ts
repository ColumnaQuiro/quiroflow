import { weekdayKeyOf } from '../../../utils/bookingSlots'
import { clinicDateOf, wallClockToUtc } from '../../../utils/clinicClock'

// The least notice a patient must give to book online
// (accounts.online_booking_min_notice_hours,
// 20261123101508_online_booking_min_notice.sql). A clinic coming from
// PracticeHub had "nothing online less than 24 h ahead"; online booking
// offered the next free minute.
//
// 1. Set in Settings -> Online booking -> Rules.
// 2. The booking functions refuse a time inside it, for the public page and
//    the patient app; a time past it books as before.
// 3. Staff are not held to it.
const MADRID = 'Europe/Madrid'

function nextDay(day: string, fromDays = 2): string {
  for (let n = fromDays; n < fromDays + 8; n++) {
    const date = clinicDateOf(new Date(Date.now() + n * 86400000), MADRID)
    if (weekdayKeyOf(date) === day) return date
  }
  throw new Error(`no ${day} ahead`)
}
const at = (date: string, hhmm: string) => new Date(wallClockToUtc(date, hhmm, MADRID)).toISOString()

describe('Online booking minimum notice', () => {
  let stamp = 0
  function publicBooking(account: any, typeId: string, startsAt: string) {
    stamp += 1
    return cy.task<{ error: string | null; data: any }>('db:callPublicBookingAsAnon', {
      p_account_slug: account.accountSlug,
      p_clinic_id: account.clinicId,
      p_team_member_id: account.teamMemberId,
      p_appointment_type_id: typeId,
      p_starts_at: startsAt,
      p_first_name: 'Reserva',
      p_last_name: 'Antelación',
      p_email: `notice-${Date.now()}-${stamp}@example.test`,
      p_phone: '600111222',
      p_country_code: 'ES',
      p_note: '',
    })
  }
  const setNotice = (accountId: string, hours: number) =>
    cy.task('db:updateRows', { table: 'accounts', values: { online_booking_min_notice_hours: hours }, match: { id: accountId } })

  beforeEach(() => {
    cy.seedStaffAccount().as('acct')
    cy.get('@acct').then((account: any) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30, onlineBookingEnabled: true }).as('type')
    })
  })

  it('is set in Settings -> Online booking', () => {
    cy.get('@acct').then((account: any) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/online-booking')
      cy.get('[data-cy="booking-settings"][data-ready="true"]')
      cy.get('[data-cy="booking-min-notice"]').clear().type('24')
      cy.get('[data-cy="booking-save"]').click()
      cy.wait('@saveAccount').its('request.body.online_booking_min_notice_hours').should('eq', 24)
      cy.task<{ online_booking_min_notice_hours: number }[]>('db:selectRows', { table: 'accounts', columns: 'online_booking_min_notice_hours', match: { id: account.accountId } })
        .its('0.online_booking_min_notice_hours')
        .should('eq', 24)
      // What the booking page and the app read, as anon.
      cy.task<{ error: string | null; data: number | null }>('db:callRpcAsAnon', { fn: 'get_online_booking_min_notice', args: { p_clinic_id: account.clinicId } }).then((r) => {
        expect(r.error).to.eq(null)
        expect(r.data).to.eq(24)
      })
    })
  })

  it('refuses a time inside the notice on the public booking, and takes one past it', () => {
    cy.get('@acct').then((account: any) => {
      cy.get<{ id: string }>('@type').then((type) => {
        // Thirty days: the next Tuesday is inside it.
        setNotice(account.accountId, 720)
        publicBooking(account, type.id, at(nextDay('tue'), '10:00')).its('error').should('contain', 'too soon to book online')
        // A day: two days ahead at 10:00 is always past it.
        setNotice(account.accountId, 24)
        publicBooking(account, type.id, at(nextDay('tue'), '10:00')).its('error').should('eq', null)
        // The desk books inside it.
        setNotice(account.accountId, 720)
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Agenda' }).then((p) => {
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, appointmentTypeId: type.id, startsAt: at(nextDay('wed'), '12:00') })
        })
      })
    })
  })

  it('holds the patient app to it too', () => {
    const email = `notice-app-${Date.now()}@example.test`
    const password = 'Test1234!'
    cy.get('@acct').then((account: any) => {
      cy.get<{ id: string }>('@type').then((type) => {
        setNotice(account.accountId, 720)
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paciente', email }).then((p) => {
          cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: p.id, email, password })
          cy.task('db:callRpcAsPatient', {
            email,
            password,
            fn: 'create_patient_booking',
            args: { p_clinic_id: account.clinicId, p_team_member_id: account.teamMemberId, p_appointment_type_id: type.id, p_starts_at: at(nextDay('tue'), '10:00'), p_note: '' },
          })
            .its('error')
            .should('contain', 'too soon to book online')
        })
      })
    })
  })
})
