// A new clinic brings its patients and appointments across with nothing but
// the saved PracticeHub connection -- no CSV exports. Run against a stub that
// answers like PracticeHub's Classic API did on 30 Oct 2026.
//
// The three things the CSV route got wrong are what this pins down:
// - a patient with a custom reference (DNI, passport) is stored under their
//   patient number, which every later step matches on;
// - their join date is PracticeHub's, not the day of the import;
// - an appointment at 17:30 in PracticeHub is at 17:30 in the clinic, not
//   at 17:30 UTC or wherever the browser happened to be.
describe('Importing from PracticeHub without exporting anything', () => {
  const routes = {
    '/patients': [
      {
        id: 1,
        patient_number: '202400007',
        custom_reference: 'X4188023T',
        first_name: 'Lucía',
        last_name: 'Ferrer',
        email: 'lucia.ferrer@example.test',
        dob: '1990-04-02',
        created: '2024-03-05T09:15:00.000000Z',
        balance: '0.00',
        locale: 'es',
        note: null,
        numbers: [{ number: '600 11 22 33', type: 'Mobile', iso2: 'es' }],
        communication_preferences: { marketing: { sms: 1, email: 0 } },
        default_practitioners: [],
        referral_source_type: null,
        referral_source_id: null,
      },
    ],
    '/practitioners': [{ id: 9, first_name: 'Marta', last_name: 'Ruiz' }],
    '/referral_sources': [],
    '/appointment_types': [{ id: 3, name: 'Ajuste' }],
    '/appointments': [
      { id: 7001, patient_id: 1, practitioner_id: 9, appointment_type_id: 3, start: '2026-08-06 17:30:00', end: '2026-08-06 18:00:00', status: 'processed', note: null },
    ],
  }

  afterEach(() => {
    cy.task('db:stopPracticeHubStub')
  })

  it('reads patients and appointments straight from the saved connection', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ baseUrl: string }>('db:startPracticeHubStub', { routes }).then(({ baseUrl }) => {
        cy.task('db:setPracticeHubConnection', { accountId: account.accountId, baseUrl })
        cy.login(account.email, account.password)

        const patientsStatus = '[data-cy=import-step][data-step=patients] [data-cy=import-step-status]'
        cy.visit('/settings/import?source=practicehub&step=patients&type=patients')
        cy.get('[data-cy=import-settings][data-ready=true]')
        cy.get(patientsStatus).should('have.text', 'Nothing imported yet')
        cy.get('[data-cy=ph-patients-from-api]').should('not.be.disabled').click()
        cy.contains('button', /^(Import 1, update 0|Importar 1, actualizar 0)$/).click()
        cy.contains('a', /View patients|Ver pacientes/).should('exist')
        // The step list catches up by itself: no reload.
        cy.get(patientsStatus).should('have.text', '1 imported')

        cy.task<{ external_reference: string; created_at: string; marketing_channels: string[] }[]>('db:selectRows', {
          table: 'patients',
          columns: 'external_reference, created_at, marketing_channels',
          match: { account_id: account.accountId, email: 'lucia.ferrer@example.test' },
        }).then(([patient]) => {
          expect(patient.external_reference).to.eq('202400007')
          expect(new Date(patient.created_at).toISOString()).to.eq('2024-03-05T09:15:00.000Z')
          expect(patient.marketing_channels).to.deep.eq(['sms'])
        })

        // On to the next step from the panel itself, not by hunting through
        // the step list: Patients -> Appointment types -> Appointments. A
        // step that has just written gets the primary button.
        cy.get('[data-cy=import-next-step]').should('have.class', 'bg-brand').click()
        cy.get('[data-cy=import-panel] h2').should('have.text', 'Appointment types')
        cy.get('[data-cy=import-next-step]').should('not.have.class', 'bg-brand').click()
        cy.get('[data-cy=import-panel] h2').should('have.text', 'Appointments')
        cy.location('search').should('contain', 'type=appointments')
        // Patients read the patient list a moment ago, so this step says it
        // will reuse it...
        cy.get('[data-cy=ph-reads-held]').should('be.visible')
        cy.get('[data-cy=ph-appointments-from-api]').should('not.be.disabled').click()
        cy.contains('button', /^(Continue|Continuar)$/).click()
        cy.contains('button', /^(Import 1, update 0|Importar 1, actualizar 0)$/).click()
        cy.contains('a', /View calendar|Ver calendario/).should('exist')
        cy.get('[data-cy=import-step][data-step=appointments] [data-cy=import-step-status]').should('have.text', '1 imported')
        // ...and did: PracticeHub was asked for its patients and
        // practitioners once, by Patients, not again by Appointments.
        cy.task<Record<string, number>>('db:practiceHubStubHits').then((hits) => {
          expect(hits['/patients']).to.eq(1)
          expect(hits['/practitioners']).to.eq(1)
          expect(hits['/appointments']).to.eq(1)
        })

        cy.task<{ starts_at: string; practitioner_name: string; status: string }[]>('db:selectRows', {
          table: 'appointments',
          columns: 'starts_at, practitioner_name, status',
          match: { account_id: account.accountId, external_reference: '7001' },
        }).then(([appointment]) => {
          // 17:30 in Madrid in August.
          expect(new Date(appointment.starts_at).toISOString()).to.eq('2026-08-06T15:30:00.000Z')
          expect(appointment.practitioner_name).to.eq('Marta Ruiz')
          expect(appointment.status).to.eq('completed')
        })
      })
    })
  })

  it('says in the Connection step what the saved key reaches, and names a refused key', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ baseUrl: string }>('db:startPracticeHubStub', { routes }).then(({ baseUrl }) => {
        cy.task('db:setPracticeHubConnection', { accountId: account.accountId, baseUrl })
        cy.login(account.email, account.password)
        cy.visit('/settings/import?source=practicehub&type=general')
        cy.get('[data-cy=ph-check]').click()
        cy.get('[data-cy=ph-check-result]').should('have.text', '1 patients · 1 appointments · Marta Ruiz')
      })
      // The same connection, once PracticeHub refuses its key: the Connection
      // step says so in words, and so does a step that tries to read, rather
      // than "PracticeHub API request failed" in both.
      cy.task<{ baseUrl: string }>('db:startPracticeHubStub', { routes, refuse: 'key' }).then(({ baseUrl }) => {
        cy.task('db:setPracticeHubConnection', { accountId: account.accountId, baseUrl })
        cy.visit('/settings/import?source=practicehub&type=general')
        cy.get('[data-cy=ph-check]').click()
        cy.get('[data-cy=ph-check-error]').should('contain.text', 'PracticeHub refused the API key')
        cy.get('[data-cy=import-next-step]').click()
        cy.get('[data-cy=ph-patients-from-api]').click()
        cy.contains('PracticeHub refused the API key').should('be.visible')
      })
    })
  })

  it('starts every other step from the saved connection, without asking for the key again', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ baseUrl: string }>('db:startPracticeHubStub', { routes }).then(({ baseUrl }) => {
        cy.task('db:setPracticeHubConnection', { accountId: account.accountId, baseUrl })
        cy.login(account.email, account.password)
        cy.visit('/settings/import?source=practicehub&step=appointment_types&type=appointment_types')
        cy.get('input[type=password]').should('not.exist')
        cy.get('[data-cy=ph-use-saved-connection]').click()
        // A type PracticeHub uses comes across; nothing asked for a key.
        cy.contains('td', 'Ajuste').should('be.visible')
      })
    })
  })
})
