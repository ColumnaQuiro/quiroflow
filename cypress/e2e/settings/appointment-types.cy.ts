import type { StaffAccount } from '../../support/commands'
import { openNewAppointmentPanel } from '../../support/calendar'

// Settings -> Appointment Types: a list in the clinic's own order, one page
// per type with one save for all of it, and archive instead of delete
// (20260925140512_appointment_types_archive_order_and_rules). Every value is
// checked in the database, not only on screen.

interface TypeRow {
  name: string
  duration_minutes: number
  default_price_cents: number
  color: string
  stage: string | null
  online_booking_enabled: boolean
  online_bookable_by: string
  online_bypass_practitioner: boolean
  online_max_days_ahead: number | null
  online_payment_required: boolean
  online_deposit_cents: number | null
  archived_at: string | null
}
type TypeState = { row: TypeRow | null; overrides: { team_member_id: string; duration_minutes: number | null; price_cents: number | null }[] }

function typeState(id: string) {
  return cy.task<TypeState>('db:appointmentTypeRow', { id })
}

function createType(account: StaffAccount, name: string, extra: Record<string, unknown> = {}) {
  return cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name, ...extra })
}

function openList() {
  cy.visit('/settings/appointment-types')
  cy.get('[data-cy=types-page]').should('have.attr', 'data-ready', 'true')
}

function openType(id: string) {
  cy.visit(`/settings/appointment-types/${id}`)
  cy.get('[data-cy=type-page]').should('have.attr', 'data-ready', 'true')
}

function tomorrowAt(h: number) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

