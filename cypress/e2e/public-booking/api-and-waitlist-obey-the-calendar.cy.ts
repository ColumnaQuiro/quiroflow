// The public API and the waitlist book only what is free.
//
// The booking page and the patient app were closed to double-booking in
// 20260930141539 (booking-obeys-the-calendar.cy.ts). Two more doors booked
// straight into a practitioner's diary without asking the same question:
//
// - A waitlist claim looked for a clash only in the offered ROOM, and only
//   when the offer had one. The practitioner could have been booked into the
//   freed slot, or had it blocked off, since the offer went out. And the
//   expiry sweep re-offered a slot to the next person without checking it was
//   still free at all.
// - The public API's PATCH checked for an overlap only when the timing moved,
//   so handing a visit to a busy practitioner, or un-cancelling one onto a
//   slot somebody else had taken since, went straight in. And create/move
//   checked in one request and wrote in another, so two parallel calls for
//   one slot both passed the check.

const HOUR = 3600 * 1000

/** A slot `days` ahead at `hour`:00 UTC, clear of anything else in the account. */
function slot(days: number, hour: number, minutes = 30) {
  const start = new Date(Date.now() + days * 24 * HOUR)
  start.setUTCHours(hour, 0, 0, 0)
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + minutes * 60000).toISOString() }
}

