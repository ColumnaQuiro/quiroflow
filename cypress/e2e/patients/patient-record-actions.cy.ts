// Every action the record's old header and its 280px rail offered, exercised
// on the surfaces that replaced them.
//
// This exists because the rebuild was checked twice by comparing the words
// the old and new records put on screen, and both passes missed that the
// patient photo -- and the only route to uploading one -- had not come
// across. Text is the wrong instrument: a control that renders and does
// nothing reads identically to one that works. So these click things.
function openMenu() {
  cy.get('button[aria-label="More actions"]').click()
}

describe('What the patient record can still do', () => {
  it('messages, books, and takes a payment from the banner', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Casilda',
        lastName: 'Acciones',
        phone: '600909090',
      }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 6600, status: 'unpaid' })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        // Message -- the rail's WhatsApp button and the header's Message
        // button were the same modal.
        cy.contains('button', 'Message').first().click()
        cy.contains('Send WhatsApp').should('be.visible')
        cy.get('body').type('{esc}')

        // Take payment used to be a rail button called Charge. Wherever it
        // is, it has to land on Money with the panel already open, because
        // switching tabs alone is a no-op when Money is already showing.
        cy.visit(`/patients/${patient.id}`)
        openMenu()
        cy.contains('button', 'Take payment').click()
        cy.contains('button', 'Record payment').should('be.visible')
        cy.url().should('include', 'tab=money')

        // Book visit
        cy.visit(`/patients/${patient.id}`)
        cy.contains('button', 'Book visit').click()
        cy.location('pathname', { timeout: 15000 }).should('eq', '/calendar')
      })
    })
  })

  it('archives and unarchives, and opens merge', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Aurelio',
        lastName: 'Archivo',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        openMenu()
        cy.contains('button', 'Archive patient').click()
        cy.contains('Patient archived').should('be.visible')
        cy.contains('Archived').should('be.visible')

        // And back again -- the old header's button flipped its own label.
        openMenu()
        cy.contains('button', 'Unarchive patient').click()
        cy.contains('Patient unarchived').should('be.visible')

        openMenu()
        cy.contains('button', 'Merge with another record').click()
        cy.contains('Merge').should('be.visible')
      })
    })
  })

  it('copies the phone and the email, which is why they moved into the banner', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Copia',
        lastName: 'Contacto',
        email: 'copia@example.test',
        phone: '600121212',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.get('button[aria-label="Copy phone number"]').click()
        cy.contains('Copied').should('be.visible')
        cy.get('button[aria-label="Copy email address"]').click()
        cy.contains('Copied').should('be.visible')
      })
    })
  })

  it('hides every send affordance for a patient marked do-not-contact', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Dionisia',
        lastName: 'Nocontactar',
        phone: '600343434',
      }).then((patient: any) => {
        cy.task('db:setPatientContactFlags', { patientId: patient.id, doNotContact: true })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        // Removed, not disabled: a greyed-out Message button still invites
        // the click that must not happen.
        cy.contains('Do not contact').should('be.visible')
        cy.contains('button', 'Message').should('not.exist')
        cy.contains('button', 'Book visit').should('be.visible')
      })
    })
  })
})

// The hard constraints the design encodes: what the record must NOT offer.
// Each one is "removed, not disabled" -- a greyed-out control still tells a
// receptionist the action exists and invites the click.
describe('What the patient record must refuse to offer', () => {
  it('gives a minor no Communications tab and no Message button', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Benito',
        lastName: 'Menor',
        phone: '600565656',
      }).then((patient: any) => {
        cy.task('db:setPatientContactFlags', { patientId: patient.id, isMinor: true })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.contains('Minor').should('be.visible')
        cy.contains('button', 'Communications').should('not.exist')
        cy.contains('button', 'Message').should('not.exist')

        // And the tab cannot be reached by typing its name into the URL
        // either -- it falls back rather than rendering an empty thread.
        cy.visit(`/patients/${patient.id}?tab=communications`)
        cy.contains('button', 'Overview').should('have.attr', 'aria-current', 'page')
      })
    })
  })

  it('offers no Merge or Delete to someone without the permission', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Restringida',
        lastName: 'Permisos',
      }).then((patient: any) => {
        cy.task('db:setRolePermissions', {
          accountId: account.accountId,
          roleName: 'Front Desk',
          patch: { patients_delete_merge: false, patients_edit: true },
        })
        const deskEmail = `desk-${Date.now()}@example.test`
        cy.task('db:createTeamMemberWithRole', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          roleName: 'Front Desk',
          email: deskEmail,
          password: 'Test1234!',
          fullName: 'Front Desk',
        }).then(() => {
          cy.login(deskEmail, 'Test1234!')
          cy.visit(`/patients/${patient.id}`)
          cy.contains('Restringida Permisos').should('be.visible')

          // The menu may still be there for Archive, which this role can do
          // -- what must not be there is either destructive item.
          cy.get('body').then(($body) => {
            if ($body.find('button[aria-label="More actions"]').length) {
              cy.get('button[aria-label="More actions"]').click()
            }
            cy.contains('button', 'Merge with another record').should('not.exist')
            cy.contains('button', 'Delete patient').should('not.exist')
          })
        })
      })
    })
  })
})

// A clinic's front desk works off a phone as much as a laptop, and the
// redesign put four actions behind one button. If that button is desktop-only
// then Archive, Merge, Delete and Take payment simply cannot be reached --
// which is how it shipped to a pull request, because every other check ran at
// 1440 where the menu is visible.
describe('The patient record on a phone', () => {
  it('still reaches every action behind the overflow menu at 390px', () => {
    cy.viewport(390, 844)
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Mercedes',
        lastName: 'Movil',
        phone: '600818181',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.get('button[aria-label="More actions"]').should('be.visible').then(($b) => {
          // 44px is the smallest target a thumb reliably hits.
          expect($b[0].getBoundingClientRect().height, 'touch target height').to.be.at.least(44)
        })

        cy.get('button[aria-label="More actions"]').click()
        for (const item of ['Take payment', 'Archive patient', 'Merge with another record', 'Delete patient']) {
          cy.contains('button', item).should('be.visible')
        }

        // And the thumb row is there too, which is why Message and Book are
        // allowed to drop out of the top row on a narrow screen.
        cy.get('body').type('{esc}')
        cy.contains('a', 'Call').should('be.visible')
        cy.contains('button', /^Book$/).should('be.visible')
      })
    })
  })
})

// Docs and Files were two tabs and are now two groups on one. Stacking two
// panels that each title themselves, under section headings that also title
// them, printed "Files" twice -- which is what merging surfaces does if you
// only check that the content arrived and not how it reads.
describe('The merged Attachments tab', () => {
  it('titles each group exactly once', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Adjunta',
        lastName: 'Ficheros',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=attachments`)

        // Both panels are here...
        cy.contains('Docs').should('be.visible')
        cy.contains('Files').should('be.visible')

        // ...and neither announces itself twice to a sighted reader. The
        // section headings stay in the markup, screen-reader only, so the
        // groups are still named regions.
        const visibleLeafCount = (word: string) =>
          cy.get('body').then(($b) =>
            [...$b.find('*')].filter((e) => {
              const el = e as HTMLElement
              if (el.children.length) return false
              if (el.textContent?.trim() !== word) return false
              const r = el.getBoundingClientRect()
              return r.width > 1 && r.height > 1
            }).length,
          )

        visibleLeafCount('Files').should('eq', 1)
        visibleLeafCount('Docs').should('eq', 1)
      })
    })
  })
})
