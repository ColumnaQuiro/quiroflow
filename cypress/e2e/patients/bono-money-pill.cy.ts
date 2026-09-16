// The pill by the patient's name answers one question for the front desk:
// what can this person draw on right now?
//
// It has been several shapes. Credit only, which went blank for every bono
// holder once 0161 moved a bono's value onto its session counter. Then credit
// plus the euro value of unused sessions, labelled "in bonos". Then the
// balance, on the reasoning that a visit is charged at the bono rate so
// prepaid money sits in the balance and each visit draws it down.
//
// That last shape held only where the arithmetic happened to line up. The
// balance spans every charge and payment a patient has ever had, so it carries
// the whole imported PracticeHub history; for 139 of the 217 patients showing
// a positive one it disagreed with what they could actually use. And it was
// labelled "credit", which bono money is not -- it is already committed to the
// sessions it bought.
//
// So the pill shows availableCents now, the figure the Billing tab calls
// Available. In THIS spec the two coincide, which is the case the old
// reasoning was built on; see pill-shows-what-they-can-draw-on.cy.ts for one
// where they do not.
describe('The balance pill', () => {
  it('shows prepaid bono money as available, drawn down by the visits taken', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruna', lastName: 'Bonovalue' }).then((patient: any) => {
        // She paid €528 for a Bono 12 and has taken 6 visits, charged at the
        // bono's own rate of €44. €528 − €264 leaves €264 of her money with
        // the clinic — the same figure PracticeHub derives for this bono.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 52800, method: 'card' })
        for (let i = 0; i < 6; i++) {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'paid' })
        }
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 6,
          priceCents: 52800,
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.contains('€264.00 available').should('be.visible')
        // The sessions counter still says what is left in visits, which is
        // the other half of the picture and not money.
        cy.contains('dt', 'In bonos').parent().should('contain', '€264.00')
      })
    })
  })

  it('leaves out the part of the bono that has not been paid for', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pau', lastName: 'Partpaid' }).then((patient: any) => {
        // A bono sold here, part-paid: EUR 528 for twelve sessions with EUR
        // 150 down, one session taken. Eleven sessions left is EUR 484 of
        // value -- but EUR 378 of it has not been paid for, and the Debtors
        // report says exactly that. Counting it gross told the front desk to
        // let him carry on while he owed for most of the bono.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12 sesiones',
          sessionsTotal: 12,
          sessionsUsed: 1,
          priceCents: 52800,
          owedCents: 52800,
        }).then((purchase: any) => {
          cy.task('db:createPayment', {
            accountId: account.accountId,
            patientId: patient.id,
            packagePurchaseId: purchase.id,
            amountCents: 15000,
            method: 'card',
          })
        })
        // His visits either side of the bono: EUR 114 charged, EUR 70 paid.
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 11400, status: 'unpaid' }).then((inv: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 7000, method: 'cash' })
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        // 484 of sessions less 378 still owed on them. It matches his balance
        // -- EUR 220 paid against EUR 114 invoiced -- because what he can draw
        // on IS what he has paid beyond what he has been charged.
        cy.contains('€106.00 available').should('be.visible')
        cy.contains('€484.00 available').should('not.exist')
      })
    })
  })

  it('reads as due when the patient owes, and shows nothing when square', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Otto', lastName: 'Owing' }).then((owing: any) => {
        // Charged €55, paid nothing.
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: owing.id, totalCents: 5500, status: 'unpaid' })

        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sara', lastName: 'Square' }).then((square: any) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: square.id, totalCents: 5500, status: 'paid' }).then((inv: any) => {
            cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 5500, method: 'cash' })

            cy.login(account.email, account.password)

            cy.visit(`/patients/${owing.id}`)
            cy.contains('€55.00 due').should('be.visible')

            // Nothing owed and nothing held: no pill at all, rather than a
            // zero that reads as a figure someone should act on.
            cy.visit(`/patients/${square.id}`)
            cy.contains('due').should('not.exist')
            cy.contains('credit').should('not.exist')
          })
        })
      })
    })
  })
})
