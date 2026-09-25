// The patient app books under the same rules as /book/<slug>.
//
// create_public_booking has long refused a type the person may not book (new
// vs existing patients), a date past the type's horizon, and -- for a type
// that takes payment online -- has sent the patient to a payment step. The
// app's create_patient_booking checked none of the three, so a first-visit
// offer meant for new patients, a slot months past the clinic's limit, or a
// type the clinic insists is paid up front could all be booked from a phone.
//
// These call the database functions as a signed-in patient, the way the app
// does. The server is what counts: the app is not built by CI, and every
// version already installed calls these same functions.
describe('Booking from the patient app follows the type rules', () => {
  const password = 'Test1234!'

  // A start time `days` from now, on the hour, so bookings in one test never
  // overlap each other on the practitioner's calendar.
  const inDays = (days: number, hour = 10) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + days)
    d.setUTCHours(hour, 0, 0, 0)
    return d.toISOString()
  }

  beforeEach(() => {
    const stamp = Date.now() + '-' + Math.floor(Math.random() * 100000)
    const email = `app-patient-${stamp}@example.test`
    cy.wrap(email).as('email')
    cy.seedStaffAccount().as('acct')
    cy.get('@acct').then((account: any) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task<{ id: string }>('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Paciente',
        lastName: 'App',
        email,
      }).then((patient) => {
        cy.wrap(patient.id).as('patientId')
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
      })
    })
  })

  function type(account: any, name: string, rules: Record<string, unknown> = {}, priceCents = 4000) {
    return cy
      .task<{ id: string }>('db:createAppointmentType', {
        accountId: account.accountId,
        name,
        durationMinutes: 30,
        defaultPriceCents: priceCents,
        onlineBookingEnabled: true,
      })
      .then((t) => cy.task('db:setAppointmentTypeBookingRules', { id: t.id, ...rules }).then(() => t))
  }

  function info() {
    return cy.get<string>('@email').then((email) =>
      cy.task<{ data: any; error: string | null }>('db:callRpcAsPatient', { email, password, fn: 'get_patient_booking_info' }),
    )
  }

  function book(account: any, typeId: string, startsAt: string, teamMemberId: string = account.teamMemberId) {
    return cy.get<string>('@email').then((email) =>
      cy.task<{ data: any; error: string | null }>('db:callRpcAsPatient', {
        email,
        password,
        fn: 'create_patient_booking',
        args: {
          p_clinic_id: account.clinicId,
          p_team_member_id: teamMemberId,
          p_appointment_type_id: typeId,
          p_starts_at: startsAt,
          p_note: '',
        },
      }),
    )
  }

  function reschedule(appointmentId: string, startsAt: string) {
    return cy.get<string>('@email').then((email) =>
      cy.task<{ data: any; error: string | null }>('db:callRpcAsPatient', {
        email,
        password,
        fn: 'reschedule_patient_appointment',
        args: { p_appointment_id: appointmentId, p_starts_at: startsAt },
      }),
    )
  }

  // A second person on the clinic's team, at its clinic. The seeded owner is
  // the account's one practitioner seat, so a second practitioner needs one
  // more, as it would for a real clinic.
  function colleague(account: any, fullName: string, isPractitioner: boolean) {
    return cy.setExtraProfessionals(account.accountId, 3).then(() =>
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: isPractitioner ? 'Practitioner' : 'Front Desk',
        email: `colleague-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`,
        password,
        fullName,
        isPractitioner,
      }),
    )
  }

  it('does not offer or book a type meant for new patients', () => {
    cy.get('@acct').then((account: any) => {
      type(account, 'Primera visita', { bookableBy: 'new_patients' }).then((firstVisit) => {
        type(account, 'Revision', { bookableBy: 'existing_patients' }).then((revision) => {
          info().then((r) => {
            const ids = r.data.appointment_types.map((t: any) => t.id)
            expect(ids, 'the new-patient type is not offered').not.to.include(firstVisit.id)
            expect(ids, 'the existing-patient type is offered').to.include(revision.id)
          })
          book(account, firstVisit.id, inDays(3)).then((r) => {
            expect(r.error, 'a patient with a record is not a new patient').to.contain('only available to new patients')
          })
          book(account, revision.id, inDays(3, 11)).then((r) => {
            expect(r.error, 'an existing patient books an existing-patient type').to.eq(null)
          })
        })
      })
    })
  })

  it('refuses a date past the type horizon, or the clinic one', () => {
    cy.get('@acct').then((account: any) => {
      type(account, 'Corta antelacion', { maxDaysAhead: 7 }).then((short) => {
        type(account, 'Ajuste').then((plain) => {
          info().then((r) => {
            const sent = r.data.appointment_types.find((t: any) => t.id === short.id)
            expect(sent.online_max_days_ahead, "the type's own horizon is sent").to.eq(7)
            expect(r.data.settings.max_days_ahead, "the clinic's horizon is sent").to.eq(90)
          })
          book(account, short.id, inDays(10)).then((r) => {
            expect(r.error, "past the type's 7 days").to.contain('too far in advance')
          })
          book(account, short.id, inDays(5)).then((r) => {
            expect(r.error, "within the type's 7 days").to.eq(null)
          })
          book(account, plain.id, inDays(120)).then((r) => {
            expect(r.error, "past the clinic's 90 days").to.contain('too far in advance')
          })
          book(account, plain.id, inDays(60)).then((r) => {
            expect(r.error, "within the clinic's 90 days").to.eq(null)
          })
        })
      })
    })
  })

  it('does not book unpaid a type the web page takes payment for', () => {
    cy.get('@acct').then((account: any) => {
      type(account, 'Con pago', { paymentRequired: true }).then((paid) => {
        type(account, 'Deposito cero', { paymentRequired: true, depositCents: 0 }).then((zeroDeposit) => {
          // Free by default, but this practitioner charges for it: the web
          // page would take payment when booking with them.
          type(account, 'Pago con su precio', { paymentRequired: true }, 0).then((ownPrice) => {
            cy.task('db:setAppointmentTypeOverride', {
              accountId: account.accountId,
              appointmentTypeId: ownPrice.id,
              teamMemberId: account.teamMemberId,
              priceCents: 3000,
            })
            info().then((r) => {
              const offered = r.data.appointment_types.map((t: any) => t.id)
              const explained = r.data.online_payment_types.map((t: any) => t.id)
              expect(offered, 'a paid type is not offered').not.to.include(paid.id)
              expect(explained, 'it is listed so the app can say why').to.include(paid.id)
              expect(offered, "a type the practitioner charges for is not offered").not.to.include(ownPrice.id)
              expect(offered, 'a zero deposit charges nothing, as on the web page').to.include(zeroDeposit.id)
              expect(r.data.settings.booking_slug, 'the web page to book it on').to.eq(account.accountSlug)
            })
            book(account, paid.id, inDays(4)).then((r) => {
              expect(r.error, 'refused rather than booked unpaid').to.contain('paid online')
            })
            book(account, ownPrice.id, inDays(4, 11)).then((r) => {
              expect(r.error, "the practitioner's own price is what is charged").to.contain('paid online')
            })
            book(account, zeroDeposit.id, inDays(4, 12)).then((r) => {
              expect(r.error, 'nothing to pay, so it books').to.eq(null)
            })
          })
        })
      })
    })
  })

  // create_patient_booking checks the horizon; moving an appointment did not,
  // so a type patients may only book a week out could be moved to next year.
  // The move is measured against the appointment's own type, else the clinic.
  it('does not move an appointment past the type horizon, or the clinic one', () => {
    cy.get('@acct').then((account: any) => {
      cy.task('db:setPatientAppReschedule', { accountId: account.accountId, enabled: true, noticeHours: 24 })
      cy.get<string>('@patientId').then((patientId) => {
        type(account, 'Corta antelacion', { maxDaysAhead: 7 }).then((short) => {
          type(account, 'Ajuste').then((plain) => {
            const appointment = (typeId: string, startsAt: string) =>
              cy.task<{ id: string }>('db:createAppointment', {
                accountId: account.accountId,
                clinicId: account.clinicId,
                patientId,
                practitionerId: account.teamMemberId,
                appointmentTypeId: typeId,
                startsAt,
              })
            appointment(short.id, inDays(3)).then((a) => {
              reschedule(a.id, inDays(10)).then((r) => {
                expect(r.error, "past the type's 7 days").to.contain('too far in advance')
              })
              reschedule(a.id, inDays(6)).then((r) => {
                expect(r.error, "within the type's 7 days").to.eq(null)
              })
            })
            appointment(plain.id, inDays(3, 12)).then((a) => {
              reschedule(a.id, inDays(120, 12)).then((r) => {
                expect(r.error, "past the clinic's 90 days").to.contain('too far in advance')
              })
              reschedule(a.id, inDays(60, 12)).then((r) => {
                expect(r.error, "within the clinic's 90 days").to.eq(null)
              })
            })
          })
        })
      })
    })
  })

  // online_booking_enabled defaults to true for everyone on the team, so the
  // app offered -- and booked -- receptionists. The web page lists only
  // practitioners; the app now does too, and not anyone who has left.
  it('offers and books only practitioners who are still at the clinic', () => {
    cy.get('@acct').then((account: any) => {
      type(account, 'Ajuste').then((plain) => {
        colleague(account, 'Recepcion Mostrador', false).then((desk) => {
          colleague(account, 'Antigua Fisio', true).then((former) => {
            cy.task('db:setTeamMemberBookingFlags', { id: former.teamMemberId, deletedAt: new Date().toISOString() })
            info().then((r) => {
              const ids = r.data.team_members.map((m: any) => m.id)
              expect(ids, 'the practitioner is offered').to.include(account.teamMemberId)
              expect(ids, 'somebody who sees no patients is not').not.to.include(desk.teamMemberId)
              expect(ids, 'somebody who has left is not').not.to.include(former.teamMemberId)
            })
            book(account, plain.id, inDays(3), desk.teamMemberId).then((r) => {
              expect(r.error, 'the receptionist cannot be booked').to.contain('Practitioner not available')
            })
            book(account, plain.id, inDays(3, 11), former.teamMemberId).then((r) => {
              expect(r.error, 'nor somebody who has left').to.contain('Practitioner not available')
            })
            book(account, plain.id, inDays(3, 12)).then((r) => {
              expect(r.error, 'the practitioner can').to.eq(null)
            })
          })
        })
      })
    })
  })

  // The web page shows no practitioner choice for such a type and books the
  // first practitioner listed at the clinic -- here the owner, added first.
  it('books a "patient does not choose" type with the practitioner the clinic assigns', () => {
    cy.get('@acct').then((account: any) => {
      type(account, 'Valoracion', { bypassPractitioner: true }).then((assigned) => {
        type(account, 'Ajuste').then((plain) => {
          colleague(account, 'Segunda Fisio', true).then((second) => {
            info().then((r) => {
              const sent = r.data.appointment_types.find((t: any) => t.id === assigned.id)
              expect(sent.online_bypass_practitioner, 'the app is told not to ask').to.eq(true)
              const atClinic = r.data.team_members.filter((m: any) => m.clinic_ids.includes(account.clinicId))
              expect(atClinic.map((m: any) => m.id), "in the web page's order").to.deep.eq([account.teamMemberId, second.teamMemberId])
            })
            book(account, assigned.id, inDays(3), second.teamMemberId).then((r) => {
              expect(r.error, 'anyone else is refused, naming who to choose').to.contain('clinic assigns the practitioner')
              expect(r.error).to.contain('Test Owner')
            })
            book(account, assigned.id, inDays(3, 11)).then((r) => {
              expect(r.error, 'the assigned practitioner books').to.eq(null)
            })
            book(account, plain.id, inDays(3, 12), second.teamMemberId).then((r) => {
              expect(r.error, 'an ordinary type still lets the patient choose').to.eq(null)
            })
          })
        })
      })
    })
  })
})
