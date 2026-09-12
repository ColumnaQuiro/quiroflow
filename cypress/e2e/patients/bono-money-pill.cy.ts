// The pill by the patient's name is the balance, the way PracticeHub states
// it: one number, positive when the clinic holds their money, negative when
// they owe.
//
// It has been three shapes. Credit only, which went blank for every bono
// holder once 0161 moved a bono's value onto its session counter. Then credit
// plus the euro value of unused sessions, labelled "in bonos", which existed
// to paper over that gap. The re-migration removed the gap itself: a visit is
// charged at the bono rate, so prepaid money sits in the balance and each
// visit draws it down. There is nothing left for a second figure to explain.
describe('The balance pill', () => {
  it('shows prepaid bono money as credit, drawn down by the visits taken', () => {
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

        cy.contains('€264.00 credit').should('be.visible')
        // The sessions counter still says what is left in visits, which is
        // the other half of the picture and not money.
        cy.contains('dt', 'In bonos').parent().should('contain', '€264.00')
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
