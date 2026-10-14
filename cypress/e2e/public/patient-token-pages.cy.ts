// The waitlist claim link and the photo-upload QR are opened on a patient's
// phone with no QuiroFlow login; the token in the URL is what gates them. Both
// used to be missing from supabase.redirectOptions.exclude, so the module sent
// every one of those phones to /login and the page never rendered.

function tomorrowAt(hour: number) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(hour, 0, 0, 0)
  return d
}

describe('Token pages a patient opens without signing in', () => {
  it('shows a waitlist offer from its claim link', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Prueba' }).then((patient) => {
        const startsAt = tomorrowAt(12)
        cy.task<{ id: string }>('db:createWaitlistEntry', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          status: 'offered',
          offered: {
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
            roomId: null,
            practitionerId: account.teamMemberId,
            expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
          },
        }).then((entry) => {
          cy.task<{ claim_token: string }[]>('db:selectRows', { table: 'waitlist_entries', columns: 'claim_token', match: { id: entry.id } }).then(([row]) => {
            cy.clearCookies()
            cy.visit(`/waitlist/${row!.claim_token}`)
            cy.location('pathname').should('eq', `/waitlist/${row!.claim_token}`)
            cy.get('[data-cy=waitlist-claim-offer]').should('be.visible')
          })
        })
      })
    })
  })

  it('shows the camera prompt from a photo-upload link', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bea', lastName: 'Prueba' }).then((patient) => {
        cy.task<{ token: string }[]>('db:insertRows', { table: 'photo_upload_tokens', rows: [{ account_id: account.accountId, patient_id: patient.id }] }).then(([row]) => {
          cy.clearCookies()
          cy.visit(`/photo-upload/${row!.token}`)
          cy.location('pathname').should('eq', `/photo-upload/${row!.token}`)
          cy.get('[data-cy=photo-upload-ready]').should('be.visible').and('contain', 'Bea')
        })
      })
    })
  })

  it('says a bad link is bad rather than asking for a login', () => {
    cy.clearCookies()
    cy.visit('/waitlist/not-a-real-token')
    cy.location('pathname').should('eq', '/waitlist/not-a-real-token')
    cy.get('[data-cy=waitlist-claim-invalid]').should('be.visible')

    cy.visit('/photo-upload/00000000-0000-0000-0000-000000000000')
    cy.location('pathname').should('eq', '/photo-upload/00000000-0000-0000-0000-000000000000')
    cy.get('[data-cy=photo-upload-invalid]').should('be.visible')
  })

  // The staff waitlist page holds patients' names and phones. A '/waitlist/*'
  // exclusion would also have let '/waitlist/' through, where the router
  // serves that same page, so both spellings are checked.
  it('still keeps the staff waitlist page behind the login', () => {
    cy.clearCookies()
    cy.visit('/waitlist')
    cy.location('pathname').should('eq', '/login')
    cy.visit('/waitlist/')
    cy.location('pathname').should('eq', '/login')
  })
})
