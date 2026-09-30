import { weekdayKeyOf } from '../../../utils/bookingSlots'
import { clinicDateOf, wallClock, wallClockToUtc } from '../../../utils/clinicClock'

// Online booking books only what the calendar has free
// (20260930141539_online_booking_obeys_the_calendar.sql).
//
// The booking page and the app decide which slots to OFFER; the functions
// that BOOK took whatever time they were handed. None of them looked at
// opening hours, a practitioner's days off or a closure; a deleted
// appointment kept its slot busy for good; two patients on one slot both got
// it; a deposit invoice was numbered from every clinic's invoices; and an
// archived clinic still took bookings.
//
// These call the functions the way the page and the app do -- anon, or as a
// signed-in patient -- because anon can call them without the page, and the
// app is not built by CI. The last test drives the page itself, for the time
// zone it builds its slots in.
const MADRID = 'Europe/Madrid'

/** The next date at the clinic, at least `fromDays` ahead, that falls on `day`. */
function nextDay(day: string, fromDays = 2): string {
  for (let n = fromDays; n < fromDays + 8; n++) {
    const date = clinicDateOf(new Date(Date.now() + n * 86400000), MADRID)
    if (weekdayKeyOf(date) === day) return date
  }
  throw new Error(`no ${day} ahead`)
}
const at = (date: string, hhmm: string, zone = MADRID) => new Date(wallClockToUtc(date, hhmm, zone)).toISOString()