function daysAgoAt(n: number, h: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

describe('Appointment types', () => {
  it('creates a type that is not bookable online, then edits everything about it in one save', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setStripePublishableKey', { accountId: account.accountId, key: 'pk_test_cypress' })
      cy.login(account.email, account.password)
      openList()

      cy.get('[data-cy=type-add]').click()
      cy.get('[data-cy=type-new-name]').type('Primera visita')
      cy.get('[data-cy=type-new-duration]').clear().type('45')
      cy.get('[data-cy=type-new-price]').type('60,00')
      cy.get('[data-cy=type-new-online]').should('have.attr', 'aria-checked', 'false')
      cy.get('[data-cy=confirm-dialog-confirm]').click()

      cy.location('pathname').should('match', /^\/settings\/appointment-types\/[0-9a-f-]{36}$/)
      cy.get('[data-cy=type-page]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=type-title]').should('have.text', 'Primera visita')
      cy.get('[data-cy=type-save-bar]').should('not.exist')

      cy.location('pathname').then((path) => {
        const id = path.split('/').pop()!
        typeState(id).its('row').should((row: TypeRow) => {
          expect(row.online_booking_enabled, 'new types are not bookable online').to.equal(false)
          expect(row.duration_minutes).to.equal(45)
          expect(row.default_price_cents).to.equal(6000)
        })

        cy.get('[data-cy=type-name]').clear().type('Primera visita completa')
        cy.get('[data-cy=type-save-bar]').should('be.visible')
        cy.get('[data-cy=type-duration]').clear().type('50')
        cy.get('[data-cy=type-price]').clear().type('70,00')
        cy.get('[data-cy=type-color][data-color="#14b8a6"]').click().should('have.attr', 'aria-checked', 'true')
        cy.get('[data-cy=type-stage]').select('first_visit')
        cy.get('[data-cy=type-online]').click().should('have.attr', 'aria-checked', 'true')
        cy.get('[data-cy=type-bookable-by][data-value=new_patients]').click().should('have.attr', 'aria-checked', 'true')
        cy.get('[data-cy=type-bypass]').click()
        cy.get('[data-cy=type-max-days-hint]').should('contain.text', "clinic's 90 days")
        cy.get('[data-cy=type-max-days]').type('30')
        cy.get('[data-cy=type-payment]').should('not.be.disabled').click()
        cy.get('[data-cy=type-deposit]').type('20,00')
        cy.get('[data-cy=type-save]').click()
        cy.get('[data-cy=type-save-bar]').should('not.exist')
        cy.get('[data-cy=type-save-bar]').should('not.exist')
        cy.get('[data-cy=type-title]').should('have.text', 'Primera visita completa')

        typeState(id).its('row').should((row: TypeRow) => {
          expect(row.name).to.equal('Primera visita completa')
          expect(row.duration_minutes).to.equal(50)
          expect(row.default_price_cents).to.equal(7000)
          expect(row.color).to.equal('#14b8a6')
          expect(row.stage).to.equal('first_visit')
          expect(row.online_booking_enabled).to.equal(true)
          expect(row.online_bookable_by).to.equal('new_patients')
          expect(row.online_bypass_practitioner).to.equal(true)
          expect(row.online_max_days_ahead).to.equal(30)
          expect(row.online_payment_required).to.equal(true)
          expect(row.online_deposit_cents).to.equal(2000)
        })

        // Online Booking no longer edits types; it points at their pages.
        cy.visit('/settings/online-booking')
        cy.contains('button', 'Bookable Entities').should('not.exist')
        cy.get('[data-cy=booking-types-note]').should('be.visible')
        cy.contains('[data-cy=booking-type-link]', 'Primera visita completa').should('have.attr', 'href', `/settings/appointment-types/${id}#online`)
      })
    })
  })

  it('refuses a duplicate name, a duration out of range and a deposit above the price', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setStripePublishableKey', { accountId: account.accountId, key: 'pk_test_cypress' })
      createType(account, 'Ajuste', { defaultPriceCents: 4000 })
      createType(account, 'Revisión', { defaultPriceCents: 4000 }).then((revision) => {
        cy.login(account.email, account.password)

        // In the new-type dialog.
        openList()
        cy.get('[data-cy=type-add]').click()
        cy.get('[data-cy=type-new-name]').type('  AJUSTE ')
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.get('[data-cy=type-new-name-taken]').should('be.visible')
        cy.get('[data-cy=confirm-dialog-cancel]').click()

        // On a type's page.
        openType(revision.id)
        cy.get('[data-cy=type-name]').clear().type('ajuste')
        cy.get('[data-cy=type-error-name]').should('contain.text', 'Another type already has this name.')
        cy.get('[data-cy=type-save]').click()
        cy.contains('Some fields need fixing').should('be.visible')
        cy.get('[data-cy=type-name]').clear().type('Revisión')

        cy.get('[data-cy=type-duration]').clear().type('4')
        cy.get('[data-cy=type-error-duration]').should('contain.text', 'Between 5 and 480.')
        cy.get('[data-cy=type-duration]').clear().type('481')
        cy.get('[data-cy=type-error-duration]').should('exist')
        cy.get('[data-cy=type-save]').click()
        cy.contains('Some fields need fixing').should('be.visible')
        cy.get('[data-cy=type-duration]').clear().type('480')
        cy.get('[data-cy=type-error-duration]').should('not.exist')

        cy.get('[data-cy=type-online]').then(($s) => {
          if ($s.attr('aria-checked') !== 'true') cy.wrap($s).click()
        })
        cy.get('[data-cy=type-payment]').click()
        cy.get('[data-cy=type-deposit]').type('80,00')
        cy.get('[data-cy=type-error-deposit]').should('contain.text', 'cannot be more than the price')
        cy.get('[data-cy=type-save]').click()
        cy.get('[data-cy=type-deposit-over]').should('contain.text', 'cannot be more than the price')
        cy.get('[data-cy=confirm-dialog-confirm]').click()

        typeState(revision.id).its('row').should((row: TypeRow) => {
          expect(row.name).to.equal('Revisión')
          expect(row.duration_minutes, 'nothing was saved').to.equal(30)
          expect(row.online_payment_required).to.equal(false)
        })

        cy.get('[data-cy=type-deposit]').clear().type('40,00')
        cy.get('[data-cy=type-save]').click()
        cy.get('[data-cy=type-save-bar]').should('not.exist')
        typeState(revision.id).its('row').should((row: TypeRow) => {
          expect(row.duration_minutes).to.equal(480)
          expect(row.online_deposit_cents).to.equal(4000)
        })
      })
    })
  })

  it('sets a practitioner\'s own duration and price, lists only active practitioners, and removes it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email: `paula-${Date.now()}@example.test`,
        password: 'Test1234!',
        fullName: 'Paula Practitioner',
        isPractitioner: true,
      }).then((paula) => {
        cy.task('db:createTeamMemberWithRole', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          roleName: 'Practitioner',
          email: `frank-${Date.now()}@example.test`,
          password: 'Test1234!',
          fullName: 'Frank Frontdesk',
          isPractitioner: false,
        })
        createType(account, 'Primera visita', { durationMinutes: 45, defaultPriceCents: 6000 }).then((type) => {
          cy.login(account.email, account.password)
          openType(type.id)

          cy.get('[data-cy=type-override-row]').should('have.length', 2)
          cy.contains('[data-cy=type-override-row]', 'Frank Frontdesk').should('not.exist')
          cy.get(`[data-cy=type-override-row][data-member-id="${paula.teamMemberId}"]`).within(() => {
            cy.get('[data-cy=type-override-duration]').should('have.attr', 'placeholder', '45').type('60')
            cy.get('[data-cy=type-override-price]').should('have.attr', 'placeholder', '60,00').type('70,00')
          })
          cy.get('[data-cy=type-save]').click()
          cy.get('[data-cy=type-save-bar]').should('not.exist')
          typeState(type.id).its('overrides').should('deep.equal', [{ team_member_id: paula.teamMemberId, duration_minutes: 60, price_cents: 7000 }])

          // The list says so.
          openList()
          cy.contains('[data-cy=type-row]', 'Primera visita').should('contain.text', '1 practitioner with own price')

          openType(type.id)
          cy.get(`[data-cy=type-override-row][data-member-id="${paula.teamMemberId}"]`).within(() => {
            cy.get('[data-cy=type-override-duration]').should('have.value', '60')
            cy.get('[data-cy=type-override-clear]').click()
            cy.get('[data-cy=type-override-duration]').should('have.value', '')
          })
          cy.get('[data-cy=type-save]').click()
          cy.get('[data-cy=type-save-bar]').should('not.exist')
          typeState(type.id).its('overrides').should('deep.equal', [])
        })
      })
    })
  })

  it('keeps the order it is given, and the calendar proposes the first type', () => {
    cy.seedStaffAccount().then((account) => {
      createType(account, 'Ajuste')
      createType(account, 'Revisión')
      createType(account, 'Primera visita')
      cy.login(account.email, account.password)
      openList()

      cy.get('[data-cy=type-row] [data-cy=type-name]').then(($n) => {
        expect([...$n].map((n) => n.textContent)).to.deep.equal(['Ajuste', 'Revisión', 'Primera visita'])
      })
      cy.contains('[data-cy=type-row]', 'Primera visita').find('[data-cy=type-move-up]').click()
      cy.get('[data-cy=type-row] [data-cy=type-name]').eq(1).should('have.text', 'Primera visita')
      cy.contains('[data-cy=type-row]', 'Primera visita').find('[data-cy=type-move-up]').should('not.be.disabled').click()
      cy.get('[data-cy=type-row] [data-cy=type-name]').first().should('have.text', 'Primera visita')

      // The reorder is saved after the list has already moved on screen, and
      // cy.task does not retry, so poll.
      const expectOrder = (want: string[], attempt = 0): void => {
        cy.task<{ name: string }[]>('db:appointmentTypesFor', { accountId: account.accountId }).then((rows) => {
          const names = rows.map((r) => r.name)
          if (JSON.stringify(names) === JSON.stringify(want) || attempt > 20) {
            expect(names).to.deep.equal(want)
            return
          }
          cy.wait(250)
          expectOrder(want, attempt + 1)
        })
      }
      expectOrder(['Primera visita', 'Ajuste', 'Revisión'])

      // Survives a reload.
      openList()
      cy.get('[data-cy=type-row] [data-cy=type-name]').first().should('have.text', 'Primera visita')

      cy.visit('/calendar')
      openNewAppointmentPanel()
      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-type]').first().should('contain.text', 'Primera visita').and('have.attr', 'aria-checked', 'true')
      })
    })
  })

  it('says where a type is used, and will not delete one that appointments use', () => {
    cy.seedStaffAccount().then((account) => {
      createType(account, 'Ajuste').then((type) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Clara', lastName: 'Vidal' }).then((patient) => {
          const base = { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, appointmentTypeId: type.id }
          cy.task('db:createAppointment', { ...base, startsAt: daysAgoAt(7, 10), status: 'completed' })
          // Soft-deleted still counts: it can be restored, and it still points at the type.
          cy.task('db:createAppointment', { ...base, startsAt: daysAgoAt(3, 10), deletedAt: new Date().toISOString() })
          cy.task('db:createAppointment', { ...base, startsAt: tomorrowAt(10) })
          cy.task('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, appointmentTypeId: type.id })
        })
        cy.task('db:createAutomationRule', { accountId: account.accountId, triggerEvent: 'appointment.booked', name: 'Bienvenida', filters: { appointment_type_ids: [type.id] }, actions: [] })
        cy.task('db:setReceptionistTypes', { accountId: account.accountId, appointmentTypeIds: [type.id] })

        cy.login(account.email, account.password)
        openList()
        cy.contains('[data-cy=type-row]', 'Ajuste').find('[data-cy=type-uses]').should('have.text', '3 appointments')

        openType(type.id)
        cy.get('[data-cy=type-usage-appointments]').should('contain.text', '3 appointments').and('contain.text', '1 of them from today on')
        cy.get('[data-cy=type-usage-waitlist]').should('contain.text', '1 on the waitlist')
        cy.get('[data-cy=type-usage-automations]').should('contain.text', '1 automation').and('contain.text', '«Bienvenida»')
        cy.get('[data-cy=type-usage-receptionist]').should('contain.text', 'may offer it when booking')
        cy.get('[data-cy=type-delete]').should('be.disabled')
        cy.get('[data-cy=type-delete-unavailable]').should('contain.text', '3 appointments use it')

        // Archiving says what is still pointing at it.
        cy.get('[data-cy=type-archive]').click()
        cy.get('[data-cy=type-archive-in-use]')
          .should('contain.text', '1 appointments from today on')
          .and('contain.text', '1 on the waitlist')
          .and('contain.text', 'AI receptionist')
        cy.get('[data-cy=confirm-dialog-cancel]').click()

        // And the database refuses the delete on its own.
        cy.task<{ error: string | null }>('db:deleteAppointmentType', { id: type.id }).its('error').should('contain', 'cannot be deleted')
        typeState(type.id).then((st) => expect(st.row).to.not.equal(null))
      })
    })
  })

  it('archives a type out of booking and the calendar, keeps it on its appointments, and reactivates it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      createType(account, 'Revisión', { onlineBookingEnabled: true })
      createType(account, 'Alta', { onlineBookingEnabled: true })
      createType(account, 'Ajuste', { onlineBookingEnabled: true }).then((type) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Clara', lastName: 'Vidal' }).then((patient) => {
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, appointmentTypeId: type.id, startsAt: tomorrowAt(10) })
        })

        // Offered before.
        cy.visit(`/book/${account.accountSlug}`)
        cy.contains('option', 'Ajuste').should('exist')

        cy.login(account.email, account.password)
        openType(type.id)
        cy.get('[data-cy=type-archive]').click()
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.location('pathname').should('eq', '/settings/appointment-types')
        cy.get(`[data-cy=type-archived-row][data-type-id="${type.id}"]`).should('contain.text', 'still on its 1 appointments')
        cy.contains('[data-cy=type-row]', 'Ajuste').should('not.exist')
        typeState(type.id).then((st) => expect(st.row?.archived_at).to.not.equal(null))

        // Not on the public booking page.
        cy.visit(`/book/${account.accountSlug}`)
        cy.contains('option', 'Revisión').should('exist')
        cy.contains('option', 'Ajuste').should('not.exist')

        // Not offered for a new appointment...
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        openNewAppointmentPanel()
        cy.get('[data-cy=create-sheet]').within(() => {
          cy.contains('[data-cy=create-type]', 'Revisión').should('exist')
          cy.contains('[data-cy=create-type]', 'Ajuste').should('not.exist')
        })

        // ...but still on the appointment that has it, and still its type when that is changed.
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        cy.get('[aria-label="Next"]').click()
        cy.contains('[data-cy=appt-block]', 'Clara Vidal').click()
        cy.get('[data-cy=appt-sheet]').should('contain.text', 'Ajuste')
        cy.get('[data-cy=appt-edit]').click()
        cy.get('[data-cy=appt-edit-form] select').first().find('option:selected').should('have.text', 'Ajuste')

        // Back again.
        openList()
        cy.get(`[data-cy=type-archived-row][data-type-id="${type.id}"] [data-cy=type-reactivate]`).click()
        cy.contains('[data-cy=type-row]', 'Ajuste').should('exist')
        cy.get('[data-cy=types-archived]').should('not.exist')
        typeState(type.id).then((st) => expect(st.row?.archived_at).to.equal(null))
        cy.visit(`/book/${account.accountSlug}`)
        cy.contains('option', 'Ajuste').should('exist')
      })
    })
  })

  it('deletes a type no appointment has used, once its name is typed', () => {
    cy.seedStaffAccount().then((account) => {
      createType(account, 'Ajuste de prueba').then((type) => {
        cy.login(account.email, account.password)
        openType(type.id)
        cy.get('[data-cy=type-usage-appointments]').should('contain.text', '0 appointments')
        cy.get('[data-cy=type-delete]').should('not.be.disabled').click()
        cy.get('[data-cy=confirm-dialog-confirm]').should('be.disabled')
        cy.get('[data-cy=confirm-dialog-word]').type('Ajuste de prueba')
        cy.get('[data-cy=confirm-dialog-confirm]').should('not.be.disabled').click()
        cy.location('pathname').should('eq', '/settings/appointment-types')
        cy.contains('[data-cy=type-row]', 'Ajuste de prueba').should('not.exist')
        typeState(type.id).then((st) => expect(st.row).to.equal(null))
      })
    })
  })
})
