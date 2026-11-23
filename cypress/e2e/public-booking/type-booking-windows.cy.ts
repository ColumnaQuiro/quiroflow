import { weekdayKeyOf } from '../../../utils/bookingSlots'
import { clinicDateOf, wallClock, wallClockToUtc } from '../../../utils/clinicClock'

// The times an appointment type can be booked online
// (appointment_types.online_booking_windows,
// 20261122184746_appointment_type_booking_windows.sql) -- PracticeHub's
// "special" slots: a free first assessment for people from an ad, offered only
// at set half-hours rather than in every free slot of the morning.
//
// 1. Set in Settings -> Appointment types.
// 2. The booking page offers the type only inside its windows, and books one.
// 3. The booking functions refuse a time outside them however they are
//    called -- the page is not the only caller -- for the public page, the
//    patient app booking and moving, and a practitioner's own times.
// 4. Staff and other types are not restricted.
const MADRID = 'Europe/Madrid'

function nextDay(day: string, fromDays = 2): string {
  for (let n = fromDays; n < fromDays + 8; n++) {
    const date = clinicDateOf(new Date(Date.now() + n * 86400000), MADRID)
    if (weekdayKeyOf(date) === day) return date
  }
  throw new Error(`no ${day} ahead`)
}
const at = (date: string, hhmm: string) => new Date(wallClockToUtc(date, hhmm, MADRID)).toISOString()

// Monday to Thursday, 10:00-11:00. The clinic is open Monday to Friday
// 08:00-19:00 (db:enableOnlineBooking), so Friday is shut to this type by its
// windows alone.
const TEN_TO_ELEVEN = [['10:00', '11:00']]
const WINDOWS = { all: { mon: TEN_TO_ELEVEN, tue: TEN_TO_ELEVEN, wed: TEN_TO_ELEVEN, thu: TEN_TO_ELEVEN, fri: [], sat: [], sun: [] } }

