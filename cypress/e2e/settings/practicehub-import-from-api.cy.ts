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

        cy.visit('/settings/import?source=practicehub&step=patients&type=patients')
        cy.get('[data-cy=ph-patients-from-api]').should('not.be.disabled').click()
        cy.contains('button', /^(Import 1, update 0|Importar 1, actualizar 0)$/).click()
        cy.contains('a', /View Patients|Ver pacientes/).should('exist')

        cy.task<{ external_reference: string; created_at: string; marketing_channels: string[] }[]>('db:selectRows', {
          table: 'patients',
          columns: 'external_reference, created_at, marketing_channels',
          match: { account_id: account.accountId, email: 'lucia.ferrer@example.test' },
        }).then(([patient]) => {
          expect(patient.external_reference).to.eq('202400007')
          expect(new Date(patient.created_at).toISOString()).to.eq('2024-03-05T09:15:00.000Z')
          expect(patient.marketing_channels).to.deep.eq(['sms'])
        })

        cy.visit('/settings/import?source=practicehub&step=appointments&type=appointments')
        cy.get('[data-cy=ph-appointments-from-api]').should('not.be.disabled').click()
        cy.contains('button', /^(Continue|Continuar)$/).click()
        cy.contains('button', /^(Import 1, update 0|Importar 1, actualizar 0)$/).click()
        cy.contains('a', /View Calendar|Ver calendario/).should('exist')

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
