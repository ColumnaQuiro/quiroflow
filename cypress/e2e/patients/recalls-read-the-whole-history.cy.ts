import type { StaffAccount } from '../../support/commands'

// Two things the recall queue and the care-plan alerts got wrong.
//
// 1. Both views run with the caller's permissions (security_invoker), so for a
//    practitioner who sees only their own patients the appointments inside
//    them were narrowed too: "last visit" and "already booked" were computed
//    from that practitioner's own visits alone. A patient of theirs booked
//    next week with a colleague showed as overdue and unbooked, and a visit
//    with a colleague last week did not count as their last visit.
//
// 2. Archiving a patient says it stops reminders, but an archived patient
//    stayed in both lists.
//
// The rows a person gets back are still only patients they may see; what
// changed is that the facts about those patients are read from every visit.

const PASSWORD = 'Test1234!'
const DAY = 86400000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString()

function member(account: StaffAccount, roleName: string, label: string) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
  return cy
    .task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName, email, password: PASSWORD, fullName: label })
    .then((m) => ({ email, password: PASSWORD, teamMemberId: m.teamMemberId }))
}

function rowsOf(who: { email: string; password: string }, view: string, columns: string, ids: string[]) {
  return cy
    .task<{ rows: Record<string, any>[]; error: string | null }>('db:selectAsStaff', { email: who.email, password: who.password, table: view, columns, inColumn: 'patient_id', inValues: ids })
    .then((r) => {
      expect(r.error, `${view} read`).to.eq(null)
      return r.rows
    })
}

describe('Recalls and care-plan alerts', () => {
  it("count a colleague's visits for a practitioner who sees only their own patients", () => {
    cy.seedStaffAccount().then((account) => {
      member(account, 'Practitioner', 'Prac').then((prac) => {
        member(account, 'Practitioner', 'Colega').then((colleague) => {
          const patient = (firstName: string) =>
            cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Recall', defaultPractitionerId: prac.teamMemberId })
          const visit = (patientId: string, startsAt: string, practitionerId: string, status = 'completed') =>
            cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, startsAt, practitionerId, status })

          patient('Reservada').then((booked) => {
            patient('Reciente').then((recent) => {
              patient('Pendiente').then((due) => {
                // Lapsed with me, booked next week with a colleague: not a recall.
                visit(booked.id, ago(120), prac.teamMemberId)
                visit(booked.id, ahead(7), colleague.teamMemberId, 'booked')
                // Seen by a colleague ten days ago: that is the last visit.
                visit(recent.id, ago(120), prac.teamMemberId)
                visit(recent.id, ago(10), colleague.teamMemberId)
                // Lapsed and nothing booked: a recall, as before.
                visit(due.id, ago(120), prac.teamMemberId)

                const ids = [booked.id, recent.id, due.id]
                rowsOf(prac, 'recall_candidates', 'patient_id, days_since_last_appointment', ids).then((rows) => {
                  const byId = Object.fromEntries(rows.map((r) => [r.patient_id, r]))
                  expect(byId[booked.id], 'booked with a colleague').to.eq(undefined)
                  expect(byId[due.id], 'lapsed and unbooked').to.not.eq(undefined)
                  expect(byId[recent.id]?.days_since_last_appointment, 'last visit was with the colleague').to.eq(10)
                })

                // The same answers for the owner, who always saw everything.
                rowsOf(account, 'recall_candidates', 'patient_id', ids).then((rows) => {
                  expect(rows.map((r) => r.patient_id).sort()).to.deep.equal([recent.id, due.id].sort())
                })
              })
            })
          })

          // Care plans: the same two facts, plus visits completed in the plan.
          patient('PlanReservado').then((planBooked) => {
            patient('PlanCompartido').then((planShared) => {
              for (const p of [planBooked, planShared]) {
                cy.task('db:insertRows', {
                  table: 'care_plans',
                  rows: [{ account_id: account.accountId, patient_id: p.id, name: 'Plan', frequency_value: 2, frequency_unit: 'week', total_visits: 10, started_at: ago(200).slice(0, 10) }],
                })
              }
              visit(planBooked.id, ago(100), prac.teamMemberId)
              visit(planBooked.id, ahead(5), colleague.teamMemberId, 'booked')
              visit(planShared.id, ago(100), prac.teamMemberId)
              visit(planShared.id, ago(50), colleague.teamMemberId)

              rowsOf(prac, 'care_plan_continuity_alerts', 'patient_id, completed_in_plan, last_appointment_at', [planBooked.id, planShared.id]).then((rows) => {
                expect(rows.map((r) => r.patient_id), 'booked with a colleague is not overdue').to.deep.equal([planShared.id])
                expect(rows[0].completed_in_plan, "both visits count toward the plan").to.eq(2)
                expect(new Date(rows[0].last_appointment_at).getTime()).to.be.closeTo(new Date(ago(50)).getTime(), DAY)
              })
            })
          })

          // And nothing of a patient the practitioner cannot see.
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ajena', lastName: 'Recall' }).then((stranger) => {
            visit(stranger.id, ago(120), colleague.teamMemberId)
            rowsOf(prac, 'recall_candidates', 'patient_id', [stranger.id]).should('have.length', 0)
            rowsOf(account, 'recall_candidates', 'patient_id', [stranger.id]).should('have.length', 1)
            cy.task<{ data: unknown[] | null; error: string | null }>('db:rpcAsStaff', { email: prac.email, password: prac.password, fn: 'patient_visit_facts' }).then((r) => {
              expect(r.error).to.eq(null)
              expect((r.data ?? []).map((f: any) => f.patient_id), 'no visit facts about a stranger').to.not.include(stranger.id)
            })
          })
        })
      })
    })
  })

  it('leave out an archived patient', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Archivada', lastName: 'Recall' }).then((archived) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Activa', lastName: 'Recall' }).then((active) => {
          for (const p of [archived, active]) {
            cy.task('db:insertRows', {
              table: 'care_plans',
              rows: [{ account_id: account.accountId, patient_id: p.id, name: 'Plan', frequency_value: 2, frequency_unit: 'week', total_visits: 10, started_at: ago(200).slice(0, 10) }],
            })
            cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: ago(100), status: 'completed' })
          }
          cy.task('db:updateRows', { table: 'patients', values: { status: 'inactive' }, match: { id: archived.id } })

          rowsOf(account, 'recall_candidates', 'patient_id', [archived.id, active.id]).then((rows) => {
            expect(rows.map((r) => r.patient_id)).to.deep.equal([active.id])
          })
          rowsOf(account, 'care_plan_continuity_alerts', 'patient_id', [archived.id, active.id]).then((rows) => {
            expect(rows.map((r) => r.patient_id)).to.deep.equal([active.id])
          })
        })
      })
    })
  })
})
