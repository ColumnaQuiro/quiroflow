// Mi día tasks: what an automation's "Avisar" (notify) step leaves in the
// Tareas section of My Day, besides the push -- who can see one, who can tick
// it off, and that it follows the patient through a merge.
//
// The step runs inside the automation engine (growth-automation-engine covers
// the rest of it), fired here through /api/automations/fire.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
  teamMemberId: string
}

interface Task {
  id: string
  account_id: string
  team_member_id: string | null
  role_id: string | null
  patient_id: string | null
  title: string
  due_at: string | null
  done_at: string | null
  done_by: string | null
  rule_id: string | null
  run_id: string | null
}

interface RunEvent {
  outcome: string
  detail: string | null
}

const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

describe('Mi día tasks from automations', () => {
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

  function fire(body: Record<string, unknown>) {
    return cy.request({ method: 'POST', url: '/api/automations/fire', body })
  }

  function patient(extra: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('auto:patient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Ana',
      lastName: 'Tarea',
      phone: randomPhone(),
      ...extra,
    })
  }

  function notifyRule(config: Record<string, unknown>, opts: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('auto:createFlowRule', {
      accountId: account.accountId,
      name: 'Avisar a Recepción',
      triggerEvent: 'appointment.no_show',
      dryRun: false,
      steps: [{ type: 'notify', config }],
      ...opts,
    })
  }

  const tasks = (ruleId: string) => cy.task<Task[]>('auto:tasksFor', { ruleId })

  function staffOnRole(roleName: string, label: string) {
    const email = `${label.toLowerCase().replace(/\s+/g, '-')}-${stamp()}@example.test`
    const password = 'Test1234!'
    return cy
      .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName, email, password, fullName: label })
      .then((m) => ({ email, password, teamMemberId: m.teamMemberId }))
  }

  it('leaves a task for the person, with the patient and the automation, and still pushes', () => {
    notifyRule({ to: { team_member_id: account.teamMemberId }, title: 'Llamar a {{first_name}}' }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.no_show', patientId: p.id })
        tasks(rule.id).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]!.title).to.eq('Llamar a Ana')
          expect(rows[0]!.team_member_id).to.eq(account.teamMemberId)
          expect(rows[0]!.role_id).to.be.null
          expect(rows[0]!.patient_id).to.eq(p.id)
          expect(rows[0]!.account_id).to.eq(account.accountId)
          expect(rows[0]!.run_id).to.be.a('string')
          expect(rows[0]!.done_at).to.be.null
        })
        cy.task<{ id: string }[]>('auto:runsForRule', { ruleId: rule.id }).then((runs) => {
          cy.task<RunEvent[]>('db:runEvents', { runId: runs[0]!.id }).then((ev) => {
            expect(ev[1]!.outcome).to.eq('applied')
            expect(ev[1]!.detail).to.eq('Notified 1 team member(s) on 0 device(s). Created 1 Mi día task(s).')
          })
        })

        // In Mi día: the title, the patient (a link to the record) and which
        // automation asked; ticking it off records who did.
        cy.visit('/practitioner')
        cy.get('[data-cy="my-day-tasks"]').should('be.visible')
        cy.get('[data-cy="my-day-task"]').should('have.length', 1).first().as('task')
        cy.get('@task').find('[data-cy="my-day-task-title"]').should('have.text', 'Llamar a Ana')
        cy.get('@task').should('contain.text', 'Avisar a Recepción')
        cy.get('@task').find('[data-cy="my-day-task-patient"]').should('have.attr', 'href', `/patients/${p.id}`).and('contain.text', 'Ana Tarea')
        cy.get('@task').find('[data-cy="my-day-task-toggle"]').click()
        cy.get('@task').find('[data-cy="my-day-task-title"]').should('have.class', 'line-through')
        tasks(rule.id).should((rows) => {
          expect(rows[0]!.done_at).to.be.a('string')
          expect(rows[0]!.done_by).to.eq(account.teamMemberId)
        })

        // Reloaded, it is still there for the rest of the day, done.
        cy.reload()
        cy.get('[data-cy="my-day-task-title"]').should('have.class', 'line-through')
        cy.get('[data-cy="my-day-task-toggle"]').click()
        tasks(rule.id).its('0.done_at').should('be.null')

        cy.get('[data-cy="my-day-task-patient"]').click()
        cy.location('pathname').should('eq', `/patients/${p.id}`)
      })
    })
  })

  it('a role gets one task that everyone in it sees and any of them can tick off -- and nobody else', () => {
    staffOnRole('Front Desk', 'Recepcion Uno').then((desk1) => {
      staffOnRole('Front Desk', 'Recepcion Dos').then((desk2) => {
        staffOnRole('Practitioner', 'Fisio Fuera').then((other) => {
          cy.task<{ id: string } | null>('db:roleByName', { accountId: account.accountId, name: 'Front Desk' }).then((role) => {
            notifyRule({ to: { role_id: role!.id }, title: 'Llamar para reprogramar' }).then((rule) => {
              patient().then((p) => {
                fire({ triggerEvent: 'appointment.no_show', patientId: p.id })
                tasks(rule.id).then((rows) => {
                  expect(rows).to.have.length(1)
                  expect(rows[0]!.role_id).to.eq(role!.id)
                  expect(rows[0]!.team_member_id).to.be.null
                  const taskId = rows[0]!.id

                  cy.task<{ ids: string[] }>('auto:tasksAsStaff', desk1).its('ids').should('include', taskId)
                  cy.task<{ ids: string[] }>('auto:tasksAsStaff', desk2).its('ids').should('include', taskId)
                  cy.task<{ ids: string[] }>('auto:tasksAsStaff', other).its('ids').should('not.include', taskId)
                  // The owner is not in the role, and a role's task is not theirs.
                  cy.task<{ ids: string[] }>('auto:tasksAsStaff', { email: account.email, password: account.password }).its('ids').should('not.include', taskId)

                  // Someone outside the role cannot tick it off.
                  cy.task('auto:taskWriteAsStaff', { ...other, taskId, patch: { done_at: new Date().toISOString() } }).its('rows').should('eq', 0)
                  // Nobody can rewrite it: only done_at / done_by are writable.
                  cy.task<{ rows: number; error: string | null }>('auto:taskWriteAsStaff', { ...desk1, taskId, patch: { title: 'Otra cosa' } }).then((res) => {
                    expect(res.rows).to.eq(0)
                    expect(res.error).to.match(/permission denied/)
                  })
                  // And who did it is stamped by the database, whatever the client claims.
                  cy.task('auto:taskWriteAsStaff', { ...desk2, taskId, patch: { done_at: new Date().toISOString(), done_by: desk1.teamMemberId } }).its('rows').should('eq', 1)
                  tasks(rule.id).then((after) => {
                    expect(after[0]!.title).to.eq('Llamar para reprogramar')
                    expect(after[0]!.done_at).to.be.a('string')
                    expect(after[0]!.done_by).to.eq(desk2.teamMemberId)
                  })
                })
              })
            })
          })
        })
      })
    })
  })

  it('makes no task when the step says so, or in test mode', () => {
    notifyRule({ to: { team_member_id: account.teamMemberId }, title: 'Solo aviso', create_task: false }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.no_show', patientId: p.id })
        tasks(rule.id).should('have.length', 0)
        cy.task<{ id: string; status: string }[]>('auto:runsForRule', { ruleId: rule.id }).then((runs) => {
          expect(runs[0]!.status).to.eq('done')
          cy.task<RunEvent[]>('db:runEvents', { runId: runs[0]!.id }).its('1.detail').should('eq', 'Notified 1 team member(s) on 0 device(s).')
        })
      })
    })
    notifyRule({ to: { team_member_id: account.teamMemberId }, title: 'Prueba' }, { triggerEvent: 'appointment.checked_in', dryRun: true }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.checked_in', patientId: p.id })
        tasks(rule.id).should('have.length', 0)
      })
    })
  })

  it('sets a due time when the step asks for one, and only for people in this clinic', () => {
    cy.seedStaffAccount().then((stranger) => {
      notifyRule({ to: { team_member_id: (stranger as unknown as SeededAccount).teamMemberId }, title: 'Ajeno' }).then((rule) => {
        patient().then((p) => {
          fire({ triggerEvent: 'appointment.no_show', patientId: p.id })
          tasks(rule.id).should('have.length', 0)
        })
      })
    })
    notifyRule({ to: { team_member_id: account.teamMemberId }, title: 'Hoy', due_in_minutes: 120 }, { triggerEvent: 'appointment.checked_in' }).then((rule) => {
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.checked_in', patientId: p.id })
        tasks(rule.id).then((rows) => {
          const due = new Date(rows[0]!.due_at!).getTime()
          expect(due).to.be.within(Date.now() + 110 * 60_000, Date.now() + 125 * 60_000)
        })
      })
    })
  })

  it('a merge moves the tasks and the birthday guard onto the surviving record', () => {
    notifyRule({ to: { team_member_id: account.teamMemberId }, title: 'Llamar' }).then((rule) => {
      patient({ firstName: 'Superviviente' }).then((survivor) => {
        patient({ firstName: 'Duplicado' }).then((duplicate) => {
          fire({ triggerEvent: 'appointment.no_show', patientId: duplicate.id })
          tasks(rule.id).its('0.patient_id').should('eq', duplicate.id)
          // One day both records were greeted on, and one only the duplicate was.
          for (const [patientId, localDate] of [
            [survivor.id, '2026-03-01'],
            [duplicate.id, '2026-03-01'],
            [duplicate.id, '2025-03-01'],
          ]) {
            cy.task('auto:insertBirthdaySend', { accountId: account.accountId, ruleId: rule.id, patientId, localDate })
          }
          cy.task('auto:mergeAsStaff', { email: account.email, password: account.password, survivorId: survivor.id, duplicateId: duplicate.id }).its('staff_tasks').should('eq', 1)
          tasks(rule.id).its('0.patient_id').should('eq', survivor.id)
          cy.task<{ local_date: string }[]>('auto:birthdaySends', { patientId: survivor.id }).then((rows) => {
            expect(rows.map((r) => r.local_date)).to.deep.eq(['2025-03-01', '2026-03-01'])
          })
        })
      })
    })
  })
})
