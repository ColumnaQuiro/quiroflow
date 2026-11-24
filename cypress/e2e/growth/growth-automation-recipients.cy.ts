// Who an automation reaches, beyond the saved list or segment a group send
// could already be aimed at (growth-automation-audiences.cy.ts):
//   * a one-off send to patients chosen one by one -- by hand in the builder
//     or from a selection on the Patients page -- still within consent;
//   * an event-triggered automation limited to whoever is in a list, and not
//     in another, when it fires.
// Every rule is in test mode with one email step, so a start is visible as
// the email it records.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface EmailRow {
  subject: string | null
}

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`
const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

describe('Automations aimed at chosen patients, and limited to a list', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  const tick = () => cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
  const fire = (body: Record<string, unknown>) => cy.request({ method: 'POST', url: '/api/automations/fire', body })
  const emailsFor = (patientId: string) => cy.task<EmailRow[]>('auto:emailsFor', { patientId })
  const subjects = (rows: EmailRow[]) => rows.map((r) => r.subject)

  function patient(firstName: string, extra: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('auto:patient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName,
      lastName: 'Prueba',
      email: `${firstName.toLowerCase()}.${stamp()}@example.test`,
      phone: randomPhone(),
      ...extra,
    })
  }
  function list(name: string) {
    return cy.task<{ id: string }[]>('db:insertRows', { table: 'patient_lists', rows: [{ account_id: account.accountId, name }] }).its('0')
  }
  function addToList(listId: string, patientId: string) {
    return cy.task('db:insertRows', { table: 'patient_list_members', rows: [{ account_id: account.accountId, list_id: listId, patient_id: patientId }] })
  }
  function rule(triggerEvent: string, extra: Record<string, unknown>, subject: string) {
    return cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      triggerEvent,
      dryRun: true,
      steps: [{ type: 'email', config: { subject, body: '<p>Hola {{first_name}}</p>' } }],
      ...extra,
    })
  }

  it('sends once to exactly the chosen patients, and only to those who accepted marketing', () => {
    patient('Ana', { marketingChannels: ['email'] }).then((ana) => {
      patient('Blas', { marketingChannels: [] }).then((blas) => {
        patient('Carla', { marketingChannels: ['email'] }).then((carla) => {
          rule(
            'segment',
            { isMarketing: true, entryMode: 'once_ever', segment: { filters: {}, patient_ids: [ana.id, blas.id], schedule: { kind: 'once' } } },
            'Novedades de la clínica',
          )
          tick()
          tick()
          emailsFor(ana.id).should((rows) => expect(subjects(rows)).to.deep.eq(['Novedades de la clínica']))
          // Chosen, but never agreed to marketing.
          emailsFor(blas.id).should('have.length', 0)
          // Agreed, but not chosen.
          emailsFor(carla.id).should('have.length', 0)
        })
      })
    })
  })

  it('fires an event automation only for whoever is in the list and not in the other', () => {
    list('Empresa colaboradora').then((inside) => {
      list('Ya contactados').then((outside) => {
        patient('Ana').then((ana) => {
          patient('Blas').then((blas) => {
            patient('Carla').then((carla) => {
              addToList(inside.id, ana.id)
              addToList(inside.id, blas.id)
              addToList(outside.id, blas.id)
              rule(
                'appointment.completed',
                { filters: { in_audiences: [{ kind: 'list', id: inside.id }], not_in_audiences: [{ kind: 'list', id: outside.id }] } },
                'Gracias por venir',
              )
              for (const p of [ana, blas, carla]) fire({ triggerEvent: 'appointment.completed', patientId: p.id })
              emailsFor(ana.id).should((rows) => expect(subjects(rows)).to.deep.eq(['Gracias por venir']))
              emailsFor(blas.id).should('have.length', 0)
              emailsFor(carla.id).should('have.length', 0)
            })
          })
        })
      })
    })
  })

  it('opens a one-off send to the patients selected on the Patients page, with who can receive it', () => {
    patient('Alba', { marketingChannels: ['email'] }).then(() => {
      patient('Bruno', { marketingChannels: [] }).then(() => {
        cy.visit('/patients')
        cy.contains('tr', 'Alba Prueba').find('[data-cy=select-row]').check()
        cy.contains('tr', 'Bruno Prueba').find('[data-cy=select-row]').check()
        cy.get('[data-cy=bulk-send]').click()
        cy.location('pathname').should('eq', '/automations/new')
        cy.get('[data-test="broadcast-who"]').should('contain', '2 patients chosen')
        cy.get('[data-test="broadcast-change-who"]').click()
        cy.get('[data-test="segment-who-patients"]').should('have.attr', 'aria-pressed', 'true')
        cy.get('[data-test="segment-patients-chosen"]').should('contain', 'Alba Prueba').and('contain', 'Bruno Prueba')
        // A marketing send: Bruno never agreed, so one of the two receives it.
        cy.get('[data-test="segment-count"]').should('contain', '1')
        cy.get('[data-test="segment-count-left-out"]').should('contain', '1 of the 2 chosen')
      })
    })
  })

  it('adds patients one by one in the builder', () => {
    patient('Dora', { marketingChannels: ['email'] }).then(() => {
      cy.visit('/automations/new?kind=broadcast')
      cy.get('[data-test="broadcast-change-who"]').click()
      cy.get('[data-test="segment-who-patients"]').click()
      cy.get('[data-test="segment-count"]').should('contain', '0')
      cy.get('[data-test="segment-patients-search"]').type('Dora')
      cy.contains('[data-test="segment-patients-result"]', 'Dora Prueba').click()
      cy.get('[data-test="segment-patients-chosen"]').should('contain', 'Dora Prueba')
      cy.get('[data-test="segment-count"]').should('contain', '1')
    })
  })
})
