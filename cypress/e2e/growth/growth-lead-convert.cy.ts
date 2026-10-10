// Converting a lead into a patient -- the only Growth action that writes a
// clinical record, and the only one that is hard to undo.
//
// Most of what matters here is what must NOT happen: a second record for
// someone who is already a patient, a duplicate from a double click, or a
// patient the clinic cannot phone because the number went to the wrong table.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
  roles: { id: string; name: string }[]
}

function apiRequest(options: Partial<Cypress.RequestOptions> & { url: string }) {
  return cy.request({ failOnStatusCode: false, ...options })
}

describe('Converting a lead to a patient', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  it('creates the patient, keeps the attribution, and files the phone where the clinic can use it', () => {
    cy.task('db:createLead', {
      accountId: account.accountId,
      fullName: 'Ainara Quilez Mora',
      stage: 'showed',
      source: 'Meta Ads · Back pain',
      phone: '+34600444901',
    }).then((lead) => {
      const leadId = (lead as { id: string }).id

      cy.visit('/growth/leads?growth=1')
      cy.contains('button', 'Ainara Quilez Mora').click()
      cy.get('[data-test="convert-lead"]').click()

      cy.contains('Patient record created.').should('be.visible')

      cy.task('db:leadById', { id: leadId }).should((row) => {
        expect((row as { stage: string }).stage).to.eq('converted')
      })

      cy.request('/api/growth/leads/' + leadId).its('body.patientId').should('be.a', 'string')
      cy.request('/api/growth/leads/' + leadId).then((res) => {
        cy.task('db:patientWithContacts', { id: res.body.patientId }).should((result) => {
          const { patient, numbers } = result as {
            patient: { first_name: string; last_name: string; referral_source: string; has_phone: boolean }
            numbers: { number: string; is_whatsapp: boolean }[]
          }
          expect(patient.first_name).to.eq('Ainara')
          expect(patient.last_name).to.eq('Quilez Mora')
          // The acquisition story survives on the record itself.
          expect(patient.referral_source).to.eq('Meta Ads · Back pain')

          // The number has to land in patient_contact_numbers -- that table's
          // trigger is what flips has_phone, which recalls and WhatsApp
          // filter on. A patient with only patients.phone set cannot be
          // messaged by any of it.
          expect(numbers).to.have.length(1)
          expect(numbers[0]!.is_whatsapp).to.eq(true)
          expect(patient.has_phone, 'has_phone flipped by the trigger').to.eq(true)
        })
      })
    })
  })

  // A lead is converted because they are about to come in, so the next step
  // is offered right there: book them, or open their record.
  it('offers to book straight after converting, and books for the new patient', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Booking Next', stage: 'showed' }).then((lead) => {
      const leadId = (lead as { id: string }).id

      cy.visit('/growth/leads?growth=1')
      cy.contains('button', 'Booking Next').click()
      cy.get('[data-test="convert-lead"]').click()

      cy.get('[data-test="book-after-convert"]').within(() => {
        cy.contains('Booking Next is now a patient').should('be.visible')
        cy.get('[data-cy="confirm-dialog-confirm"]').should('contain', 'Book appointment').click()
      })

      cy.request('/api/growth/leads/' + leadId).its('body.patientId').then((patientId) => {
        cy.location('pathname').should('eq', '/calendar')
        cy.location('search').should('contain', `patient=${patientId}`)
      })
      cy.get('[data-cy="booking-for"]').should('contain', 'Booking Next')
    })
  })

  it('opens the new patient record when booking can wait', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Later Booking', stage: 'showed' }).then((lead) => {
      const leadId = (lead as { id: string }).id

      cy.visit('/growth/leads?growth=1')
      cy.contains('button', 'Later Booking').click()
      cy.get('[data-test="convert-lead"]').click()
      cy.get('[data-test="book-after-convert"] [data-cy="confirm-dialog-cancel"]').click()

      cy.request('/api/growth/leads/' + leadId).its('body.patientId').then((patientId) => {
        cy.location('pathname').should('eq', `/patients/${patientId}`)
      })
    })
  })

  // These three did nothing at all, on every lead.
  it('makes the drawer footer work -- book a converted lead, message and call any', () => {
    cy.task('db:createLead', {
      accountId: account.accountId,
      fullName: 'Footer Actions',
      stage: 'showed',
      phone: '+34 600 444 902',
    }).then((lead) => {
      const leadId = (lead as { id: string }).id
      cy.request({ method: 'POST', url: `/api/growth/leads/${leadId}/convert` }).its('body.patientId').then((patientId) => {
        cy.visit('/growth/leads?growth=1')
        cy.contains('button', 'Footer Actions').click()

        cy.get('[data-test="lead-call"]').should('have.attr', 'href', 'tel:+34600444902')
        cy.get('[data-test="lead-message"]').should('have.attr', 'href', `/inbox?open=lead:${leadId}`)

        cy.get('[data-test="lead-book"]').click()
        cy.location('pathname').should('eq', '/calendar')
        cy.location('search').should('contain', `patient=${patientId}`)
      })
    })
  })

  it('converts first when "Book appointment" is pressed on a lead who is not a patient yet', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Book First', stage: 'showed' }).then((lead) => {
      const leadId = (lead as { id: string }).id

      cy.visit('/growth/leads?growth=1')
      cy.contains('button', 'Book First').click()
      cy.get('[data-test="lead-book"]').click()

      // Booking was what the click asked for, so it does not ask again.
      cy.location('pathname').should('eq', '/calendar')
      cy.request('/api/growth/leads/' + leadId).its('body.patientId').then((patientId) => {
        cy.location('search').should('contain', `patient=${patientId}`)
      })
      cy.task('db:patientCount', { accountId: account.accountId }).should('eq', 1)
    })
  })

  it('converts and books from the lead\'s thread in the Inbox', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Inbox Convert', stage: 'contacted', phone: '+34600444903' }).then((lead) => {
      const leadId = (lead as { id: string }).id
      cy.task('db:createLeadMessage', { accountId: account.accountId, leadId, direction: 'inbound', body: 'Hola, quiero una cita' })

      cy.visit('/inbox?growth=1')
      cy.contains('[data-test="lead-row"]', 'Inbox Convert').click()
      cy.get('[data-test="lead-thread-convert"]').click()

      cy.get('[data-test="book-after-convert"]').within(() => {
        cy.contains('Inbox Convert is now a patient').should('be.visible')
        cy.get('[data-cy="confirm-dialog-confirm"]').click()
      })

      cy.request('/api/growth/leads/' + leadId).its('body.patientId').then((patientId) => {
        cy.location('pathname').should('eq', '/calendar')
        cy.location('search').should('contain', `patient=${patientId}`)
      })
    })
  })

  it('is idempotent -- converting twice yields one patient, not two', () => {
    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Double Click', stage: 'showed' }).then((lead) => {
      const leadId = (lead as { id: string }).id
      cy.visit('/growth/leads?growth=1')

      // Sent with no body at all, deliberately: that is the shape readBody
      // resolves to undefined for, and it used to 500.
      apiRequest({ method: 'POST', url: `/api/growth/leads/${leadId}/convert` }).then((first) => {
        expect(first.status, 'a body-less convert').to.eq(200)
        expect(first.body.created).to.eq(true)

        apiRequest({ method: 'POST', url: `/api/growth/leads/${leadId}/convert` }).then((second) => {
          expect(second.status).to.eq(200)
          expect(second.body.alreadyConverted, 'second call recognised the lead was done').to.eq(true)
          expect(second.body.patientId, 'same patient, not a new one').to.eq(first.body.patientId)
        })

        cy.task('db:patientCount', { accountId: account.accountId }).should('eq', 1)
      })
    })
  })

  it('stops when the lead is already a patient, and links instead of duplicating', () => {
    cy.task('db:createPatient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Returning',
      lastName: 'Patient',
      email: 'returning@example.com',
    })

    cy.task('db:createLead', {
      accountId: account.accountId,
      fullName: 'Returning Patient',
      stage: 'showed',
      email: 'returning@example.com',
    }).then((lead) => {
      const leadId = (lead as { id: string }).id

      cy.visit('/growth/leads?growth=1')
      cy.contains('button', 'Returning Patient').click()
      cy.get('[data-test="convert-lead"]').click()

      // It declines to guess, and says why.
      cy.get('[data-test="duplicate-warning"]').within(() => {
        cy.contains('This person may already be a patient').should('be.visible')
        cy.contains('Returning Patient').should('be.visible')
        cy.contains('Same email address').should('be.visible')
      })

      // Nothing has been written while the question is open.
      cy.task('db:patientCount', { accountId: account.accountId }).should('eq', 1)

      cy.get('[data-test="link-existing"]').first().click()
      cy.contains('Lead linked to the existing patient.').should('be.visible')

      // One patient, still -- the lead now points at the record that already
      // existed rather than a second copy of it.
      cy.task('db:patientCount', { accountId: account.accountId }).should('eq', 1)
      cy.task('db:leadById', { id: leadId }).should((row) => {
        expect((row as { stage: string }).stage).to.eq('converted')
      })
    })
  })

  it('will still create a second record when a person insists', () => {
    cy.task('db:createPatient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Same',
      lastName: 'Number',
    })
    // Contact numbers are where a phone match is found, so the existing
    // patient needs one.
    cy.task('db:createLead', {
      accountId: account.accountId,
      fullName: 'Same Number',
      stage: 'showed',
      email: 'insist@example.com',
    }).then((lead) => {
      const leadId = (lead as { id: string }).id
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Insist',
        lastName: 'Duplicate',
        email: 'insist@example.com',
      })

      cy.visit('/growth/leads?growth=1')
      cy.contains('button', 'Same Number').click()
      cy.get('[data-test="convert-lead"]').click()

      cy.get('[data-test="duplicate-warning"]').should('be.visible')
      cy.get('[data-test="create-anyway"]').click()

      cy.contains('Patient record created.').should('be.visible')
      // Two existing patients plus the new one: the warning informs, it does
      // not forbid.
      cy.task('db:patientCount', { accountId: account.accountId }).should('eq', 3)
      cy.task('db:leadById', { id: leadId }).should((row) => {
        expect((row as { stage: string }).stage).to.eq('converted')
      })
    })
  })

  it('refuses a role that cannot create patients', () => {
    cy.task('db:setRolePermissions', {
      accountId: account.accountId,
      roleName: 'Practitioner',
      patch: { communication_config: true, patients_scope: 'none' },
    })

    cy.task('db:createLead', { accountId: account.accountId, fullName: 'Needs Clinical Rights', stage: 'showed' }).then((lead) => {
      const leadId = (lead as { id: string }).id
      const email = `prac-convert-${Date.now()}@example.com`

      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email,
        password: 'Practitioner123!',
      })

      // logout() clicks through the account menu, so it needs a page that
      // has one -- beforeEach only signs in.
      cy.visit('/dashboard')
      cy.logout()
      cy.login(email, 'Practitioner123!')
      cy.visit('/dashboard')

      apiRequest({ method: 'POST', url: `/api/growth/leads/${leadId}/convert` }).then((res) => {
        expect(res.status).to.eq(403)
        // And nothing was created on the way to being refused.
        cy.task('db:patientCount', { accountId: account.accountId }).should('eq', 0)
      })
    })
  })
})
