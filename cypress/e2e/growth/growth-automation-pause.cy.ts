// Pausing an automation pauses everything in it.
//
// Nobody new enters -- that was always true -- and the people already inside
// stop too: they wait at the step they are on, sending nothing, and carry on
// from that same step when it is switched back on. Until this, the tick never
// looked at whether a rule was on, so a paused automation went on messaging
// everybody already in it while Settings said they "stay where they are".
//
// Sends are asserted through dry run, as in growth-automation-engine.cy.ts.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface Run {
  id: string
  status: string
  next_position: number
  current_action_id: string | null
  waiting_for: string | null
  branch_taken: string | null
  resume_at: string
}

interface RunEvent {
  outcome: string
  detail: string | null
}

const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const HOUR = 3600 * 1000
const MINUTE = 60 * 1000

describe('Pausing an automation', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  const whatsapp = (template: string) => ({ type: 'whatsapp_template', config: { template_name: template, template_language: 'es' } })
  const delay = (minutes: number) => ({ type: 'delay', config: { delay_minutes: minutes } })

  function fire(body: Record<string, unknown>) {
    return cy.request({ method: 'POST', url: '/api/automations/fire', body })
  }

  function tick() {
    return cy
      .request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
      .its('status')
      .should('eq', 200)
  }

  function patient() {
    return cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paula', lastName: 'Pausa', phone: randomPhone() })
  }

  function flow(opts: Record<string, unknown>) {
    return cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, ...opts })
  }

  // The column the list's toggle and Settings' Pause write. Directly, since
  // switching on through the endpoint also checks the steps' templates exist,
  // which is not what this spec is about.
  function setEnabled(ruleId: string, enabled: boolean) {
    return cy.task('auto:setRuleEnabled', { ruleId, enabled })
  }

  const templates = (patientId: string) => cy.task<{ template_name: string }[]>('auto:whatsappFor', { patientId }).then((rows) => rows.map((r) => r.template_name))
  const runs = (ruleId: string) => cy.task<Run[]>('auto:runsForRule', { ruleId })
  const events = (runId: string) => cy.task<RunEvent[]>('db:runEvents', { runId })

  it('holds the people inside at their step, and carries them on from it when switched back on', () => {
    flow({
      triggerEvent: 'appointment.completed',
      steps: [whatsapp('primera'), delay(1440), whatsapp('segunda'), delay(1440), whatsapp('tercera')],
    }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id })
        templates(p.id).should('deep.eq', ['primera'])

        setEnabled(rule.id, false)
        // The delay ends while it is paused -- long ago, as far as the tick
        // can tell -- and the tick leaves the run exactly where it was.
        cy.task('auto:makeRunsDue', { ruleId: rule.id, minutesAgo: 3 * 24 * 60 })
        tick()
        tick()
        templates(p.id).should('deep.eq', ['primera'])
        runs(rule.id).then((rs) => {
          expect(rs).to.have.length(1)
          expect(rs[0]!.status).to.eq('running')
          expect(rs[0]!.next_position).to.eq(2)
          expect(rs[0]!.waiting_for).to.eq('delay')
          // Nothing was even attempted.
          events(rs[0]!.id).then((ev) => expect(ev.map((e) => e.outcome)).to.deep.eq(['started', 'dry_run', 'waiting']))
        })

        // Switched on: the next step, not the first one again and not all
        // the rest at once -- the second delay still waits.
        setEnabled(rule.id, true)
        tick()
        templates(p.id).should('deep.eq', ['primera', 'segunda'])
        runs(rule.id).then((rs) => {
          expect(rs[0]!.status).to.eq('running')
          expect(rs[0]!.next_position).to.eq(4)
          expect(new Date(rs[0]!.resume_at).getTime()).to.be.greaterThan(Date.now() + 23 * HOUR)
        })
      })
    })
  })

  it('lets nobody new in, from a trigger or from Launch', () => {
    flow({ triggerEvent: 'appointment.completed', enabled: false, steps: [whatsapp('primera'), delay(60), whatsapp('segunda')] }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body').should('deep.eq', { fired: 0 })
        cy.request({ method: 'POST', url: '/api/automations/send-now', body: { ruleId: rule.id, patientId: p.id }, failOnStatusCode: false }).then((res) => {
          expect(res.status).to.eq(409)
          expect(res.body.statusMessage).to.match(/paused/i)
        })
        templates(p.id).should('deep.eq', [])
        runs(rule.id).should('have.length', 0)
      })
    })
  })

  it('keeps what a waiting person did while paused, and takes that path when switched back on', () => {
    flow({
      triggerEvent: 'appointment.completed',
      steps: [
        {
          type: 'wait_until',
          config: { event: 'appointment.booked', timeout_minutes: 4320 },
          met: [whatsapp('gracias_por_reservar')],
          timeout: [whatsapp('te_echamos_de_menos')],
        },
      ],
    }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id })
        runs(rule.id).its(0).its('waiting_for').should('eq', 'appointment.booked')

        setEnabled(rule.id, false)
        // They book while it is paused. Nothing is sent, but the booking is
        // not forgotten: on resume they must not get "we miss you".
        fire({ triggerEvent: 'appointment.booked', patientId: p.id })
        templates(p.id).should('deep.eq', [])
        runs(rule.id).then((rs) => {
          expect(rs[0]!.status).to.eq('running')
          expect(rs[0]!.waiting_for).to.eq(null)
          expect(rs[0]!.branch_taken).to.eq('met')
        })
        tick()
        templates(p.id).should('deep.eq', [])

        setEnabled(rule.id, true)
        tick()
        templates(p.id).should('deep.eq', ['gracias_por_reservar'])
        runs(rule.id).its(0).its('status').should('eq', 'done')
      })
    })
  })

  it('takes a Skip while paused as where to wait, and sends nothing until switched back on', () => {
    flow({ triggerEvent: 'appointment.completed', steps: [whatsapp('primera'), delay(1440), whatsapp('segunda')] }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id })
        setEnabled(rule.id, false)
        runs(rule.id).then((rs) => {
          cy.request({ method: 'POST', url: `/api/automations/runs/${rs[0]!.id}/skip` }).its('body.status').should('eq', 'running')
        })
        templates(p.id).should('deep.eq', ['primera'])
        tick()
        templates(p.id).should('deep.eq', ['primera'])

        setEnabled(rule.id, true)
        tick()
        templates(p.id).should('deep.eq', ['primera', 'segunda'])
      })
    })
  })

  describe('a reminder that came due while paused', () => {
    // "30 hours before: remind; 24 hours later: remind again (6 hours
    // before)". Paused across the visit, the second reminder is about a visit
    // that has already happened: it is skipped, not sent late.
    const reminder = {
      triggerEvent: 'appointment.hours_before',
      filters: { hours_before: 30 },
      steps: [whatsapp('recordatorio_30h'), delay(1440), whatsapp('recordatorio_6h')],
    }

    function remindedFor(after: (ruleId: string, patientId: string, appointmentId: string) => void) {
      flow(reminder).then((rule) => {
        patient().then((p) => {
          cy.task<{ id: string }>('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: p.id,
            startsAt: new Date(Date.now() + 30 * HOUR + 5 * MINUTE).toISOString(),
          }).then((appt) => {
            cy.request({ method: 'POST', url: '/api/automations/hours-before-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
            templates(p.id).should('deep.eq', ['recordatorio_30h'])
            after(rule.id, p.id, appt.id)
          })
        })
      })
    }

    it('skips a step that was due before the visit once the visit has started', () => {
      remindedFor((ruleId, patientId, appointmentId) => {
        setEnabled(ruleId, false)
        // The second reminder came due an hour ago; the visit began ten
        // minutes ago. Then it is switched back on.
        cy.task('auto:makeRunsDue', { ruleId, minutesAgo: 60 })
        cy.task('auto:setAppointmentStart', { appointmentId, startsAt: new Date(Date.now() - 10 * MINUTE).toISOString() })
        setEnabled(ruleId, true)
        tick()

        templates(patientId).should('deep.eq', ['recordatorio_30h'])
        runs(ruleId).then((rs) => {
          expect(rs[0]!.status).to.eq('done')
          events(rs[0]!.id).then((ev) => {
            expect(ev.map((e) => e.outcome)).to.deep.eq(['started', 'dry_run', 'waiting', 'skipped', 'finished'])
            expect(ev[3]!.detail).to.match(/already started/)
          })
        })
      })
    })

    it('still sends a step that was due after the visit began', () => {
      // The boundary: a step meant for after the start of the visit is not
      // late, and goes out as it always did.
      remindedFor((ruleId, patientId, appointmentId) => {
        cy.task('auto:setAppointmentStart', { appointmentId, startsAt: new Date(Date.now() - 10 * MINUTE).toISOString() })
        cy.task('auto:makeRunsDue', { ruleId, minutesAgo: 1 })
        tick()
        templates(patientId).should('deep.eq', ['recordatorio_30h', 'recordatorio_6h'])
      })
    })

    it('sends it as normal when switched back on before the visit', () => {
      remindedFor((ruleId, patientId) => {
        setEnabled(ruleId, false)
        cy.task('auto:makeRunsDue', { ruleId, minutesAgo: 60 })
        tick()
        templates(patientId).should('deep.eq', ['recordatorio_30h'])
        setEnabled(ruleId, true)
        tick()
        templates(patientId).should('deep.eq', ['recordatorio_30h', 'recordatorio_6h'])
      })
    })
  })
})
