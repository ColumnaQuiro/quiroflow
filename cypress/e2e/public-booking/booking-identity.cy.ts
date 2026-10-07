// Who an online booking is FOR, decided from what the person typed.
//
// create_public_booking is security definer and the anon key can call it, so
// everything below is a claim made by whoever is at the keyboard. It used to
// take the email as proof of identity on its own:
//
//   - a known email booked onto that patient's record and then filed the
//     caller's phone number against them -- the number the clinic's
//     confirmations and reminders then went to;
//   - "existing patients only" was satisfied by typing any address a patient
//     of the clinic has;
//   - a lead was moved to booked, and linked to the patient, by the last nine
//     digits of a phone number alone.
//
// What still has to work is the real returning patient: same email, same
// number, booked straight onto their own record.
describe('Online booking identity', () => {
  let n = 0
  // A different hour for each booking, so none of them collide on the
  // practitioner's calendar.
  const slot = () => {
    const d = new Date()
    d.setDate(d.getDate() + 3)
    d.setHours(8 + (n++ % 10), 0, 0, 0)
    return d.toISOString()
  }

  function book(account: any, typeId: string, overrides: Record<string, unknown>) {
    return cy.task<{ error: string | null; data: any }>('db:callPublicBookingAsAnon', {
      p_account_slug: account.accountSlug,
      p_clinic_id: account.clinicId,
      p_team_member_id: account.teamMemberId,
      p_appointment_type_id: typeId,
      p_starts_at: slot(),
      p_first_name: 'Lucía',
      p_last_name: 'Habitual',
      p_email: 'lucia.habitual@example.test',
      p_phone: '600111222',
      p_country_code: 'ES',
      p_note: '',
      ...overrides,
    })
  }

  const appointmentPatient = (appointmentId: string) =>
    cy.task<any[]>('db:selectRows', { table: 'appointments', columns: 'patient_id', match: { id: appointmentId } }).then((rows) => rows[0].patient_id as string)
  const numbersOf = (patientId: string) =>
    cy.task<any[]>('db:selectRows', { table: 'patient_contact_numbers', columns: 'number', match: { patient_id: patientId } }).then((rows) => rows.map((r) => r.number))
  const notesOf = (appointmentId: string) =>
    cy.task<any[]>('db:selectRows', { table: 'visit_notes', columns: 'body', match: { appointment_id: appointmentId } }).then((rows) => rows.map((r) => r.body as string))

  beforeEach(() => {
    n = 0
    cy.seedStaffAccount().as('acct')
    cy.get('@acct').then((account: any) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId, everyDay: true })
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consulta', durationMinutes: 30, onlineBookingEnabled: true }).as('anyType')
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Revisión', durationMinutes: 30, onlineBookingEnabled: true }).then((t) => {
        cy.task('db:setAppointmentTypeBookingRules', { id: t.id, bookableBy: 'existing_patients' })
        cy.wrap(t).as('existingType')
      })
      cy.task<{ id: string }>('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Lucía',
        lastName: 'Habitual',
        email: 'lucia.habitual@example.test',
        phone: '600111222',
      }).as('patient')
    })
  })

  it('books a returning patient onto their own record, however they space their number', () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@existingType').then((type: any) => {
        cy.get('@patient').then((patient: any) => {
          book(account, type.id, { p_email: 'Lucia.Habitual@example.test', p_phone: '600 111 222' }).then((r) => {
            expect(r.error, 'an existing patient books an existing-patients type').to.eq(null)
            appointmentPatient(r.data.appointment_id).should('eq', patient.id)
          })
          numbersOf(patient.id).should('deep.eq', ['600111222'])
        })
      })
    })
  })

  it('does not file a stranger\'s number against the patient whose email was typed', () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@anyType').then((type: any) => {
        cy.get('@patient').then((patient: any) => {
          book(account, type.id, { p_phone: '699000999', p_first_name: 'Otra', p_last_name: 'Persona' }).then((r) => {
            expect(r.error, 'the booking itself still goes through').to.eq(null)
            // The record's numbers are what confirmations and reminders go to.
            numbersOf(patient.id).should('deep.eq', ['600111222'])
            // But the clinic still has the number it was given, on the visit.
            notesOf(r.data.appointment_id).then((notes) => {
              expect(notes.join('\n'), 'the number given is kept on the appointment').to.contain('699000999')
            })
          })
        })
      })
    })
  })

  it('does not let a known email alone open an "existing patients" type', () => {
    cy.get('@acct').then((account: any) => {
      cy.get('@existingType').then((type: any) => {
        book(account, type.id, { p_phone: '699000999' }).then((r) => {
          expect(r.error, 'email matches, phone does not').to.contain('only available to existing patients')
        })
        book(account, type.id, { p_email: 'nadie@example.test' }).then((r) => {
          // Same words either way: the refusal must not say which half was
          // right, or it becomes a way to test addresses.
          expect(r.error, 'phone matches, email does not').to.contain('only available to existing patients')
        })
      })
    })
  })

  it('picks the family member whose number was given when they share an email', () => {
    cy.get('@acct').then((account: any) => {
      cy.task<{ id: string }>('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Pablo',
        lastName: 'Habitual',
        email: 'lucia.habitual@example.test',
        phone: '600333444',
      }).then((son) => {
        cy.get('@existingType').then((type: any) => {
          book(account, type.id, { p_first_name: 'Pablo', p_phone: '600333444' }).then((r) => {
            expect(r.error).to.eq(null)
            appointmentPatient(r.data.appointment_id).should('eq', son.id)
          })
        })
      })
    })
  })

  describe('the lead it came from', () => {
    it('is not moved by a phone number alone', () => {
      cy.get('@acct').then((account: any) => {
        cy.get('@anyType').then((type: any) => {
          cy.task<{ id: string }>('db:createLead', {
            accountId: account.accountId,
            fullName: 'Marta Anuncio',
            stage: 'new',
            channel: 'facebook',
            email: 'marta.anuncio@example.test',
            phone: '34622333444',
          }).then((lead) => {
            book(account, type.id, { p_first_name: 'Desconocido', p_last_name: 'Cualquiera', p_email: 'otro@example.test', p_phone: '622 333 444' }).then((r) => {
              expect(r.error).to.eq(null)
              cy.task<any>('db:leadById', { id: lead.id }).then((after) => {
                expect(after.stage, 'somebody else typed her number').to.eq('new')
                expect(after.patient_id, 'and was not linked to her lead').to.eq(null)
              })
            })
          })
        })
      })
    })

    it('is moved by the phone number when the name agrees too, accents aside', () => {
      cy.get('@acct').then((account: any) => {
        cy.get('@anyType').then((type: any) => {
          cy.task<{ id: string }>('db:createLead', {
            accountId: account.accountId,
            fullName: 'Ramon Anuncio',
            stage: 'new',
            channel: 'facebook',
            email: 'ramon.anuncio@example.test',
            phone: '34622555666',
          }).then((lead) => {
            book(account, type.id, { p_first_name: 'Ramón', p_last_name: 'Anuncio', p_email: 'ramon.tecleado.mal@example.test', p_phone: '622555666' }).then((r) => {
              expect(r.error).to.eq(null)
              cy.task<any>('db:leadById', { id: lead.id }).then((after) => {
                expect(after.stage).to.eq('booked')
                expect(after.patient_id).to.not.eq(null)
              })
            })
          })
        })
      })
    })
  })
})
