// Saved audiences (patient lists and segments, from Patients) in automations:
// a one-off send aimed at a list, less another; and "Enters a list or
// segment", which counts only who comes in after it is switched on unless it
// is told to take the current members too. Both are enrolled by the
// 15-minute tick; every rule is in test mode with one email step, so a start
// is visible as the email it records.

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

describe('Automations aimed at lists and segments', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  const tick = () => cy.request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
  const emailsFor = (patientId: string) => cy.task<EmailRow[]>('auto:emailsFor', { patientId })

  function patient(firstName: string) {
    return cy.task<{ id: string }>('auto:patient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName,
      lastName: 'Prueba',
      email: `${firstName.toLowerCase()}.${stamp()}@example.test`,
      phone: randomPhone(),
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

  it('sends once to a list, leaving out whoever is in the excluded one', () => {
    list('Interesados en el taller').then((include) => {
      list('Ya inscritos').then((exclude) => {
        patient('Ana').then((ana) => {
          patient('Blas').then((blas) => {
            addToList(include.id, ana.id)
            addToList(include.id, blas.id)
            addToList(exclude.id, blas.id)
            rule('segment', { entryMode: 'once_ever', segment: { filters: {}, audience: { kind: 'list', id: include.id }, exclude: [{ kind: 'list', id: exclude.id }], schedule: { kind: 'once' } } }, 'Plazas para el taller')
            tick()
            tick()
            emailsFor(ana.id).should((rows) => expect(rows.map((r) => r.subject)).to.deep.eq(['Plazas para el taller']))
            emailsFor(blas.id).should('have.length', 0)
          })
        })
      })
    })
  })

  it('counts only who enters after it is switched on, once each', () => {
    list('Pilates').then((l) => {
      patient('Ana').then((before) => {
        addToList(l.id, before.id)
        rule('audience.entered', { filters: { trigger_audience: { kind: 'list', id: l.id } } }, 'Bienvenida a Pilates')
        // The first tick only notes where it starts: Ana was already there.
        tick()
        patient('Blas').then((after) => {
          addToList(l.id, after.id)
          tick()
          tick()
          emailsFor(after.id).should((rows) => expect(rows.map((r) => r.subject)).to.deep.eq(['Bienvenida a Pilates']))
          emailsFor(before.id).should('have.length', 0)
        })
      })
    })
  })

  it('takes the people already in it when told to', () => {
    list('Embarazadas').then((l) => {
      patient('Ana').then((p) => {
        addToList(l.id, p.id)
        rule('audience.entered', { filters: { trigger_audience: { kind: 'list', id: l.id }, include_current: true } }, 'Ejercicios para el embarazo')
        tick()
        tick()
        emailsFor(p.id).should((rows) => expect(rows.map((r) => r.subject)).to.deep.eq(['Ejercicios para el embarazo']))
      })
    })
  })

  it('opens a new one-off send as a checklist, from its own tab', () => {
    list('Boletín').then(() => {
      cy.visit('/automations?view=sends')
      cy.get('[data-test="empty-sends"]').should('be.visible')
      cy.get('[data-test="new-send"]').click()
      cy.get('[data-test="broadcast-checklist"]').should('be.visible')
      cy.get('[data-test="broadcast-message"]').should('contain', 'Email')
      cy.get('[data-test="broadcast-change-who"]').click()
      cy.get('[data-test="segment-who-saved"]').click()
      cy.get('[data-test="segment-audience"]').find('option').contains('Boletín').then((opt) => {
        cy.get('[data-test="segment-audience"]').select(opt.val() as string)
      })
      cy.get('[data-test="segment-count"]').should('contain', '0')
      cy.get('[data-test="broadcast-who"]').should('contain', 'Boletín')
      // The canvas is one click away for a send that grows follow-ups.
      cy.get('[data-test="broadcast-show-flow"]').click()
      cy.get('[data-test="node-trigger"]').should('be.visible')
    })
  })
})
