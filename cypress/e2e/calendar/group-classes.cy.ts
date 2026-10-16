import { dateInputValue } from '../../support/calendar'

// Group classes: an appointment type with places, put on the calendar as
// sessions ("Nueva clase"), shown as one block "taken/places"; each place an
// ordinary appointment linked to its session, with attendance in one tap;
// places enforced by the database; online booking offering the sessions with
// the places left.
describe('Group classes', () => {
  function classType(accountId: string, extra: Record<string, unknown> = {}) {
    return cy
      .task<{ id: string }[]>('db:insertRows', { table: 'appointment_types', rows: [{ account_id: accountId, name: 'Escuela de espalda', duration_minutes: 60, class_capacity: 8, ...extra }] })
      .then((rows) => rows[0]!)
  }
  function session(account: { accountId: string; clinicId: string; teamMemberId: string }, typeId: string, startsAt: Date, capacity = 8) {
    return cy
      .task<{ id: string; starts_at: string }[]>('db:insertRows', {
        table: 'class_sessions',
        rows: [{ account_id: account.accountId, clinic_id: account.clinicId, appointment_type_id: typeId, practitioner_id: account.teamMemberId, starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 3600_000).toISOString(), capacity }],
      })
      .then((rows) => rows[0]!)
  }
  function place(account: { accountId: string; clinicId: string; teamMemberId: string }, typeId: string, sessionId: string, firstName: string) {
    return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Clase' }).then((p) =>
      cy
        .task<{ id: string }[]>('db:insertRows', {
          table: 'appointments',
          // The trigger gives the place its session's time.
          rows: [{ account_id: account.accountId, clinic_id: account.clinicId, patient_id: p.id, appointment_type_id: typeId, practitioner_id: account.teamMemberId, starts_at: new Date().toISOString(), ends_at: new Date().toISOString(), class_session_id: sessionId }],
        })
        .then((rows) => ({ patientId: p.id, appointmentId: rows[0]!.id })),
    )
  }
  // Earlier today (still today just after midnight), so attendance is open.
  const earlierToday = () => {
    const d = new Date(Date.now() - 3600_000)
    return d.getDate() === new Date().getDate() ? d : new Date(Date.now() - 60_000)
  }

  it('makes a type a class in Settings', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', { table: 'appointment_types', rows: [{ account_id: account.accountId, name: 'Pilates terapéutico', duration_minutes: 60 }] }).then(([type]) => {
        cy.login(account.email, account.password)
        cy.visit(`/settings/appointment-types/${type!.id}`)
        cy.get('[data-cy=type-page][data-ready=true]', { timeout: 20000 })
        cy.get('[data-cy=type-places]').type('1')
        cy.get('[data-cy=type-error-places]').should('be.visible')
        cy.get('[data-cy=type-places]').clear().type('6')
        cy.get('[data-cy=type-save]').click()
        cy.task('db:selectRows', { table: 'appointment_types', columns: 'class_capacity', match: { id: type!.id } }).its('0.class_capacity').should('eq', 6)
      })
    })
  })

  it('puts a class on every week from the Calendar', () => {
    cy.seedStaffAccount().then((account) => {
      classType(account.accountId).then((type) => {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.get('[data-cy=new-class-open]', { timeout: 20000 })
        cy.clickUntil('[data-cy=new-class-open]', '[data-cy=new-class]')
        cy.get('[data-cy=new-class-type]').should('contain', 'Escuela de espalda')
        cy.get('[data-cy=new-class-date]').clear().type(dateInputValue(tomorrow))
        cy.get('[data-cy=new-class-time]').clear().type('19:00')
        cy.get('[data-cy=new-class-weeks]').clear().type('3')
        cy.get('[data-cy=new-class-capacity]').should('have.value', '8')
        cy.get('[data-cy=new-class-create]').click()
        cy.get('[data-cy=new-class]').should('not.exist')
        cy.task<{ starts_at: string; capacity: number; appointment_type_id: string }[]>('db:selectRows', { table: 'class_sessions', columns: 'starts_at, capacity, appointment_type_id', match: { account_id: account.accountId } }).then((rows) => {
          expect(rows).to.have.length(3)
          const starts = rows.map((r) => Date.parse(r.starts_at)).sort()
          expect(starts[1]! - starts[0]!).to.be.within(7 * 86400_000 - 3600_000, 7 * 86400_000 + 3600_000)
          expect(rows.every((r) => r.capacity === 8 && r.appointment_type_id === type.id)).to.eq(true)
        })
      })
    })
  })

  it('shows the class as one block and takes attendance in one tap', () => {
    cy.seedStaffAccount().then((account) => {
      classType(account.accountId).then((type) => {
        session(account, type.id, earlierToday(), 4).then((s) => {
          place(account, type.id, s.id, 'Ana').then((ana) => {
            cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: ana.patientId, packageName: 'Bono 10', sessionsTotal: 10, sessionsUsed: 3 })
            place(account, type.id, s.id, 'Bruno').then((bruno) => {
              place(account, type.id, s.id, 'Carla').then((carla) => {
                cy.login(account.email, account.password)
                cy.visit('/calendar')
                // One block for the class, none for its places.
                cy.get(`[data-cy=class-block][data-session-id=${s.id}]`, { timeout: 20000 }).should('contain', '3/4')
                cy.get(`[data-cy=appt-block][data-appt-id=${ana.appointmentId}]`).should('not.exist')
                cy.get(`[data-cy=class-block][data-session-id=${s.id}]`).scrollIntoView().click({ force: true })
                cy.get('[data-cy=class-panel]').should('be.visible')
                cy.get('[data-cy=class-places]').should('contain', '3 of 4')
                // What each person draws on: Ana has a bono.
                cy.get('[data-cy=class-place][data-name="Ana Clase"]').should('contain', 'bono 3/10')
                cy.get('[data-cy=class-place][data-name="Bruno Clase"]').find('[data-cy=class-missed]').click()
                cy.get('[data-cy=class-place][data-name="Bruno Clase"]').should('have.attr', 'data-status', 'no_show')
                cy.get('[data-cy=class-all-came]').should('contain', 'Everyone else came').click()
                cy.get('[data-cy=class-place][data-name="Ana Clase"]').should('have.attr', 'data-status', 'completed')
                cy.task('db:appointmentById', { appointmentId: ana.appointmentId }).its('status').should('eq', 'completed')
                cy.task('db:appointmentById', { appointmentId: carla.appointmentId }).its('status').should('eq', 'completed')
                cy.task('db:appointmentById', { appointmentId: bruno.appointmentId }).its('status').should('eq', 'no_show')

                // A name opens the visit itself, for charging it.
                cy.get('[data-cy=class-place][data-name="Ana Clase"]').find('[data-cy=class-place-open]').click()
                cy.get('[data-cy=class-panel]').should('not.exist')
              })
            })
          })
        })
      })
    })
  })

  it('adds someone to a class until it is full, and the database holds the line', () => {
    cy.seedStaffAccount().then((account) => {
      classType(account.accountId).then((type) => {
        session(account, type.id, earlierToday(), 2).then((s) => {
          place(account, type.id, s.id, 'Ana').then(() => {
            cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Diego', lastName: 'Nuevo' }).then(() => {
              cy.login(account.email, account.password)
              cy.visit('/calendar')
              cy.get(`[data-cy=class-block][data-session-id=${s.id}]`, { timeout: 20000 }).should('contain', '1/2').scrollIntoView().click({ force: true })
              cy.get('[data-cy=class-add-search]').type('Diego')
              cy.get('[data-cy=class-add-result]').should('contain', 'Diego').click()
              cy.get('[data-cy=class-place][data-name="Diego Nuevo"]').should('exist')
              cy.get('[data-cy=class-places]').should('contain', '2 of 2')
              cy.get('[data-cy=class-panel]').should('contain', 'Full')
              cy.get('label[for=class-add]').should('contain', 'Add to the waitlist')
              cy.get(`[data-cy=class-block][data-session-id=${s.id}]`).should('contain', '2/2')

              // A third place is refused by the database itself, whoever asks.
              cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Eva', lastName: 'Tarde' }).then((eva) => {
                cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
                  email: account.email,
                  password: account.password,
                  table: 'appointments',
                  op: 'insert',
                  values: { account_id: account.accountId, clinic_id: account.clinicId, patient_id: eva.id, appointment_type_id: type.id, practitioner_id: account.teamMemberId, starts_at: s.starts_at, ends_at: s.starts_at, class_session_id: s.id },
                }).then((r) => {
                  expect(r.changed).to.eq(0)
                  expect(r.error).to.contain('That class is full')
                })
              })
            })
          })
        })
      })
    })
  })

  it('offers the sessions online with the places left, and books a place', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      classType(account.accountId, { online_booking_enabled: true, class_capacity: 2 }).then((type) => {
        const inTwoDays = new Date(Date.now() + 2 * 86400_000)
        inTwoDays.setMinutes(0, 0, 0)
        const inNineDays = new Date(inTwoDays.getTime() + 7 * 86400_000)
        session(account, type.id, inTwoDays, 2).then((open) => {
          session(account, type.id, inNineDays, 1).then((full) => {
            place(account, type.id, open.id, 'Ana').then(() => {
              place(account, type.id, full.id, 'Bruno').then(() => {
                cy.visit(`/book/${account.accountSlug}?type=${type.id}`)
                cy.get('[data-cy=class-sessions]', { timeout: 20000 })
                cy.get('[data-cy=class-session-option]').should('have.length', 2)
                cy.get('[data-cy=class-session-option]').eq(1).should('contain', 'Completa')
                cy.get('[data-cy=class-session-option]').eq(0).should('contain', 'Queda 1 plaza').click()

                cy.contains('Introduzca sus datos').should('be.visible')
                cy.contains('label', 'Nombre *').parent().find('input').type('Rosa')
                cy.contains('label', 'Apellidos').parent().find('input').type('Primera')
                cy.contains('label', 'Correo electrónico *').parent().find('input').type('rosa.primera@example.test')
                cy.contains('label', 'Número de móvil *').parent().find('input[type="tel"]').type('600111044')
                cy.contains('button', 'Reservar cita').click()
                cy.contains('¡Cita reservada!', { timeout: 15000 }).should('be.visible')

                cy.task<{ source: string; starts_at: string }[]>('db:selectRows', { table: 'appointments', columns: 'source, starts_at', match: { class_session_id: open.id } }).then((rows) => {
                  expect(rows).to.have.length(2)
                  expect(rows.map((r) => r.source)).to.include('online')
                  expect(rows.every((r) => Date.parse(r.starts_at) === inTwoDays.getTime())).to.eq(true)
                })
                cy.visit(`/book/${account.accountSlug}?type=${type.id}`)
                cy.get('[data-cy=class-session-option]', { timeout: 20000 }).eq(0).should('contain', 'Completa')
              })
            })
          })
        })
      })
    })
  })

  it('edits a class and every place moves with it', () => {
    cy.seedStaffAccount().then((account) => {
      classType(account.accountId).then((type) => {
        const tomorrow10 = new Date()
        tomorrow10.setDate(tomorrow10.getDate() + 1)
        tomorrow10.setHours(10, 0, 0, 0)
        session(account, type.id, tomorrow10, 4).then((s) => {
          place(account, type.id, s.id, 'Ana').then((ana) => {
            place(account, type.id, s.id, 'Bruno').then((bruno) => {
              cy.login(account.email, account.password)
              cy.visit('/calendar')
              cy.contains('select', 'Work week', { timeout: 20000 }).select('day')
              cy.get('[aria-label="Next"]').click()
              cy.get(`[data-cy=class-block][data-session-id=${s.id}]`, { timeout: 20000 }).scrollIntoView().click({ force: true })
              cy.get('[data-cy=class-edit]').click()
              // Not below the two people already in it.
              cy.get('[data-cy=class-edit-capacity]').clear().type('1')
              cy.get('[data-cy=class-edit-save]').click()
              cy.get('[data-cy=class-panel]').should('contain', '2 people already have a place')
              cy.get('[data-cy=class-edit-capacity]').clear().type('6')
              cy.get('[data-cy=class-edit-time]').clear().type('12:00')
              cy.get('[data-cy=class-edit-save]').click()
              cy.get('[data-cy=class-edit-form]').should('not.exist')
              cy.get('[data-cy=class-places]').should('contain', '2 of 6')

              const noon = new Date(tomorrow10)
              noon.setHours(12)
              cy.task<{ starts_at: string; capacity: number }[]>('db:selectRows', { table: 'class_sessions', columns: 'starts_at, capacity', match: { id: s.id } }).then(([row]) => {
                expect(Date.parse(row!.starts_at)).to.eq(noon.getTime())
                expect(row!.capacity).to.eq(6)
              })
              for (const p of [ana, bruno]) {
                cy.task<{ starts_at: string; rescheduled: boolean }>('db:appointmentById', { appointmentId: p.appointmentId }).then((a) => {
                  expect(Date.parse(a.starts_at)).to.eq(noon.getTime())
                  expect(a.rescheduled).to.eq(true)
                })
                cy.task('db:selectRows', { table: 'appointment_reschedules', columns: 'id', match: { appointment_id: p.appointmentId } }).should('have.length', 1)
              }
            })
          })
        })
      })
    })
  })
})