describe('Online booking windows per appointment type', () => {
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
      p_last_name: 'Ventana',
      p_email: `windows-${Date.now()}-${stamp}@example.test`,
      p_phone: '600111222',
      p_country_code: 'ES',
      p_note: '',
    })
  }
  const setWindows = (typeId: string, windows: unknown) => cy.task('db:updateRows', { table: 'appointment_types', values: { online_booking_windows: windows }, match: { id: typeId } })

  beforeEach(() => {
    cy.seedStaffAccount().as('acct')
    cy.get('@acct').then((account: any) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Valoración gratuita', durationMinutes: 30, onlineBookingEnabled: true }).as('windowed')
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30, onlineBookingEnabled: true }).as('open')
    })
  })

  it('is set in Settings -> Appointment types, and taken away again', () => {
    cy.get('@acct').then((account: any) => {
      cy.get<{ id: string }>('@windowed').then((type) => {
        cy.login(account.email, account.password)
        cy.visit(`/settings/appointment-types/${type.id}`)
        cy.get('[data-cy=type-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=type-windows-none]').scrollIntoView().should('be.visible')
        cy.get('[data-cy=type-windows-set]').click()
        cy.get('[data-cy=type-windows]').within(() => {
          cy.get('[data-cy=hours-not-set]').scrollIntoView().should('be.visible')
          // Tuesday on: the editor's default range, then narrowed to 10:00-11:00.
          cy.get('[data-cy=hours-day][data-day=tue] [data-cy=hours-day-toggle]').first().click()
          cy.get('[data-cy=hours-day][data-day=tue] [data-cy=hours-range] input[type=time]').first().invoke('val', '10:00').trigger('input')
          cy.get('[data-cy=hours-day][data-day=tue] [data-cy=hours-range] input[type=time]').eq(1).invoke('val', '11:00').trigger('input')
        })
        cy.contains('button', 'Save').click()
        cy.contains(/^Saved$/).should('be.visible')
        cy.task<{ row: { online_booking_windows: any } | null }>('db:appointmentTypeRow', { id: type.id }).then(({ row }) => {
          expect(row!.online_booking_windows.all.tue).to.deep.eq([['10:00', '11:00']])
          expect(row!.online_booking_windows.all.mon).to.deep.eq([])
          expect(row!.online_booking_windows, 'nobody has times of their own').not.to.have.property('practitioners')
        })

        cy.reload()
        cy.get('[data-cy=type-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=type-windows-clear]').click()
        cy.get('[data-cy=type-windows-none]').scrollIntoView().should('be.visible')
        cy.contains('button', 'Save').click()
        cy.contains(/^Saved$/).should('be.visible')
        cy.task<{ row: { online_booking_windows: unknown } | null }>('db:appointmentTypeRow', { id: type.id }).its('row.online_booking_windows').should('eq', null)
      })
    })
  })

  it('offers it on the booking page only inside its windows, and books one', () => {
    cy.get('@acct').then((account: any) => {
      cy.get<{ id: string }>('@windowed').then((type) => {
        setWindows(type.id, WINDOWS)
        // The link an ad or a lead message sends: the same page, with the type fixed.
        cy.visit(`/book/${account.accountSlug}?type=${type.id}`)
        cy.contains('Elija su fecha y hora').should('be.visible')
        cy.get('.grid.grid-cols-7 button:not([disabled])')
          .should('have.length.greaterThan', 0)
          .each(($day) => {
            expect($day.attr('aria-label'), 'no Friday: open, but not for this type').not.to.match(/^viernes/)
          })
        // The furthest day on show: nothing booked, and not today.
        cy.get('.grid.grid-cols-7 button:not([disabled])').last().click()
        cy.get('[data-cy=booking-slot]').then(($slots) => {
          expect([...$slots].map((s) => s.textContent?.trim()), 'only its window').to.deep.eq(['10:00', '10:30'])
        })
        cy.contains('[data-cy=booking-slot]', '10:30').click()
        cy.get('[data-cy=booking-continue]:visible').click()
        cy.contains('Introduzca sus datos').should('be.visible')
        cy.contains('label', 'Nombre *').parent().find('input').type('Ventana')
        cy.contains('label', 'Correo electrónico *').parent().find('input').type(`ventana-${Date.now()}@example.test`)
        cy.contains('label', 'Número de móvil *').parent().find('input[type="tel"]').type('600111555')
        cy.contains('button', 'Reservar cita').click()
        cy.contains('¡Cita reservada!', { timeout: 15000 }).should('be.visible')
        cy.task<{ starts_at: string }[]>('db:selectRows', { table: 'appointments', columns: 'starts_at', match: { account_id: account.accountId } }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(wallClock(new Date(rows[0].starts_at), MADRID)).to.include({ hour: 10, minute: 30 })
        })

        // What the page reads beside get_public_booking_info, as anon.
        cy.task<{ error: string | null; data: { appointment_type_id: string; online_booking_windows: any }[] | null }>('db:callRpcAsAnon', {
          fn: 'get_appointment_type_booking_windows',
          args: { p_type_ids: [type.id] },
        }).then((r) => {
          expect(r.error).to.eq(null)
          expect(r.data).to.have.length(1)
          expect(r.data![0].online_booking_windows.all.tue).to.deep.eq(TEN_TO_ELEVEN)
        })
      })
    })
  })

  it('refuses a time outside its windows, however the booking function is called', () => {
    cy.get('@acct').then((account: any) => {
      cy.get<{ id: string }>('@windowed').then((type) => {
        setWindows(type.id, WINDOWS)
        const tue = nextDay('tue')
        publicBooking(account, type.id, at(tue, '12:00')).its('error').should('contain', 'not available for booking')
        publicBooking(account, type.id, at(nextDay('fri'), '10:00')).its('error').should('contain', 'not available for booking')
        // Starts inside, ends outside: the whole visit has to fit.
        publicBooking(account, type.id, at(tue, '10:45')).its('error').should('contain', 'not available for booking')
        publicBooking(account, type.id, at(tue, '10:30')).its('error').should('eq', null)
        // A type without windows is offered whenever they are free, as before.
        cy.get<{ id: string }>('@open').then((open) => {
          publicBooking(account, open.id, at(tue, '12:00')).its('error').should('eq', null)
        })
        // The desk books the type at any time.
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Agenda' }).then((p) => {
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, appointmentTypeId: type.id, startsAt: at(nextDay('fri'), '15:00') })
        })
      })
    })
  })

  it("holds a practitioner to their own times in place of everyone's", () => {
    cy.get('@acct').then((account: any) => {
      cy.get<{ id: string }>('@windowed').then((type) => {
        setWindows(type.id, { ...WINDOWS, practitioners: { [account.teamMemberId]: { wed: [['17:00', '18:00']] } } })
        publicBooking(account, type.id, at(nextDay('tue'), '10:00')).its('error').should('contain', 'not available for booking')
        publicBooking(account, type.id, at(nextDay('wed'), '10:00')).its('error').should('contain', 'not available for booking')
        publicBooking(account, type.id, at(nextDay('wed'), '17:00')).its('error').should('eq', null)
      })
    })
  })

  it('holds the patient app to the same windows, booking and moving', () => {
    const email = `windows-app-${Date.now()}@example.test`
    const password = 'Test1234!'
    cy.get('@acct').then((account: any) => {
      cy.get<{ id: string }>('@windowed').then((type) => {
        setWindows(type.id, WINDOWS)
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paciente', email }).then((p) => {
          cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: p.id, email, password })
          cy.task('db:setPatientAppReschedule', { accountId: account.accountId, enabled: true, noticeHours: 0 })
          const book = (startsAt: string) =>
            cy.task<{ data: any; error: string | null }>('db:callRpcAsPatient', {
              email,
              password,
              fn: 'create_patient_booking',
              args: { p_clinic_id: account.clinicId, p_team_member_id: account.teamMemberId, p_appointment_type_id: type.id, p_starts_at: startsAt, p_note: '' },
            })
          book(at(nextDay('tue'), '15:00')).its('error').should('contain', 'not available for booking')
          book(at(nextDay('tue'), '10:00')).then((r) => {
            expect(r.error).to.eq(null)
            const move = (startsAt: string) =>
              cy.task<{ data: any; error: string | null }>('db:callRpcAsPatient', { email, password, fn: 'reschedule_patient_appointment', args: { p_appointment_id: r.data.appointment_id, p_starts_at: startsAt } })
            move(at(nextDay('fri'), '10:00')).its('error').should('contain', 'not available for booking')
            move(at(nextDay('thu'), '16:00')).its('error').should('contain', 'not available for booking')
            move(at(nextDay('thu'), '10:30')).its('error').should('eq', null)
          })
        })
      })
    })
  })
})
