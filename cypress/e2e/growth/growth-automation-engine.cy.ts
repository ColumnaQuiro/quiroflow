// The automation engine: rules that wait, branch, wait for something to
// happen, tag, notify, move a lead -- and the settings around them (entry
// mode, exit events, quiet hours, scheduled segments).
//
// Everything a rule does before this engine existed is pinned by the
// characterization specs (growth-automation-fire, -schedules,
// -server-triggers, growth-lead-sequences) and has to stay green; this spec
// covers what is new. Sends are asserted through dry run, as there.
//
// Runs are advanced by lead-sequence-cron, the tick already scheduled in
// production -- there is deliberately no new cron.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
  teamMemberId: string
}

interface WhatsAppRow {
  status: string
  template_name: string
  appointment_id: string | null
}

interface Run {
  id: string
  status: string
  stopped_reason: string | null
  patient_id: string | null
  lead_id: string | null
  waiting_for: string | null
  branch_taken: string | null
  resume_at: string
}

interface RunEvent {
  outcome: string
  step_label: string | null
  detail: string | null
}

const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const HOUR = 3600 * 1000

describe('Automation engine', () => {
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

  function fire(body: Record<string, unknown>) {
    return cy.request({ method: 'POST', url: '/api/automations/fire', body })
  }

  function tick() {
    return cy
      .request({ method: 'POST', url: '/api/automations/lead-sequence-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
      .its('status')
      .should('eq', 200)
  }

  function patient(extra: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('auto:patient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Elena',
      lastName: 'Motor',
      phone: randomPhone(),
      ...extra,
    })
  }

  function flow(opts: Record<string, unknown>) {
    return cy.task<{ id: string }>('auto:createFlowRule', { accountId: account.accountId, ...opts })
  }

  const templates = (patientId: string) => cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId }).then((rows) => rows.map((r) => r.template_name))
  const runs = (ruleId: string) => cy.task<Run[]>('auto:runsForRule', { ruleId })
  const events = (runId: string) => cy.task<RunEvent[]>('db:runEvents', { runId })

  it('waits at a delay in a patient rule, then sends the rest from the tick', () => {
    flow({
      triggerEvent: 'appointment.completed',
      steps: [whatsapp('primera'), { type: 'delay', config: { delay_minutes: 1440 } }, whatsapp('segunda')],
    }).then((rule) => {
      patient().then((p) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: new Date().toISOString() }).then((appt) => {
          fire({ triggerEvent: 'appointment.completed', patientId: p.id, appointmentId: appt.id })
          templates(p.id).should('deep.eq', ['primera'])
          runs(rule.id).then((rs) => {
            expect(rs).to.have.length(1)
            expect(rs[0]!.status).to.eq('running')
            expect(rs[0]!.waiting_for).to.eq('delay')
            expect(new Date(rs[0]!.resume_at).getTime()).to.be.greaterThan(Date.now() + 23 * HOUR)
            events(rs[0]!.id).then((ev) => expect(ev.map((e) => e.outcome)).to.deep.eq(['started', 'dry_run', 'waiting']))
          })

          // Not due yet: the tick leaves it alone.
          tick()
          templates(p.id).should('deep.eq', ['primera'])

          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          tick()
          templates(p.id).should('deep.eq', ['primera', 'segunda'])
          cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
            // The later step still knows which appointment the run is about.
            expect(rows[1]!.appointment_id).to.eq(appt.id)
          })
          runs(rule.id).then((rs) => {
            expect(rs[0]!.status).to.eq('done')
            events(rs[0]!.id).then((ev) => expect(ev.map((e) => e.outcome)).to.deep.eq(['started', 'dry_run', 'waiting', 'dry_run', 'finished']))
          })
        })
      })
    })
  })

  it('takes the yes or the no side of a branch, depending on the person', () => {
    flow({
      triggerEvent: 'appointment.completed',
      steps: [
        {
          type: 'branch',
          config: { match: 'all', conditions: [{ field: 'tags', op: 'contains', value: 'vip' }] },
          yes: [whatsapp('para_vip')],
          no: [whatsapp('para_el_resto'), { type: 'tag', config: { mode: 'add', tag: 'seguimiento' } }],
        },
      ],
    }).then((rule) => {
      patient({ tags: ['Cliente VIP'] }).then((vip) => {
        patient({ tags: [] }).then((other) => {
          fire({ triggerEvent: 'appointment.completed', patientId: vip.id })
          fire({ triggerEvent: 'appointment.completed', patientId: other.id })
          templates(vip.id).should('deep.eq', ['para_vip'])
          templates(other.id).should('deep.eq', ['para_el_resto'])
          runs(rule.id).then((rs) => {
            expect(rs.map((r) => r.status)).to.deep.eq(['done', 'done'])
            expect(rs.find((r) => r.patient_id === vip.id)!.branch_taken).to.eq('yes')
            expect(rs.find((r) => r.patient_id === other.id)!.branch_taken).to.eq('no')
          })
          // The tag step is test mode too: nothing changed.
          cy.task('auto:patientTags', { patientId: other.id }).should('deep.eq', [])
        })
      })
    })
  })

  it('tags and untags a patient, and says so in the history', () => {
    flow({
      triggerEvent: 'appointment.completed',
      dryRun: false,
      steps: [
        { type: 'tag', config: { mode: 'add', tag: 'Reactivar' } },
        { type: 'tag', config: { mode: 'remove', tag: 'dormido' } },
      ],
    }).then((rule) => {
      patient({ tags: ['Dormido', 'vip'] }).then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id })
        cy.task('auto:patientTags', { patientId: p.id }).should('deep.eq', ['vip', 'Reactivar'])
        runs(rule.id).then((rs) => {
          events(rs[0]!.id).then((ev) => {
            expect(ev.map((e) => e.outcome)).to.deep.eq(['started', 'applied', 'applied', 'finished'])
            expect(ev[1]!.detail).to.contain('Added the tag "Reactivar"')
            expect(ev[2]!.detail).to.contain('Removed the tag "dormido"')
          })
        })
      })
    })
  })

  describe('waiting for something to happen', () => {
    const waitForBooking = {
      triggerEvent: 'appointment.completed',
      steps: [
        {
          type: 'wait_until',
          config: { event: 'appointment.booked', timeout_minutes: 4320 },
          met: [whatsapp('gracias_por_reservar')],
          timeout: [whatsapp('te_echamos_de_menos')],
        },
      ],
    }

    it('takes the met path the moment the event happens', () => {
      flow(waitForBooking).then((rule) => {
        patient().then((p) => {
          fire({ triggerEvent: 'appointment.completed', patientId: p.id })
          runs(rule.id).then((rs) => {
            expect(rs[0]!.status).to.eq('running')
            expect(rs[0]!.waiting_for).to.eq('appointment.booked')
          })
          templates(p.id).should('deep.eq', [])

          fire({ triggerEvent: 'appointment.booked', patientId: p.id })
          templates(p.id).should('deep.eq', ['gracias_por_reservar'])
          runs(rule.id).then((rs) => {
            expect(rs[0]!.status).to.eq('done')
            expect(rs[0]!.branch_taken).to.eq('met')
            events(rs[0]!.id).then((ev) => expect(ev.map((e) => e.outcome)).to.deep.eq(['started', 'waiting', 'met', 'dry_run', 'finished']))
          })
        })
      })
    })

    it('takes the timeout path when the deadline passes first', () => {
      flow(waitForBooking).then((rule) => {
        patient().then((p) => {
          fire({ triggerEvent: 'appointment.completed', patientId: p.id })
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          tick()
          templates(p.id).should('deep.eq', ['te_echamos_de_menos'])
          runs(rule.id).then((rs) => {
            expect(rs[0]!.status).to.eq('done')
            expect(rs[0]!.branch_taken).to.eq('timeout')
          })
          // A booking after the timeout has nothing left to wake.
          fire({ triggerEvent: 'appointment.booked', patientId: p.id })
          templates(p.id).should('deep.eq', ['te_echamos_de_menos'])
        })
      })
    })
  })

  it('notifies the chosen team member', () => {
    flow({
      triggerEvent: 'appointment.no_show',
      dryRun: false,
      steps: [{ type: 'notify', config: { to: { team_member_id: account.teamMemberId }, title: 'Llamar al paciente' } }],
    }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.no_show', patientId: p.id })
        runs(rule.id).then((rs) => {
          expect(rs[0]!.status).to.eq('done')
          events(rs[0]!.id).then((ev) => {
            expect(ev[1]!.outcome).to.eq('applied')
            // No device is registered in e2e, so the push reaches none.
            // And, by default, a task in their Mi día (growth-automation-tasks).
            expect(ev[1]!.detail).to.eq('Notified 1 team member(s) on 0 device(s). Created 1 Mi día task(s).')
          })
        })
      })
    })
  })

  describe('entry mode', () => {
    const parked = [whatsapp('hola'), { type: 'delay', config: { delay_minutes: 60 } }, whatsapp('adios')]

    it('one at a time: not while a run is still going', () => {
      flow({ triggerEvent: 'appointment.completed', entryMode: 'one_at_a_time', steps: parked }).then((rule) => {
        patient().then((p) => {
          fire({ triggerEvent: 'appointment.completed', patientId: p.id })
          fire({ triggerEvent: 'appointment.completed', patientId: p.id })
          runs(rule.id).should('have.length', 1)
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          tick()
          fire({ triggerEvent: 'appointment.completed', patientId: p.id })
          runs(rule.id).then((rs) => expect(rs.map((r) => r.status)).to.deep.eq(['done', 'running']))
        })
      })
    })

    it('once ever: never twice', () => {
      flow({ triggerEvent: 'appointment.completed', entryMode: 'once_ever', steps: [whatsapp('solo_una_vez')] }).then((rule) => {
        patient().then((p) => {
          fire({ triggerEvent: 'appointment.completed', patientId: p.id })
          fire({ triggerEvent: 'appointment.completed', patientId: p.id })
          runs(rule.id).should('have.length', 1)
          templates(p.id).should('deep.eq', ['solo_una_vez'])
        })
      })
    })
  })

  it('leaves the automation on an exit event, and sends nothing more', () => {
    flow({
      triggerEvent: 'appointment.completed',
      exitOn: ['appointment.booked'],
      steps: [whatsapp('reserva_ya'), { type: 'delay', config: { delay_minutes: 1440 } }, whatsapp('ultima_oportunidad')],
    }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id })
        fire({ triggerEvent: 'appointment.booked', patientId: p.id })
        runs(rule.id).then((rs) => {
          expect(rs[0]!.status).to.eq('cancelled')
          expect(rs[0]!.stopped_reason).to.eq('exited')
        })
        cy.task('auto:makeRunsDue', { ruleId: rule.id })
        tick()
        templates(p.id).should('deep.eq', ['reserva_ya'])
      })
    })
  })

  it('holds a message outside quiet hours until the window opens', () => {
    // A one-hour window that does not contain "now" in Madrid.
    const madridHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
    const window = madridHour < 12 ? { from: '20:00', to: '21:00' } : { from: '05:00', to: '06:00' }
    cy.task('auto:setClinicTimezone', { clinicId: account.clinicId, timezone: 'Europe/Madrid' })
    flow({ triggerEvent: 'appointment.completed', quietHours: window, steps: [whatsapp('en_horario')] }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id })
        templates(p.id).should('deep.eq', [])
        runs(rule.id).then((rs) => {
          expect(rs[0]!.status).to.eq('running')
          expect(new Date(rs[0]!.resume_at).getTime()).to.be.greaterThan(Date.now())
          events(rs[0]!.id).then((ev) => {
            expect(ev.map((e) => e.outcome)).to.deep.eq(['started', 'deferred'])
            expect(ev[1]!.detail).to.contain('Quiet hours')
          })
        })
      })
    })
  })

  it('enrols a scheduled segment from the tick, honouring filters and consent', () => {
    flow({
      triggerEvent: 'segment',
      segment: { filters: { tag_contains: 'recall' }, schedule: { kind: 'once', starts_at: new Date(Date.now() - 60_000).toISOString() } },
      steps: [whatsapp('te_esperamos')],
    }).then((rule) => {
      patient({ tags: ['recall-2026'] }).then((match) => {
        patient({ tags: ['otro'] }).then((notTagged) => {
          patient({ tags: ['recall'], doNotContact: true }).then((noContact) => {
            tick()
            runs(rule.id).then((rs) => {
              expect(rs.map((r) => r.patient_id)).to.deep.eq([match.id])
            })
            templates(match.id).should('deep.eq', ['te_esperamos'])
            templates(notTagged.id).should('deep.eq', [])
            templates(noContact.id).should('deep.eq', [])
            // 'once' means once.
            tick()
            runs(rule.id).should('have.length', 1)
          })
        })
      })
    })
  })

  it('moves a run to the surviving record when two patients are merged', () => {
    flow({ triggerEvent: 'appointment.completed', steps: [whatsapp('uno'), { type: 'delay', config: { delay_minutes: 60 } }, whatsapp('dos')] }).then((rule) => {
      patient({ firstName: 'Superviviente' }).then((survivor) => {
        patient({ firstName: 'Duplicada' }).then((duplicate) => {
          fire({ triggerEvent: 'appointment.completed', patientId: duplicate.id })
          cy.task('auto:mergeAsStaff', { email: account.email, password: account.password, survivorId: survivor.id, duplicateId: duplicate.id }).then((moved) => {
            expect((moved as Record<string, number>).automation_sequence_runs).to.eq(1)
          })
          runs(rule.id).then((rs) => {
            expect(rs).to.have.length(1)
            expect(rs[0]!.patient_id).to.eq(survivor.id)
            expect(rs[0]!.status).to.eq('running')
          })
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          tick()
          templates(survivor.id).should('deep.eq', ['uno', 'dos'])
        })
      })
    })
  })

  it('refuses to write rules for a member without communication settings', () => {
    cy.task<{ email: string; password: string }>('db:createTeamMemberWithRole', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      roleName: 'Practitioner',
      email: `practitioner-${Date.now()}@example.test`,
      password: 'Test1234!',
    }).then((member) => {
      cy.task<{ inserted: number; error: string | null; readable: number }>('auto:insertRuleAsStaff', { email: member.email, password: member.password, accountId: account.accountId }).then((res) => {
        expect(res.inserted).to.eq(0)
        expect(res.error).to.contain('row-level security')
      })
      // The owner, who has the permission, still can -- and the member can
      // still read what exists (the sidebar badge reads rules).
      cy.task<{ inserted: number; error: string | null; readable: number }>('auto:insertRuleAsStaff', { email: account.email, password: account.password, accountId: account.accountId }).then((res) => {
        expect(res.error).to.be.null
        expect(res.inserted).to.eq(1)
      })
      cy.task<{ inserted: number; readable: number }>('auto:insertRuleAsStaff', { email: member.email, password: member.password, accountId: account.accountId }).its('readable').should('be.greaterThan', 0)
    })
  })

  describe('lead steps', () => {
    let token: string

    beforeEach(() => {
      cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['leads:write'] }).then((t) => {
        token = t.token
      })
    })

    function ingest(body: Record<string, unknown>) {
      return cy.request({ method: 'POST', url: '/api/public/v1/leads', headers: { Authorization: `Bearer ${token}` }, body: { marketing_consent: true, ...body } })
    }

    const leadFlow = () =>
      flow({
        triggerEvent: 'lead.created',
        dryRun: false,
        entryMode: 'once_ever',
        steps: [
          { type: 'lead_assign', config: { team_member_id: account.teamMemberId } },
          { type: 'delay', config: { delay_minutes: 60 } },
          { type: 'lead_stage', config: { stage: 'contacted' } },
        ],
      })

    it('moves and assigns a lead with Growth, on the lead timeline', () => {
      leadFlow().then((rule) => {
        ingest({ full_name: 'Lead Pasos', phone: '+34600955001', external_id: `steps-${Date.now()}` }).then((res) => {
          const leadId = res.body.data.id
          cy.task<{ stage: string; owner_team_member_id: string | null }>('auto:leadRow', { id: leadId }).then((lead) => {
            expect(lead.owner_team_member_id).to.eq(account.teamMemberId)
            expect(lead.stage).to.eq('new')
          })
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          tick()
          cy.task<{ stage: string }>('auto:leadRow', { id: leadId }).its('stage').should('eq', 'contacted')
          cy.task<{ kind: string; title: string }[]>('db:leadEvents', { leadId }).then((evs) => {
            expect(evs.some((e) => e.kind === 'stage_change' && e.title === 'Moved to Contacted')).to.eq(true)
          })
        })
      })
    })

    it('carries on a drip left mid-way by the previous code from its position, sending nothing twice', () => {
      // The migration applies on merge, while production still runs the
      // previous code until the next release. That code advances runs by
      // next_position and never touches current_action_id, so by the time
      // this code runs, the backfilled current_action_id can point at a step
      // already sent. On the root chain next_position has to win.
      cy.task<{ id: string }>('db:createAutomationRule', {
        accountId: account.accountId,
        triggerEvent: 'lead.created',
        enabled: false,
        dryRun: true,
        isMarketing: true,
        actions: [whatsapp('drip_1'), { type: 'delay', config: { delay_minutes: 60 } }, whatsapp('drip_2'), { type: 'delay', config: { delay_minutes: 60 } }, whatsapp('drip_3')],
      }).then((rule) => {
        ingest({ full_name: 'Lead Heredado', phone: '+34600955003', external_id: `legacy-${Date.now()}` }).then((res) => {
          const leadId = res.body.data.id
          // Parked at the second delay (next_position 4), with a stale cursor
          // pointing at drip_2 (position 2), which was sent long ago.
          cy.task<{ id: string }>('auto:insertRun', { accountId: account.accountId, ruleId: rule.id, leadId, nextPosition: 4, currentActionPosition: 2 }).then((run) => {
            tick()
            cy.task<{ template_name: string }[]>('db:leadMessages', { leadId }).then((msgs) => {
              expect(msgs.map((m) => m.template_name)).to.deep.eq(['drip_3'])
            })
            events(run.id).then((ev) => expect(ev.map((e) => e.outcome)).to.deep.eq(['dry_run', 'finished']))
          })
        })
      })
    })

    it('does not touch the lead once Growth is gone', () => {
      leadFlow().then((rule) => {
        ingest({ full_name: 'Lead Sin Growth', phone: '+34600955002', external_id: `nogrowth-${Date.now()}` }).then((res) => {
          const leadId = res.body.data.id
          // A trial includes Growth, so "gone" is an active plan without it.
          cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: false })
          cy.setSubscriptionStatus(account.accountId, 'active')
          cy.task('auto:makeRunsDue', { ruleId: rule.id })
          tick()
          cy.task<{ stage: string }>('auto:leadRow', { id: leadId }).its('stage').should('eq', 'new')
          runs(rule.id).then((rs) => {
            expect(rs[0]!.status).to.eq('cancelled')
            expect(rs[0]!.stopped_reason).to.eq('not_entitled')
          })
        })
      })
    })
  })
})
