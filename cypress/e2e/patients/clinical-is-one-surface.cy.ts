// Clinical, in the order a practitioner reads it: what they came in for,
// what you think it is, what should stop you -- then the last visit's note
// open, and the ones before it a line each.
describe('The Clinical tab', () => {
  const NOTE = [
    'Subjective: Lower back pain, worse in the mornings.',
    'Objective: Restricted lumbar flexion, no neuro deficit.',
    'Action: Adjustment L5, soft tissue work.',
    'Plan: Review in one week.',
  ].join('\n\n')

  function seedClinical(account: any, patient: any) {
    return cy
      .task('db:createAppointment', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        patientId: patient.id,
        startsAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        status: 'completed',
      })
      .then((appt: any) => cy.task('db:addVisitNote', { accountId: account.accountId, appointmentId: appt.id, body: NOTE }))
  }

  it('puts the complaint, the diagnosis and the flags above the notes', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Clara',
        lastName: 'Clinica',
      }).then((patient: any) => {
        cy.task('db:setPatientClinical', {
          patientId: patient.id,
          chiefComplaint: 'Lower back pain radiating to left leg',
          diagnosis: 'L5-S1 disc irritation',
          redFlags: 'Night pain, unexplained weight loss',
          yellowFlags: 'Avoids activity for fear of pain',
          goals: 'Walk 30 minutes without pain; return to swimming',
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)

        cy.contains('Lower back pain radiating to left leg').should('be.visible')
        cy.contains('L5-S1 disc irritation').should('be.visible')

        // Red in danger, yellow in warning -- and the text beside the pill,
        // because these columns are prose and the pill is the severity, not
        // the content.
        cy.contains('Red flag').should('be.visible')
        cy.contains('Night pain, unexplained weight loss').should('be.visible')
        cy.contains('Yellow flag').should('be.visible')

        cy.contains('Walk 30 minutes without pain').should('be.visible')
      })
    })
  })

  it('opens the newest note with its four sections intact', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Nota',
        lastName: 'Estructura',
      }).then((patient: any) => {
        seedClinical(account, patient).then(() => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=clinical`)

          // "What did I do last time" is the question, so the newest note
          // opens itself -- and the labels the charting pane wrote are
          // headings again rather than text inside a wall of text.
          for (const label of ['Subjective', 'Objective', 'Action', 'Plan']) {
            cy.contains('dt', label).should('be.visible')
          }
          cy.contains('Restricted lumbar flexion').should('be.visible')
          cy.contains('Adjustment L5').should('be.visible')

          // And it says who wrote it.
          cy.contains('Author not recorded').should('exist')
        })
      })
    })
  })

  it('shows a note written before the convention as itself', () => {
    // Notes predate the four sections, and notes get pasted in. Forcing one
    // into headings it never had, or dropping what does not parse, is how a
    // clinical record loses a sentence.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Libre',
        lastName: 'Texto',
      }).then((patient: any) => {
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: new Date(Date.now() - 3 * 86400000).toISOString(),
          status: 'completed',
        }).then((appt: any) => {
          cy.task('db:addVisitNote', {
            accountId: account.accountId,
            appointmentId: appt.id,
            body: 'Adjustment to L5. Patient reports improvement since last session.',
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=clinical`)

          cy.contains('Adjustment to L5. Patient reports improvement since last session.').should('be.visible')
          cy.contains('dt', 'Subjective').should('not.exist')
        })
      })
    })
  })

  it('opens the most recent visit, not the most recently written note', () => {
    // The note row's own created_at is when someone typed it, which is not
    // when the visit happened. Seeding two notes seconds apart put the older
    // visit on top; a back-dated note would do the same to a real record.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Orden',
        lastName: 'Visitas',
      }).then((patient: any) => {
        const visit = (daysAgo: number, body: string) =>
          cy
            .task('db:createAppointment', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              patientId: patient.id,
              startsAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
              status: 'completed',
            })
            .then((appt: any) => cy.task('db:addVisitNote', { accountId: account.accountId, appointmentId: appt.id, body }))

        // The RECENT visit's note is written first, so ordering by the note
        // row would put the old one on top.
        visit(3, 'Subjective: The recent visit.')
          .then(() => visit(60, 'Subjective: The old visit.'))
          .then(() => {
            cy.login(account.email, account.password)
            cy.visit(`/patients/${patient.id}?tab=clinical`)

            // The newest visit is first and opens itself. The older one is
            // still there as a one-line preview -- collapsed is not hidden,
            // so what distinguishes them is which has its sections shown.
            cy.contains('The recent visit').should('be.visible')
            cy.get('li').first().should('contain.text', 'The recent visit')
            cy.get('li').last().should('contain.text', 'The old visit')
            cy.get('li').first().find('dt').should('exist')
            cy.get('li').last().find('dt').should('not.exist')
          })
      })
    })
  })

  // The tab this replaced had a pencil on every note. The redesign shipped
  // without one, so a typo in a clinical record could be read but not
  // corrected -- and the only way back to the editor was "Add note", which
  // opens the NEWEST visit whatever note you were looking at.
  it('edits the note that was opened, not the newest one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Corrige',
        lastName: 'Nota',
      }).then((patient: any) => {
        const visit = (daysAgo: number, body: string) =>
          cy
            .task('db:createAppointment', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              patientId: patient.id,
              startsAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
              status: 'completed',
            })
            .then((appt: any) => cy.task('db:addVisitNote', { accountId: account.accountId, appointmentId: appt.id, body }))

        visit(2, 'Subjective: The recent visit.')
          .then(() => visit(45, 'Subjective: Tensión cervial desde junio.'))
          .then(() => {
            cy.login(account.email, account.password)
            cy.visit(`/patients/${patient.id}?tab=clinical`)

            // The old visit is collapsed, so open it first -- the action
            // belongs to the note being read.
            cy.contains('li', 'Tensión cervial').contains('button', 'Open').click()
            cy.contains('li', 'Tensión cervial').contains('button', 'Edit').click()

            cy.get('button[aria-label="Edit"]').click()
            // The decisive assertion: the panel is pointed at THIS visit.
            // Wired to latestAppointmentId, as "Add note" is, the draft here
            // would be the recent visit's note instead.
            cy.get('li textarea').should('have.value', 'Subjective: Tensión cervial desde junio.')
            cy.get('li textarea').clear().type('Subjective: Tensión cervical desde junio.')
            cy.contains('button', 'Save').click()
            // Saved, not merely submitted. The panel swaps the textarea back
            // for the note once the update lands, and closing before that
            // reloads the list from the body that is still in the database.
            cy.get('li textarea').should('not.exist')

            cy.get('button[aria-label="Close"]').click()

            // Corrected in the record, and the misspelling is gone.
            cy.contains('Tensión cervical desde junio.').should('be.visible')
            cy.contains('Tensión cervial desde junio.').should('not.exist')
          })
      })
    })
  })

  it('shows the clinical columns once, not twice', () => {
    // The band and the flags panel read the same five columns. Rendering
    // both put all of it on screen twice, which is the drawer problem this
    // redesign exists to stop.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Unica',
        lastName: 'Vez',
      }).then((patient: any) => {
        cy.task('db:setPatientClinical', {
          patientId: patient.id,
          chiefComplaint: 'Shoulder pain on overhead reach',
          diagnosis: 'Rotator cuff tendinopathy',
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)

        // Waited for, not assumed: counting before the fetch lands counts
        // zero of everything and passes for the wrong reason.
        cy.contains('Rotator cuff tendinopathy').should('be.visible')
        cy.get('body').then(($b) => {
          const count = (text: string) =>
            [...$b.find('*')].filter((e) => {
              const el = e as HTMLElement
              if (el.children.length) return false
              if (el.textContent?.trim() !== text) return false
              const r = el.getBoundingClientRect()
              return r.width > 1 && r.height > 1
            }).length
          expect(count('Shoulder pain on overhead reach'), 'complaint shown once').to.equal(1)
          expect(count('Rotator cuff tendinopathy'), 'diagnosis shown once').to.equal(1)
        })

        // And it is still editable -- the panel moved behind a button.
        cy.contains('button', 'Edit clinical details').click()
        cy.contains('Rotator cuff tendinopathy').should('exist')
      })
    })
  })
})