describe('The public API and the waitlist obey the calendar', () => {
  const password = 'Test1234!'

  beforeEach(() => {
    cy.seedStaffAccount().as('acct')
  })

  function patient(account: any, firstName: string) {
    return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Calendario' })
  }

  function colleague(account: any, fullName: string) {
    return cy.setExtraProfessionals(account.accountId, 3).then(() =>
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email: `colleague-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`,
        password,
        fullName,
        isPractitioner: true,
      }),
    )
  }

  function appointment(account: any, patientId: string, startsAt: string, extra: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('db:createAppointment', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      patientId,
      startsAt,
      practitionerId: account.teamMemberId,
      ...extra,
    })
  }

  // ---------------------------------------------------------------- waitlist

  function offeredEntry(account: any, patientId: string, s: { startsAt: string; endsAt: string }, expiresAt = new Date(Date.now() + 2 * HOUR).toISOString()) {
    return cy
      .task<{ id: string }>('db:createWaitlistEntry', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        patientId,
        status: 'offered',
        offered: { startsAt: s.startsAt, endsAt: s.endsAt, roomId: null, practitionerId: account.teamMemberId, expiresAt },
      })
      .then((entry) =>
        cy
          .task<{ claim_token: string }[]>('db:selectRows', { table: 'waitlist_entries', columns: 'claim_token', match: { id: entry.id } })
          .then((rows) => ({ id: entry.id, token: rows[0]!.claim_token })),
      )
  }

  const claim = (token: string) => cy.request({ method: 'POST', url: `/api/waitlist/${token}`, failOnStatusCode: false })
  const appointmentsOf = (patientId: string) =>
    cy.task<{ id: string; source: string; starts_at: string }[]>('db:selectRows', { table: 'appointments', columns: 'id, source, starts_at, deleted_at', match: { patient_id: patientId } })

  it('refuses a waitlist claim once the practitioner has been booked into the slot elsewhere', () => {
    cy.get('@acct').then((account: any) => {
      const s = slot(3, 9)
      patient(account, 'Espera').then((waiting) => {
        patient(account, 'Ocupa').then((other) => {
          offeredEntry(account, waiting.id, s).then((entry) => {
            // Booked by the front desk after the offer went out -- no room, so
            // the old room-only check had nothing to compare.
            appointment(account, other.id, s.startsAt)
            claim(entry.token).then((res) => {
              expect(res.status).to.eq(409)
              expect(JSON.stringify(res.body)).to.contain('just taken')
            })
            appointmentsOf(waiting.id).should('have.length', 0)
            cy.task<{ status: string }>('db:waitlistEntryById', { id: entry.id }).its('status').should('eq', 'offered')
          })
        })
      })
    })
  })

  it("refuses a waitlist claim on time the practitioner has since blocked off", () => {
    cy.get('@acct').then((account: any) => {
      const s = slot(3, 10)
      patient(account, 'Bloqueo').then((waiting) => {
        offeredEntry(account, waiting.id, s).then((entry) => {
          cy.task('db:createAvailabilityBlock', { accountId: account.accountId, clinicId: account.clinicId, startsAt: s.startsAt, endsAt: s.endsAt, practitionerId: account.teamMemberId })
          claim(entry.token).its('status').should('eq', 409)
          appointmentsOf(waiting.id).should('have.length', 0)
        })
      })
    })
  })

  it('books a waitlist claim on a free slot, where deleted and cancelled visits hold no time', () => {
    cy.get('@acct').then((account: any) => {
      const s = slot(3, 11)
      patient(account, 'Libre').then((waiting) => {
        patient(account, 'Anterior').then((other) => {
          appointment(account, other.id, s.startsAt, { status: 'cancelled' })
          appointment(account, other.id, s.startsAt, { deletedAt: new Date().toISOString() })
          offeredEntry(account, waiting.id, s).then((entry) => {
            claim(entry.token).its('status').should('eq', 200)
            appointmentsOf(waiting.id).then((rows) => {
              expect(rows).to.have.length(1)
              expect(rows[0]!.source).to.eq('waitlist')
              expect(new Date(rows[0]!.starts_at).toISOString()).to.eq(s.startsAt)
            })
            cy.task<{ status: string }>('db:waitlistEntryById', { id: entry.id }).its('status').should('eq', 'booked')
          })
        })
      })
    })
  })

  const expireSweep = () =>
    cy.request({ method: 'POST', url: '/api/waitlist/expire-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } }).its('status').should('eq', 200)

  it('does not re-offer an expired offer whose slot has been taken since', () => {
    cy.get('@acct').then((account: any) => {
      const s = slot(3, 12)
      patient(account, 'Caducada').then((first) => {
        patient(account, 'Siguiente').then((next) => {
          patient(account, 'Ocupa').then((other) => {
            offeredEntry(account, first.id, s, new Date(Date.now() - 60_000).toISOString()).then((expired) => {
              cy.task<{ id: string }>('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: next.id }).then((queued) => {
                appointment(account, other.id, s.startsAt)
                expireSweep()
                cy.task<{ status: string }>('db:waitlistEntryById', { id: expired.id }).its('status').should('eq', 'expired')
                // Nobody is offered a slot that is not there to give.
                cy.task<{ status: string }>('db:waitlistEntryById', { id: queued.id }).its('status').should('eq', 'waiting')
              })
            })
          })
        })
      })
    })
  })

  it('still re-offers an expired offer whose slot is free', () => {
    cy.get('@acct').then((account: any) => {
      const s = slot(3, 13)
      patient(account, 'Caducada').then((first) => {
        patient(account, 'Siguiente').then((next) => {
          offeredEntry(account, first.id, s, new Date(Date.now() - 60_000).toISOString()).then(() => {
            cy.task<{ id: string }>('db:createWaitlistEntry', { accountId: account.accountId, clinicId: account.clinicId, patientId: next.id }).then((queued) => {
              expireSweep()
              cy.task<{ status: string; offered_starts_at: string }>('db:waitlistEntryById', { id: queued.id }).then((row) => {
                expect(row.status).to.eq('offered')
                expect(new Date(row.offered_starts_at).toISOString()).to.eq(s.startsAt)
              })
            })
          })
        })
      })
    })
  })

  // -------------------------------------------------------------- public API

  function apiHeaders(account: any) {
    return cy
      .task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['appointments:write', 'appointments:read'] })
      .then(({ token }) => ({ Authorization: `Bearer ${token}` }))
  }

  const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2031, 1, day, hour, minute)).toISOString()

  it('refuses a PATCH that hands a visit to a practitioner who is busy then', () => {
    cy.get('@acct').then((account: any) => {
      apiHeaders(account).then((headers) => {
        colleague(account, 'Marta Segunda').then((marta) => {
          patient(account, 'Uno').then((p1) => {
            patient(account, 'Dos').then((p2) => {
              appointment(account, p1.id, at(3, 9))
              appointment(account, p2.id, at(3, 9), { practitionerId: marta.teamMemberId }).then((theirs) => {
                cy.request({ method: 'PATCH', url: `/api/public/v1/appointments/${theirs.id}`, headers, failOnStatusCode: false, body: { practitioner_id: account.teamMemberId } }).then((res) => {
                  expect(res.status).to.eq(409)
                  expect(res.body.error.code).to.eq('conflict')
                })
                cy.task<{ practitioner_id: string }>('db:appointmentById', { appointmentId: theirs.id }).its('practitioner_id').should('eq', marta.teamMemberId)

                // Handing it to somebody free at that time is still fine.
                cy.request({ method: 'PATCH', url: `/api/public/v1/appointments/${theirs.id}`, headers, body: { note: 'solo una nota' } }).its('status').should('eq', 200)
              })
            })
          })
        })
      })
    })
  })

  it('refuses a PATCH that un-cancels a visit onto a slot taken since', () => {
    cy.get('@acct').then((account: any) => {
      apiHeaders(account).then((headers) => {
        patient(account, 'Cancelada').then((p1) => {
          patient(account, 'Nueva').then((p2) => {
            appointment(account, p1.id, at(4, 9), { status: 'cancelled' }).then((cancelled) => {
              appointment(account, p2.id, at(4, 9))
              // A note on a cancelled visit is not a booking: no check.
              cy.request({ method: 'PATCH', url: `/api/public/v1/appointments/${cancelled.id}`, headers, body: { note: 'llamó' } }).its('status').should('eq', 200)
              cy.request({ method: 'PATCH', url: `/api/public/v1/appointments/${cancelled.id}`, headers, failOnStatusCode: false, body: { status: 'booked' } }).then((res) => {
                expect(res.status).to.eq(409)
                expect(res.body.error.code).to.eq('conflict')
              })
              cy.task<{ status: string }>('db:appointmentById', { appointmentId: cancelled.id }).its('status').should('eq', 'cancelled')
            })
          })
        })
      })
    })
  })

  it('books a slot once when parallel API calls ask for it at the same instant', () => {
    cy.get('@acct').then((account: any) => {
      apiHeaders(account).then((headers) => {
        patient(account, 'Carrera').then((p) => {
          const bodies = Array.from({ length: 6 }, (_, i) => ({
            patient_id: p.id,
            clinic_id: account.clinicId,
            practitioner_id: account.teamMemberId,
            starts_at: at(5, 9),
            ends_at: at(5, 9, 30),
            note: `carrera ${i}`,
          }))
          cy.task<{ status: number; body: any }[]>('db:requestConcurrently', {
            url: `${Cypress.config('baseUrl')}/api/public/v1/appointments`,
            method: 'POST',
            headers,
            bodies,
          }).then((results) => {
            const statuses = results.map((r) => r.status).sort()
            expect(statuses, JSON.stringify(results.map((r) => r.body))).to.deep.eq([201, 409, 409, 409, 409, 409])
            results.filter((r) => r.status === 409).forEach((r) => expect(r.body.error.code).to.eq('conflict'))
          })
          appointmentsOf(p.id).should('have.length', 1)
        })
      })
    })
  })

  it('moves a visit through the API onto a free slot, and refuses a busy one', () => {
    cy.get('@acct').then((account: any) => {
      apiHeaders(account).then((headers) => {
        patient(account, 'Mueve').then((p1) => {
          patient(account, 'Fijo').then((p2) => {
            appointment(account, p2.id, at(6, 11))
            appointment(account, p1.id, at(6, 9)).then((mine) => {
              cy.request({ method: 'PATCH', url: `/api/public/v1/appointments/${mine.id}`, headers, failOnStatusCode: false, body: { starts_at: at(6, 11), ends_at: at(6, 11, 30) } }).then((res) => {
                expect(res.status).to.eq(409)
                expect(res.body.error.message).to.contain('already has an appointment')
              })
              cy.request({ method: 'PATCH', url: `/api/public/v1/appointments/${mine.id}`, headers, body: { starts_at: at(6, 10), ends_at: at(6, 10, 30) } }).then((res) => {
                expect(res.status).to.eq(200)
                expect(new Date(res.body.data.starts_at).toISOString()).to.eq(at(6, 10))
                expect(res.body.data.rescheduled).to.eq(true)
              })
            })
          })
        })
      })
    })
  })
})
