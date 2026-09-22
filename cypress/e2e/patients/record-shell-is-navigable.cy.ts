// The record's shell: how you move around it, and what it tells you about a
// patient who cannot be messaged directly.
describe('Moving around the patient record', () => {
  it('is one tab stop, with arrows between the tabs', () => {
    // They were six buttons carrying aria-current, which announces "the page
    // you are on" -- a tab is not a page, and a keyboard user had to tab
    // through all six to reach the content every time.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Teclado',
        lastName: 'Navega',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.get('[role="tablist"]').should('exist')
        cy.contains('button', 'Overview').should('have.attr', 'aria-selected', 'true').and('have.attr', 'tabindex', '0')
        // Every other tab is out of the tab order, which is what makes it
        // one stop rather than six.
        cy.contains('button', 'Money').should('have.attr', 'tabindex', '-1')

        cy.contains('button', 'Overview').focus().type('{rightarrow}')
        cy.contains('button', 'Clinical').should('have.attr', 'aria-selected', 'true')
        cy.url().should('include', 'tab=clinical')

        // Wrapping backwards from the first tab lands on the last.
        cy.contains('button', 'Clinical').type('{leftarrow}{leftarrow}')
        cy.contains('button', 'Attachments').should('have.attr', 'aria-selected', 'true')

        cy.contains('button', 'Attachments').type('{home}')
        cy.contains('button', 'Overview').should('have.attr', 'aria-selected', 'true')
      })
    })
  })

  it('names the panel the selected tab controls', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Panel',
        lastName: 'Etiquetado',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=money`)
        cy.get('[role="tabpanel"]').should('have.attr', 'aria-labelledby', 'tab-money')
        cy.contains('button', 'Money').should('have.attr', 'aria-controls', 'panel-money')
      })
    })
  })

  it("points a minor's record at the tutor messages actually go to", () => {
    // A minor has no Communications tab at all, which states the rule and
    // not where to act on it. Someone still has to be told the appointment
    // moved.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Marta',
        lastName: 'Tutora',
      }).then((tutor: any) => {
        cy.task('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Bruno',
          lastName: 'Menor',
        }).then((child: any) => {
          cy.task('db:setPatientContactFlags', { patientId: child.id, isMinor: true })
          cy.task('db:setPatientTutor', { patientId: child.id, tutorPatientId: tutor.id })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${child.id}`)

          cy.contains('Minor').should('be.visible')
          cy.contains('button', 'Communications').should('not.exist')

          cy.contains('a', 'Marta Tutora').click()
          cy.location('pathname', { timeout: 15000 }).should('eq', `/patients/${tutor.id}`)
        })
      })
    })
  })

  it('says so when a minor has no tutor linked at all', () => {
    // The rule still applies, and there is nobody to apply it to. Silence
    // here reads as "this is fine".
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Sin',
        lastName: 'Tutor',
      }).then((child: any) => {
        cy.task('db:setPatientContactFlags', { patientId: child.id, isMinor: true })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${child.id}`)
        cy.contains('No tutor linked').should('be.visible')
      })
    })
  })
})
