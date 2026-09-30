import { dateInputValue, openNewAppointmentPanel } from '../../support/calendar'

// "Repeat" in the create panel books up to eight visits (a care plan up to
// 26) in one go. Only the first of them used to be checked: the live clash
// answer and the out-of-hours question both looked at the first date alone,
// so a weekly series quietly double-booked week three. The dates themselves
// were fixed multiples of 24 hours -- a month was 30 days, a week crossing the
// October clock change moved an hour -- and "daily" booked the weekend.
//
// The date rules are pinned in tests/unit/repeat-series.test.ts; these specs
// are about what the desk sees and what lands in the database.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** The next `weekday` (0 = Sunday) at least `minDays` from today, at hh:mm local. */
function nextWeekday(weekday: number, h: number, minDays = 3): Date {
  const d = new Date()
  d.setDate(d.getDate() + minDays)
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1)
  d.setHours(h, 0, 0, 0)
  return d
}

function weekdaysOnly(from: string, to: string): Record<string, [string, string][]> {
  return Object.fromEntries(DAY_KEYS.map((k) => [k, k === 'sat' || k === 'sun' ? [] : [[from, to]]]))
}

type Row = { starts_at: string; ends_at: string }
const local = (iso: string) => new Date(iso)
const sorted = (rows: Row[]) => [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at))

function fillBooking(patientSearch: string, patientName: string, start: Date, repeat: string) {
  cy.get('[data-cy=create-sheet]').within(() => {
    cy.get('[data-cy=create-patient-search]').type(patientSearch)
    cy.contains('[data-cy=create-patient-result]', patientName).click()
    cy.contains('[data-cy=create-type]', 'Ajuste').click()
    cy.get('input[type="date"]').clear().type(dateInputValue(start))
    cy.get('input[type="time"]').clear().type(`${String(start.getHours()).padStart(2, '0')}:00`)
    cy.get('[data-cy=create-more] summary').click()
    cy.contains('label', 'Repeat').find('select').select(repeat)
    cy.get('[data-cy=create-send-confirmation]').uncheck()
  })
}

describe('Repeating a booking', () => {
  it('checks every date in a weekly series, and skips the one that clashes only when asked', () => {
    cy.seedStaffAccount().then((account) => {
      const first = nextWeekday(1, 10)
      const third = new Date(first)
      third.setDate(third.getDate() + 14)
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30 })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Clara', lastName: 'Vidal' }).then((clara) => {
        // Week three at 10:15 is Clara's; the series' first date is free.
        const clash = new Date(third)
        clash.setMinutes(15)
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: clara.id, practitionerId: account.teamMemberId, startsAt: clash.toISOString() })
      })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marina', lastName: 'Soto' }).as('marina')

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      openNewAppointmentPanel()
      fillBooking('Marina', 'Marina Soto', first, 'weekly')

      cy.get('[data-cy=create-sheet]').within(() => {
        // The first date is free, so the live answer has nothing to say.
        cy.get('[data-cy=create-free]').should('exist')
        cy.get('[data-cy=create-submit]').click()

        cy.get('[data-cy=create-series-conflicts]').should('contain.text', '1 of 8 dates don’t fit')
        cy.get('[data-cy=create-series-conflict]').should('have.length', 1).and('contain.text', 'Clara Vidal')
        // Going back writes nothing.
        cy.get('[data-cy=create-series-back]').click()
        cy.get('[data-cy=create-series-conflicts]').should('not.exist')
      })
      cy.get<{ id: string }>('@marina').then((marina) => {
        cy.task<Row[]>('db:selectRows', { table: 'appointments', columns: 'starts_at, ends_at', match: { patient_id: marina.id } }).should('have.length', 0)
      })

      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-submit]').click()
        cy.get('[data-cy=create-series-skip]').should('contain.text', 'book the other 7').click()
      })
      cy.get('[data-cy=create-sheet]').should('not.exist')

      cy.get<{ id: string }>('@marina').then((marina) => {
        cy.task<Row[]>('db:selectRows', { table: 'appointments', columns: 'starts_at, ends_at', match: { patient_id: marina.id } }).then((rows) => {
          const starts = sorted(rows).map((r) => local(r.starts_at))
          expect(starts).to.have.length(7)
          expect(starts.map(dateInputValue), 'week three skipped').not.to.include(dateInputValue(third))
          // Same weekday and the same 10:00 every week -- a series crossing
          // the October clock change used to move to 09:00 from then on.
          starts.forEach((s) => {
            expect(s.getDay(), dateInputValue(s)).to.equal(1)
            expect(s.getHours(), dateInputValue(s)).to.equal(10)
            expect(s.getMinutes()).to.equal(0)
          })
        })
      })
    })
  })

  it('books the same day of the month, clamped to a short month', () => {
    cy.seedStaffAccount().then((account) => {
      const first = new Date(new Date().getFullYear() + 1, 0, 31, 10, 0)
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30 })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marina', lastName: 'Soto' }).as('marina')

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      openNewAppointmentPanel()
      fillBooking('Marina', 'Marina Soto', first, 'monthly')
      cy.get('[data-cy=create-submit]').click()
      cy.get('[data-cy=create-sheet]').should('not.exist')

      cy.get<{ id: string }>('@marina').then((marina) => {
        cy.task<Row[]>('db:selectRows', { table: 'appointments', columns: 'starts_at, ends_at', match: { patient_id: marina.id } }).then((rows) => {
          const starts = sorted(rows).map((r) => local(r.starts_at))
          const y = first.getFullYear()
          const lastDay = (m: number) => new Date(y, m + 1, 0).getDate()
          // 31 Jan, then 28/29 Feb, 31 Mar, 30 Apr ... -- never "30 days later".
          expect(starts.map(dateInputValue)).to.deep.equal([0, 1, 2, 3, 4, 5, 6, 7].map((m) => dateInputValue(new Date(y, m, Math.min(31, lastDay(m))))))
          starts.forEach((s) => expect(s.getHours()).to.equal(10))
        })
      })
    })
  })

  it('books eight working days for "daily", stepping over the weekend', () => {
    cy.seedStaffAccount().then((account) => {
      const first = nextWeekday(4, 10)
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: weekdaysOnly('08:00', '20:00') })
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30 })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marina', lastName: 'Soto' }).as('marina')

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      openNewAppointmentPanel()
      fillBooking('Marina', 'Marina Soto', first, 'daily')
      cy.get('[data-cy=create-submit]').click()
      cy.get('[data-cy=create-sheet]').should('not.exist')

      cy.get<{ id: string }>('@marina').then((marina) => {
        cy.task<Row[]>('db:selectRows', { table: 'appointments', columns: 'starts_at, ends_at', match: { patient_id: marina.id } }).then((rows) => {
          const starts = sorted(rows).map((r) => local(r.starts_at))
          expect(starts).to.have.length(8)
          starts.forEach((s) => expect([0, 6], dateInputValue(s)).not.to.include(s.getDay()))
          expect(dateInputValue(starts[0])).to.equal(dateInputValue(first))
        })
      })
    })
  })
})

