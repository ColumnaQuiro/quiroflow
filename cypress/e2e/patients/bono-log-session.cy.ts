describe('Logging a bono session', () => {
  it('records a completed visit against the bono, charged at the bono rate', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruno', lastName: 'Bonos' }).then((patient: any) => {
        // 12 sessions at €528 => €44 a session. That is what the visit is
        // WORTH against the bono -- it is recorded, not charged.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 52800,
        }).then((purchase: any) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          cy.contains('Bono 12').should('be.visible')
          cy.contains('12 of 12 sessions left').should('be.visible')

          // Logging a session now writes real records, so it asks first.
          cy.get('[data-cy="log-session-open"]').click()
          cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()

          // The counter is the visible half of the change...
          cy.contains('11 of 12 sessions left', { timeout: 15000 }).should('be.visible')

          // ...and this is the rest of it: the visit exists as a completed
          // appointment and a package_sessions row, and NOTHING is billed.
          // A covered visit IS charged now, at the bono's per-session rate --
          // that is what draws down the money the patient put in when they
          // bought it. What must not happen is a second PAYMENT: nothing new
          // crosses the counter, the charge is settled by the prepayment.
          cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((eff: any) => {
            expect(eff.purchase.sessions_used, 'sessions used').to.eq(1)

            expect(eff.appointments, 'one appointment created').to.have.length(1)
            expect(eff.appointments[0].status, 'appointment status').to.eq('completed')

            expect(eff.sessions, 'the visit recorded on the bono').to.have.length(1)
            expect(eff.sessions[0].amount_cents, 'worth the bono rate').to.eq(4400)
            expect(eff.sessions[0].package_purchase_id, 'against this bono').to.eq(purchase.id)
            expect(eff.sessions[0].appointment_id, 'linked to the visit').to.eq(eff.appointments[0].id)

            expect(eff.invoices, 'the visit is charged').to.have.length(1)
            expect(eff.invoices[0].total_cents, 'at the bono rate, not the walk-in price').to.eq(4400)
            expect(eff.payments, 'but nothing new was collected').to.have.length(0)
            expect(eff.credits, 'no account credit written either way').to.have.length(0)

            // The line says what it is for, in Spanish, while this whole test
            // runs in English -- "Log session" above is the English button.
            // The description used to be built with t(), so it followed the
            // staff member's own language preference, which defaults to
            // English: a Spanish clinic's invoice read "Bono 12 — session"
            // depending only on who was logged in. It is a stored billing
            // record, not a label, and from 2027 it is transmitted to the
            // AEAT.
            expect(eff.lineItems, 'one line for the visit').to.have.length(1)
            expect(eff.lineItems[0].description, 'the clinic language, not the viewer preference').to.eq('Bono 12 — sesión')
            // And which bono, as a key. The description is a copy of the name
            // at purchase time -- a migrated "Bono 12" and the same bono sold
            // here as "Bono 12 sesiones" are the same thing, and only this
            // says so.
            expect(eff.lineItems[0].package_purchase_id, 'the line names its bono').to.eq(purchase.id)
          })
        })
      })
    })
  })

  it('records the visit on the day it happened, not the day it was typed in', () => {
    // Catching up on a session for a visit that was never on the calendar.
    // The date recorded has to be the one picked rather than now -- a visit
    // filed under the wrong day is a visit the practitioner is not paid for on
    // the right one, and the bono's own history stops matching the calendar.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Berta', lastName: 'Backdate' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 52800,
        }).then((purchase: any) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          cy.contains('12 of 12 sessions left').should('be.visible')

          const chosen = new Date()
          chosen.setDate(chosen.getDate() - 6)
          const chosenStr = `${chosen.getFullYear()}-${String(chosen.getMonth() + 1).padStart(2, '0')}-${String(chosen.getDate()).padStart(2, '0')}`

          cy.get('[data-cy="log-session-open"]').click()
          // Nothing on the calendar, so "not on the calendar" is the only
          // choice and is already picked. No .clear() first: typing
          // YYYY-MM-DD into a native date input replaces the value outright.
          cy.get('[data-cy="log-session-date"]').type(chosenStr)
          cy.get('[data-cy="log-session-summary"]').should('contain.text', '11 of 12 left')
          cy.get('[data-cy="confirm-dialog-confirm"]').click()

          cy.get('[data-cy="bono-card"]', { timeout: 15000 }).should('contain.text', '11 of 12 sessions left')

          cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((eff: any) => {
            expect(eff.purchase.sessions_used, 'sessions used').to.eq(1)
            // Both records carry the picked day, not today. Noon local time,
            // so converting to UTC cannot land it on the day before.
            expect(eff.appointments, 'one appointment created').to.have.length(1)
            expect(eff.appointments[0].starts_at.slice(0, 10), 'the visit is on the chosen day').to.eq(chosenStr)
            expect(eff.sessions, 'the visit recorded on the bono').to.have.length(1)
            expect(eff.sessions[0].used_at.slice(0, 10), 'the bono says so too').to.eq(chosenStr)
          })
        })
      })
    })
  })

  it('logs a past visit that was never logged onto that visit, not a new one', () => {
    // Teresa Davis, 24 Sep 2026: her 15 Sep visit had nothing against it, and
    // "Another date -> 15 Sep" could not see the calendar -- it invented a
    // second, typeless 12:00 visit that day and put the session and its
    // receipt on that, leaving the real 10:30 one uncovered.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Teresa', lastName: 'Pasada' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono mantenimiento',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 48000,
        }).then((purchase: any) => {
          const nineDaysAgo = new Date()
          nineDaysAgo.setDate(nineDaysAgo.getDate() - 9)
          nineDaysAgo.setHours(10, 30, 0, 0)
          cy.task('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            practitionerId: account.teamMemberId,
            startsAt: nineDaysAgo.toISOString(),
            status: 'completed',
          }).then((appt: any) => {
            cy.login(account.email, account.password)
            cy.visit(`/patients/${patient.id}?tab=billing`)

            // Said on the card without anyone going looking for it.
            cy.get('[data-cy="bono-unlogged-visits"]').should('contain.text', '1 visit has no session or payment')

            cy.get('[data-cy="log-session-open"]').click()
            cy.get('[data-cy="log-session-visit"]').should('have.length', 1)
            // Not today's, so not picked for them: guessing a day is how a
            // session lands on the wrong visit.
            cy.get('[data-cy="confirm-dialog-confirm"]').should('be.disabled')
            cy.get('[data-cy="log-session-visit"]').click()
            cy.get('[data-cy="confirm-dialog-confirm"]').should('not.be.disabled').click()

            cy.get('[data-cy="bono-card"]', { timeout: 15000 }).should('contain.text', '11 of 12 sessions left')
            cy.get('[data-cy="bono-unlogged-visits"]').should('not.exist')

            cy.task('db:packageSessionEffects', { patientId: patient.id, packagePurchaseId: purchase.id }).then((eff: any) => {
              expect(eff.appointments, 'no second visit invented').to.have.length(1)
              expect(eff.sessions, 'one session').to.have.length(1)
              expect(eff.sessions[0].appointment_id, 'on the real visit').to.eq(appt.id)
              expect(new Date(eff.sessions[0].used_at).getTime(), 'dated to the visit').to.eq(nineDaysAgo.getTime())
              expect(eff.invoices, 'its receipt on the same visit').to.have.length(1)
              expect(eff.invoices[0].appointment_id, 'the receipt is on the real visit too').to.eq(appt.id)
            })
          })
        })
      })
    })
  })

  it('does not let a bono go past its session count', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Fina', lastName: 'Finished' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 5',
          sessionsTotal: 5,
          sessionsUsed: 5,
          priceCents: 22000,
        }).then(() => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          cy.contains('0 of 5 sessions left').should('be.visible')
          cy.contains('button', 'Log session').should('be.disabled')
        })
      })
    })
  })
})
