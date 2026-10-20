import type { StaffAccount } from '../../support/commands'
import { todayAt } from '../../support/calendar'

// A patient who was sent forms and has not filled them in, and is not
// answering the phone, often does not come. The calendar warns the front desk
// on the visit itself -- the block, the hover card, the panel -- and My Day
// shows the same flag. The count comes from patients.pending_forms (a
// computed field on the calendar's own appointments read), so this also pins
// what counts as pending: an open form that asks something, on a visit still
// to happen.

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))

const INTAKE = [
  { id: 'h', type: 'heading', label: 'Historia clínica' },
  { id: 'q1', type: 'long_text', label: 'Motivo de consulta' },
  { id: 's', type: 'signature', label: 'Firma' },
]

function seed(): Cypress.Chainable<StaffAccount> {
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 1' }).then((room) => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
      const visit = (first: string, last: string, h: number, extra: Record<string, unknown>, docs: { fields: unknown[]; completed?: boolean }[]) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: last }).then((patient) => {
          for (const [i, d] of docs.entries()) cy.task('db:createPatientDoc', { accountId: account.accountId, patientId: patient.id, title: `Formulario ${i + 1}`, fields: d.fields, completed: d.completed })
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, roomId: room.id, startsAt: todayAt(h, 0), ...extra })
        })

      // First visit, unconfirmed, two forms still open: the case to warn about.
      visit('Ana', 'Ruiz', 11, { confirmationStatus: 'pending' }, [{ fields: INTAKE }, { fields: INTAKE }])
      // Filled in: nothing to say.
      visit('Bruno', 'Vidal', 12, { confirmationStatus: 'confirmed' }, [{ fields: INTAKE, completed: true }])
      // An empty draft has nothing for the patient to complete.
      visit('Clara', 'Soler', 13, { confirmationStatus: 'confirmed' }, [{ fields: [] }, { fields: [{ id: 't', type: 'text', label: 'Bienvenida' }] }])
      // Already seen: too late to matter, so no flag on a finished visit.
      visit('Diego', 'Mora', 9, { status: 'completed' }, [{ fields: INTAKE }])
      // Tomorrow and unconfirmed: always inside "Needs confirming" (now until
      // the end of tomorrow), whatever time of day the spec runs.
      const tomorrow = new Date(todayAt(10, 0))
      tomorrow.setDate(tomorrow.getDate() + 1)
      visit('Eva', 'Prat', 10, { startsAt: tomorrow.toISOString(), confirmationStatus: 'pending' }, [{ fields: INTAKE }])
      return cy.wrap(account)
    }),
  )
}

function block(name: string) {
  return cy.contains('[data-cy=appt-block]', name)
}

describe('Calendar: forms the patient has not completed', () => {
  it('flags the visit on the block, the hover card, the panel and My Day', () => {
    seed().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      block('Ana Ruiz').find('[data-cy=appt-block-forms]').should('have.attr', 'title', '2 forms not completed')
      // Said to a screen reader too, in the block's own label.
      block('Ana Ruiz').children().first().should('have.attr', 'aria-label').and('include', '2 forms not completed')
      block('Bruno Vidal').find('[data-cy=appt-block-forms]').should('not.exist')
      block('Clara Soler').find('[data-cy=appt-block-forms]').should('not.exist')
      block('Diego Mora').find('[data-cy=appt-block-forms]').should('not.exist')

      block('Ana Ruiz').trigger('pointerenter', { pointerType: 'mouse' })
      cy.get('[data-cy=appt-hover-forms]').should('contain.text', '2 forms not completed').and('contain.text', 'awaiting the patient')
      block('Ana Ruiz').trigger('pointerleave', { pointerType: 'mouse' })

      block('Ana Ruiz').click()
      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.get('[data-cy=appt-panel-forms]').should('contain.text', '2 forms not completed')
        cy.get('[data-cy=appt-panel-forms-open]').should('have.attr', 'href').and('include', '?tab=attachments')
      })
      cy.get('body').type('{esc}')
      cy.get('[data-cy=appt-sheet]').should('not.exist')

      block('Bruno Vidal').click()
      cy.get('[data-cy=appt-sheet]').should('be.visible').find('[data-cy=appt-panel-forms]').should('not.exist')
      cy.get('body').type('{esc}')

      cy.visit('/practitioner')
      cy.contains('li:not([data-cy=needs-confirming-row])', 'Ana Ruiz', { timeout: 20000 }).find('[data-cy=worklist-forms]').should('have.attr', 'title', '2 forms not completed')
      cy.contains('li:not([data-cy=needs-confirming-row])', 'Bruno Vidal').find('[data-cy=worklist-forms]').should('not.exist')
      // "Needs confirming" names the open forms beside the no-show risk.
      cy.contains('[data-cy=needs-confirming-row]', 'Eva Prat').should('contain.text', 'First visit · Form not completed')
    })
  })
})
