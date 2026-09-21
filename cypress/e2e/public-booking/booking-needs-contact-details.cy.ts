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
})