describe('A new patient booked from the panel', () => {
  it('is not created until the booking is, and is created once however many tries it takes', () => {
    cy.seedStaffAccount().then((account) => {
      // Tuesday 18:00, with hours of 09:00-14:00: the out-of-hours question.
      const at = nextWeekday(2, 18)
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: weekdaysOnly('09:00', '14:00') })
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30 })
      cy.task<number>('db:patientCount', { accountId: account.accountId }).as('before')

      let answer = false
      const asked: string[] = []
      cy.on('window:confirm', (text) => {
        asked.push(text)
        return answer
      })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      openNewAppointmentPanel()
      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-patient-search]').type('Nerea Pozo')
        cy.get('[data-cy=create-new-patient]').click()
        cy.contains('[data-cy=create-type]', 'Ajuste').click()
        cy.get('input[type="date"]').clear().type(dateInputValue(at))
        cy.get('input[type="time"]').clear().type('18:00')
        cy.get('[data-cy=create-send-confirmation]').uncheck()

        // Declined: nothing written, not even the patient.
        cy.get('[data-cy=create-submit]').click()
      })
      cy.wrap(asked).should('have.length', 1).its(0).should('contain', 'outside working hours')
      cy.get<number>('@before').then((before) => cy.task('db:patientCount', { accountId: account.accountId }).should('equal', before))

      // Accepted, but the appointment insert fails once: the patient exists
      // now, and stays chosen, so the retry books them rather than creating
      // them a second time.
      cy.then(() => (answer = true))
      cy.intercept({ method: 'POST', url: '**/rest/v1/appointments*', times: 1 }, { statusCode: 400, body: { code: 'XX000', message: 'appointment insert refused', details: null, hint: null } }).as('refused')
      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-submit]').click()
        cy.wait('@refused')
        cy.contains('appointment insert refused').should('be.visible')
        cy.get('[data-cy=create-patient-selected]').should('contain.text', 'Nerea Pozo')
        cy.get('[data-cy=create-submit]').click()
      })
      cy.get('[data-cy=create-sheet]').should('not.exist')

      cy.get<number>('@before').then((before) => cy.task('db:patientCount', { accountId: account.accountId }).should('equal', before + 1))
      cy.task<{ id: string } | null>('db:patientByName', { accountId: account.accountId, firstName: 'Nerea', lastName: 'Pozo' }).then((p) => {
        cy.task<Row[]>('db:selectRows', { table: 'appointments', columns: 'starts_at, ends_at', match: { patient_id: p!.id } }).should('have.length', 1)
      })
    })
  })
})
