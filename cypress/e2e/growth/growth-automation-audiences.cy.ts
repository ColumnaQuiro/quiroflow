// Saved audiences (patient lists and segments, from Patients) and dates on
// the record in automations: a one-off send aimed at a list, less another;
// "Enters a list or segment", which counts only who comes in after it is
// switched on unless told to take the current members too; and "A date on
// the record", before a date field or after the last visit. All are enrolled
// by the 15-minute tick; every rule is in test mode with one email step, so a
// start is visible as the email it records.

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

  // "A date on the record" starts from 9:00 clinic time. A fixed-offset zone
  // where it is about midday now keeps the spec meaningful whenever it runs;
  // "today" below is that zone's date.
  function clinicAtMidday() {
    const offset = Math.max(-12, Math.min(14, 12 - new Date().getUTCHours()))
    const zone = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
    const today = new Date(Date.now() + offset * 3600 * 1000).toISOString().slice(0, 10)
    return cy.task('auto:setClinicTimezone', { clinicId: account.clinicId, timezone: zone }).then(() => ({ zone, today, offset }))
  }
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }

  it('starts some days before a date field of the clinic\'s own, once that day', () => {
    clinicAtMidday().then(({ today }) => {
      cy.task<{ id: string }[]>('db:insertRows', { table: 'patient_attributes', rows: [{ account_id: account.accountId, label: 'Fecha prevista de parto', key: `parto_${stamp().slice(-6)}`, section: 'clinical', kind: 'date' }] }).its('0').then((field) => {
        patient('Ana').then((due) => {
          patient('Bea').then((later) => {
            cy.task('db:insertRows', { table: 'patient_attribute_values', rows: [
              { account_id: account.accountId, patient_id: due.id, attribute_id: field.id, value: shift(today, 7) },
              { account_id: account.accountId, patient_id: later.id, attribute_id: field.id, value: shift(today, 8) },
            ] })
            rule('patient.date', { filters: { trigger_date: `field:${field.id}`, trigger_days: 7, trigger_when: 'before' } }, 'Una semana para el parto')
            tick()
            tick()
            emailsFor(due.id).should((rows) => expect(rows.map((r) => r.subject)).to.deep.eq(['Una semana para el parto']))
            emailsFor(later.id).should('have.length', 0)
          })
        })
      })
    })
  })

  it('starts some days after the last visit, only for whoever has not been back', () => {
    clinicAtMidday().then(({ today, offset }) => {
      // Midday clinic time, that many days ago, as UTC.
      const middayOn = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - offset * 3600 * 1000).toISOString()
      const visit = (patientId: string, date: string) => cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, startsAt: middayOn(date), status: 'completed' })
      patient('Ana').then((gone) => {
        patient('Bea').then((back) => {
          visit(gone.id, shift(today, -10))
          visit(back.id, shift(today, -10))
          visit(back.id, shift(today, -3))
          rule('patient.date', { filters: { trigger_date: 'last_visit', trigger_days: 10 } }, 'Hace tiempo que no te vemos')
          tick()
          tick()
          emailsFor(gone.id).should((rows) => expect(rows.map((r) => r.subject)).to.deep.eq(['Hace tiempo que no te vemos']))
          emailsFor(back.id).should('have.length', 0)
        })
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