describe('Online booking obeys the calendar', () => {
  let stamp = 0
  // A different person per booking, so only the slot decides.
  function publicBooking(account: any, typeId: string, startsAt: string, overrides: Record<string, unknown> = {}) {
    stamp += 1
    return cy.task<{ error: string | null; data: any }>('db:callPublicBookingAsAnon', {
      p_account_slug: account.accountSlug,
      p_clinic_id: account.clinicId,
      p_team_member_id: account.teamMemberId,
      p_appointment_type_id: typeId,
      p_starts_at: startsAt,
      p_first_name: 'Reserva',
      p_last_name: 'Online',
      p_email: `calendar-${Date.now()}-${stamp}@example.test`,
      p_phone: '600111222',
      p_country_code: 'ES',
      p_note: '',
      ...overrides,
    })
  }

  beforeEach(() => {
    cy.seedStaffAccount().as('acct')
    cy.get('@acct').then((account: any) => {
      // Monday to Friday, 08:00-19:00.
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consulta', durationMinutes: 30, onlineBookingEnabled: true }).as('type')
    })
  })

  it('refuses a time the clinic is closed, and takes one it is open', () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@type').then((type: any) => {
        publicBooking(account, type.id, at(nextDay('sat'), '10:00')).its('error').should('contain', 'not available for booking')
        publicBooking(account, type.id, at(nextDay('mon'), '19:30')).its('error').should('contain', 'not available for booking')
        // Half in, half out: the visit has to end by closing time.
        publicBooking(account, type.id, at(nextDay('mon'), '18:45')).its('error').should('contain', 'not available for booking')
        publicBooking(account, type.id, at(nextDay('mon'), '10:00')).its('error').should('eq', null)
      })
    })
  })

  it("refuses a practitioner's day off, on their own week rather than the clinic's", () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@type').then((type: any) => {
        cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: { mon: [['15:00', '20:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } })
        publicBooking(account, type.id, at(nextDay('tue'), '10:00')).its('error').should('contain', 'not available for booking')
        // Their own hours stand even past the clinic's closing time -- the
        // rule utils/businessHours.ts explains, and the one the page offers by.
        publicBooking(account, type.id, at(nextDay('mon'), '19:00')).its('error').should('eq', null)
      })
    })
  })

  it("refuses a closure, and time blocked off in the practitioner's diary", () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@type').then((type: any) => {
        const wed = nextDay('wed')
        const thu = nextDay('thu')
        cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: account.clinicId, startsAt: at(wed, '00:00'), endsAt: at(wed, '23:59') })
        cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: account.clinicId, startsAt: at(thu, '10:00'), endsAt: at(thu, '11:00'), practitionerId: account.teamMemberId })
        publicBooking(account, type.id, at(wed, '10:00')).its('error').should('contain', 'not available for booking')
        publicBooking(account, type.id, at(thu, '10:30')).its('error').should('contain', 'not available for booking')
        publicBooking(account, type.id, at(thu, '11:00')).its('error').should('eq', null)
      })
    })
  })

  it('gives back the slot of an appointment the clinic deleted', () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@type').then((type: any) => {
        const startsAt = at(nextDay('tue'), '12:00')
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Borrada' }).then((p) => {
          cy.task('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: p.id,
            practitionerId: account.teamMemberId,
            startsAt,
            deletedAt: new Date().toISOString(),
          })
        })
        // What the page reads to grey out a slot.
        cy.task<{ error: string | null; data: unknown[] | null }>('db:callRpcAsAnon', {
          fn: 'get_booking_busy_times',
          args: { p_clinic_id: account.clinicId, p_team_member_id: account.teamMemberId, p_from: at(nextDay('tue'), '00:00'), p_to: at(nextDay('tue'), '23:59') },
        }).then((r) => {
          expect(r.error).to.eq(null)
          expect(r.data, 'busy times').to.have.length(0)
        })
        publicBooking(account, type.id, startsAt).its('error').should('eq', null)
      })
    })
  })

  it('books one slot once, however many press "Reservar" at the same moment', () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@type').then((type: any) => {
        cy.task<{ errors: (string | null)[] }>('db:callPublicBookingConcurrently', {
          times: 6,
          args: {
            p_account_slug: account.accountSlug,
            p_clinic_id: account.clinicId,
            p_team_member_id: account.teamMemberId,
            p_appointment_type_id: type.id,
            p_starts_at: at(nextDay('fri'), '09:00'),
            p_last_name: 'Carrera',
            p_phone: '600111333',
            p_country_code: 'ES',
            p_note: '',
          },
        }).then(({ errors }) => {
          expect(errors.filter((e) => e === null), 'bookings that went through').to.have.length(1)
          errors.filter((e) => e !== null).forEach((e) => expect(e).to.contain('no longer available'))
        })
      })
    })
  })

  it("numbers a deposit invoice in the clinic's own series", () => {
    cy.get('@acct').then((account: any) => {
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Primera visita', durationMinutes: 30, defaultPriceCents: 4000, onlineBookingEnabled: true }).then((paid) => {
        cy.task('db:setAppointmentTypeBookingRules', { id: paid.id, paymentRequired: true })
        // The clinic's first receipt; the booking's invoice is its second.
        cy.task<string>('db:nextInvoiceNumber', { accountId: account.accountId }).should('eq', 'INV-0001')
        publicBooking(account, paid.id, at(nextDay('mon'), '11:00')).then((r) => {
          expect(r.error).to.eq(null)
          cy.task<{ invoice_number: string }[]>('db:selectRows', { table: 'invoices', columns: 'invoice_number', match: { id: r.data.invoice_id } })
            .its('0.invoice_number')
            .should('eq', 'INV-0002')
        })
      })
    })
  })

  it('refuses an archived clinic', () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@type').then((type: any) => {
        cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Cerrada' }).then((closed) => {
          cy.task('db:enableOnlineBooking', { clinicId: closed.id })
          cy.task('db:archiveClinic', { clinicId: closed.id })
          publicBooking(account, type.id, at(nextDay('mon'), '10:00'), { p_clinic_id: closed.id }).its('error').should('contain', 'Clinic not available for online booking')
        })
      })
    })
  })

  it('holds the patient app to the same calendar, booking and moving', () => {
    const email = `calendar-app-${Date.now()}@example.test`
    const password = 'Test1234!'
    cy.get('@acct').then((account: any) => {
      cy.get('@type').then((type: any) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paciente', email }).then((p) => {
          cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: p.id, email, password })
          cy.task('db:setPatientAppReschedule', { accountId: account.accountId, enabled: true, noticeHours: 0 })
          const wed = nextDay('wed')
          cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: account.clinicId, startsAt: at(wed, '09:00'), endsAt: at(wed, '13:00') })
          const book = (startsAt: string) =>
            cy.task<{ data: any; error: string | null }>('db:callRpcAsPatient', {
              email,
              password,
              fn: 'create_patient_booking',
              args: { p_clinic_id: account.clinicId, p_team_member_id: account.teamMemberId, p_appointment_type_id: type.id, p_starts_at: startsAt, p_note: '' },
            })
          book(at(wed, '10:00')).its('error').should('contain', 'not available for booking')
          book(at(nextDay('sun'), '10:00')).its('error').should('contain', 'not available for booking')
          book(at(nextDay('tue'), '10:00')).then((r) => {
            expect(r.error).to.eq(null)
            const move = (startsAt: string) =>
              cy.task<{ data: any; error: string | null }>('db:callRpcAsPatient', { email, password, fn: 'reschedule_patient_appointment', args: { p_appointment_id: r.data.appointment_id, p_starts_at: startsAt } })
            move(at(nextDay('sat'), '10:00')).its('error').should('contain', 'not available for booking')
            move(at(wed, '11:00')).its('error').should('contain', 'not available for booking')
            move(at(nextDay('thu'), '16:00')).its('error').should('eq', null)
          })
        })
      })
    })
  })

  it("offers and books the clinic's hours on the clinic's clock, wherever the visitor is", () => {
    // Mexico City keeps no summer time and is six or seven hours from Madrid
    // and from the UTC the CI browser runs in, so a slot built on the
    // browser's clock cannot pass for one built on the clinic's.
    const zone = 'America/Mexico_City'
    cy.get('@acct').then((account: any) => {
      cy.task('db:updateClinic', { clinicId: account.clinicId, timezone: zone })
      cy.visit(`/book/${account.accountSlug}`)
      cy.contains('Elija su fecha y hora').should('be.visible')
      // The furthest day on show: nothing booked, and not today, whose
      // earlier slots have gone.
      cy.get('.grid.grid-cols-7 button:not([disabled])').last().click()
      // The first slot of a day is opening time, 08:00, as the clinic reads it.
      cy.contains('button', /^\d{2}:\d{2}$/).first().should('have.text', '08:00').click()
      cy.contains('Introduzca sus datos').should('be.visible')
      cy.contains('label', 'Nombre *').parent().find('input').type('Zona')
      cy.contains('label', 'Correo electrónico *').parent().find('input').type(`zona-${Date.now()}@example.test`)
      cy.contains('label', 'Número de móvil *').parent().find('input[type="tel"]').type('600111444')
      cy.contains('button', 'Reservar cita').click()
      cy.contains('¡Cita reservada!', { timeout: 15000 }).should('be.visible')
      cy.task<{ starts_at: string }[]>('db:selectRows', { table: 'appointments', columns: 'starts_at', match: { account_id: account.accountId } }).then((rows) => {
        expect(rows).to.have.length(1)
        expect(wallClock(new Date(rows[0].starts_at), zone), "the appointment, on the clinic's clock").to.include({ hour: 8, minute: 0 })
      })
    })
  })
})
