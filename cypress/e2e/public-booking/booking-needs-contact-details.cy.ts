// A booking the clinic cannot answer is worth less than no booking.
//
// Three of the first twenty-six online bookings arrived with no phone number,
// because the form marked only the email required and create_public_booking
// accepted a blank phone in silence.
//
// This tests the RPC rather than the form. `required` on an input stops an
// honest person mid-typing; it stops nothing else. create_public_booking is
// security definer and the anon key can call it directly -- which is exactly
// what this spec does, the way anything not using the form would.
describe('Booking without a way to reach the patient', () => {
  const slot = () => {
    const d = new Date()
    d.setDate(d.getDate() + 3)
    d.setHours(10, 0, 0, 0)
    return d.toISOString()
  }

  function book(overrides: Record<string, unknown>, account: any, typeId: string) {
    return cy.task<{ error: string | null }>('db:callPublicBookingAsAnon', {
      p_account_slug: account.accountSlug,
      p_clinic_id: account.clinicId,
      p_team_member_id: account.teamMemberId,
      p_appointment_type_id: typeId,
      p_starts_at: slot(),
      p_first_name: 'Sin',
      p_last_name: 'Contacto',
      p_email: 'sin.contacto@example.test',
      p_phone: '600111222',
      p_country_code: 'ES',
      p_note: '',
      ...overrides,
    })
  }

  beforeEach(() => {
    cy.seedStaffAccount().as('acct')
    cy.get('@acct').then((account: any) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task('db:createAppointmentType', {
        accountId: account.accountId,
        name: 'Consultation',
        durationMinutes: 30,
        onlineBookingEnabled: true,
      }).as('typeId')
    })
  })

  it('is refused with no phone number', () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@typeId').then((type: any) => {
        book({ p_phone: '   ' }, account, type.id).then((r) => {
          expect(r.error, 'the booking was refused').to.contain('phone number is required')
        })
      })
    })
  })

  // Non-empty was the whole test. On 24 Sep 2026 someone picked +34 and typed
  // "6", which `required` and type="tel" both accept, and the clinic got a
  // confirmed appointment with no way to ring the person who made it.
  describe('with a number that is not one', () => {
    it('is refused for a single digit, which is what actually happened', () => {
      cy.get('@acct').then((account: any) => {
        cy.get('@typeId').then((type: any) => {
          book({ p_phone: '6' }, account, type.id).then((r) => {
            expect(r.error, 'the booking was refused').to.contain('does not look right')
          })
        })
      })
    })

    it('is refused for a dial prefix with nothing behind it', () => {
      cy.get('@acct').then((account: any) => {
        cy.get('@typeId').then((type: any) => {
          book({ p_phone: '+34' }, account, type.id).then((r) => {
            expect(r.error, 'the booking was refused').to.contain('does not look right')
          })
        })
      })
    })

    it('is refused for a Spanish number of the wrong length', () => {
      cy.get('@acct').then((account: any) => {
        cy.get('@typeId').then((type: any) => {
          book({ p_phone: '60012345' }, account, type.id).then((r) => {
            expect(r.error, 'eight digits is not a Spanish number').to.contain('does not look right')
          })
        })
      })
    })

    it('still takes a Spanish number written with its own +34', () => {
      cy.get('@acct').then((account: any) => {
        cy.get('@typeId').then((type: any) => {
          book({ p_phone: '+34 600 123 456' }, account, type.id).then((r) => {
            expect(r.error, 'the prefix is the same number, not extra digits').to.eq(null)
          })
        })
      })
    })

    it('still takes a shorter number from a country where that is the whole number', () => {
      // Eight digits is a complete Norwegian number and two of this clinic's
      // patients have one. Spain's nine is not a rule to apply everywhere.
      cy.get('@acct').then((account: any) => {
        cy.get('@typeId').then((type: any) => {
          book({ p_phone: '40612345', p_country_code: 'NO' }, account, type.id).then((r) => {
            expect(r.error, 'a real Norwegian number goes through').to.eq(null)
          })
        })
      })
    })

    it('still takes a foreign number pasted with the selector left on Spain', () => {
      // A normal thing to do, and judging it by Spain's nine digits would
      // refuse a real number at the last step of a booking.
      cy.get('@acct').then((account: any) => {
        cy.get('@typeId').then((type: any) => {
          book({ p_phone: '+447700900123' }, account, type.id).then((r) => {
            expect(r.error, 'judged by the country the number names').to.eq(null)
          })
        })
      })
    })
  })

  it('is refused with no email, which also keeps it off a stranger\'s record', () => {
    // An empty email is not just missing data. The patient lookup matches on
    // lower(email) = lower(trim(p_email)), so an empty one matches the first
    // patient who has none -- and 670 of this clinic's patients arrived from
    // PracticeHub without one. The booking would land on somebody else.
    cy.get('@acct').then((account: any) => {
      cy.get('@typeId').then((type: any) => {
        book({ p_email: '' }, account, type.id).then((r) => {
          expect(r.error, 'the booking was refused').to.contain('email address is required')
        })
      })
    })
  })

  it('still books when both are given', () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@typeId').then((type: any) => {
        book({}, account, type.id).then((r) => {
          expect(r.error, 'a complete booking goes through').to.eq(null)
        })
      })
    })
  })

  // Booking is converting yourself, and the lead should know.
  //
  // Conversion was a staff action only, so a lead who booked online stayed at
  // 'new' with no patient_id and its drip sequence kept running.
  // sequenceStopReason() compares lead.email to patients.email on the next
  // cron pass -- late, and blind to a typo. Alberto Rueda Mansilla booked on
  // 14 Sep and got a seven-step sequence over the following two days because
  // his lead says ruedamansilla@ and his patient record says rudamansilla@.
  describe('the lead it came from', () => {
    it('is linked and moved to booked, matching on email', () => {
      cy.get('@acct').then((account: any) => {
        cy.get('@typeId').then((type: any) => {
          cy.task('db:createLead', {
            accountId: account.accountId,
            fullName: 'Ana Anuncio',
            stage: 'new',
            channel: 'facebook',
            email: 'ana.anuncio@example.test',
            phone: '34611222333',
          }).then((lead: any) => {
            book({ p_email: 'ana.anuncio@example.test', p_phone: '699888777' }, account, type.id).then((r) => {
              expect(r.error).to.eq(null)
              cy.task('db:leadById', { id: lead.id }).then((after: any) => {
                expect(after.patient_id, 'linked to the patient who booked').to.not.be.null
                expect(after.stage, 'booked, not converted -- they have not attended yet').to.eq('booked')
              })
            })
          })
        })
      })
    })

    it('is linked on the PHONE when the email was mistyped', () => {
      // The case the email-only backstop misses, and the one that actually
      // happened: the lead carries the number from the Meta form, the booking
      // carries the same number typed by hand, and the two emails differ.
      cy.get('@acct').then((account: any) => {
        cy.get('@typeId').then((type: any) => {
          cy.task('db:createLead', {
            accountId: account.accountId,
            fullName: 'Alberto Rueda Mansilla',
            stage: 'new',
            channel: 'facebook',
            email: 'ruedamansilla@example.test',
            phone: '34600445533',
          }).then((lead: any) => {
            book({ p_email: 'rudamansilla@example.test', p_phone: '600 445 533' }, account, type.id).then((r) => {
              expect(r.error).to.eq(null)
              cy.task('db:leadById', { id: lead.id }).then((after: any) => {
                expect(after.patient_id, 'matched on the number, not the address').to.not.be.null
                expect(after.stage).to.eq('booked')
              })
            })
          })
        })
      })
    })

    it('leaves a lead that is already further along where it is', () => {
      cy.get('@acct').then((account: any) => {
        cy.get('@typeId').then((type: any) => {
          cy.task('db:createLead', {
            accountId: account.accountId,
            fullName: 'Ya Convertida',
            stage: 'showed',
            email: 'ya.convertida@example.test',
          }).then((lead: any) => {
            book({ p_email: 'ya.convertida@example.test', p_phone: '600555444' }, account, type.id).then(() => {
              cy.task('db:leadById', { id: lead.id }).then((after: any) => {
                expect(after.stage, 'never moved backwards').to.eq('showed')
                expect(after.patient_id, 'still linked').to.not.be.null
              })
            })
          })
        })
      })
    })
  })
})
