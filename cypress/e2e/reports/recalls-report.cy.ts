// Reports › Recalls (pages/reports/recalls.vue, utils/recallReport.ts): a
// recall rule reaches three patients on WhatsApp; one books, one replies and
// does not, one says nothing. The report counts them per rule and lists each
// with their status. A reminder rule's messages are not a recall, so they are
// left out unless someone picks the rule.
describe('Recalls report', () => {
  it('counts who each recall reached, replied and booked, and lists them', () => {
    cy.seedStaffAccount().then((account) => {
      const ago = (days: number, hours = 0) => new Date(Date.now() - days * 86_400_000 + hours * 3_600_000).toISOString()
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'automation_rules',
        rows: [
          { account_id: account.accountId, name: 'Reactivación de prueba', trigger_event: 'segment', enabled: true, entry_mode: 'one_at_a_time' },
          { account_id: account.accountId, name: 'Recordatorio de prueba', trigger_event: 'appointment.hours_before', enabled: true, entry_mode: 'every_time' },
        ],
      }).then(([recall, reminder]) => {
        const mk = (first: string) => cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Recall' })
        mk('Ana').then((ana) =>
          mk('Bruno').then((bruno) =>
            mk('Carla').then((carla) => {
              const sent = (p: string, rule: string) => ({ account_id: account.accountId, patient_id: p, phone_number: '34600000009', wamid: `wamid.rc${Math.random()}`, direction: 'outbound', status: 'delivered', body_preview: 'Hace tiempo que no te vemos', channel: 'whatsapp', rule_id: rule, created_at: ago(5) })
              cy.task('db:insertRows', {
                table: 'whatsapp_messages',
                rows: [
                  sent(ana.id, recall!.id),
                  sent(bruno.id, recall!.id),
                  sent(carla.id, recall!.id),
                  sent(carla.id, reminder!.id),
                  { account_id: account.accountId, patient_id: bruno.id, phone_number: '34600000009', wamid: `wamid.in${Math.random()}`, direction: 'inbound', status: 'received', body_preview: 'Ahora no puedo', channel: 'whatsapp', created_at: ago(4) },
                ],
              })
              cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: ana.id, practitionerId: account.teamMemberId, startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() })

              cy.login(account.email, account.password)
              cy.visit('/reports/recalls')
              cy.get('[data-cy=recalls-report][data-ready=true]', { timeout: 20000 })
              cy.get('[data-cy=recalls-contacted]').should('have.text', '3')
              cy.get('[data-cy=recalls-booked]').should('contain', '1').and('contain', '33%')
              cy.get('[data-cy=recalls-replied]').should('contain', '1')
              cy.get('[data-cy=recalls-rule-row]').should('have.length', 1).and('contain', 'Reactivación de prueba')
              cy.get('[data-cy=recalls-patient-row][data-status=booked]').should('contain', 'Ana Recall')
              cy.get('[data-cy=recalls-patient-row][data-status=replied]').should('contain', 'Bruno Recall')
              cy.get('[data-cy=recalls-patient-row][data-status=waiting]').should('contain', 'Carla Recall')

              // The reminder rule is offered, not counted, until it is picked.
              cy.contains('[data-cy=recalls-rule]', 'Recordatorio de prueba').should('have.attr', 'aria-pressed', 'false').click()
              cy.get('[data-cy=recalls-rule-row]').should('have.length', 2)
              cy.get('[data-cy=recalls-contacted]').should('have.text', '3')

              cy.get('[data-cy=recalls-filter-replied]').click()
              cy.get('[data-cy=recalls-patient-row]').should('have.length', 1).and('contain', 'Bruno Recall')
            }),
          ),
        )
      })
    })
  })
})
