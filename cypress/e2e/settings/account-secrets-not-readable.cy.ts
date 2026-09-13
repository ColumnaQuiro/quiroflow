// Integration credentials must not be readable by the clinic's own staff.
//
// They used to be columns on `accounts`, whose RLS is:
//
//   staff can view their account    SELECT  using (is_account_member(id))
//
// Row-level, not column-level -- so every member of the account, any role, no
// permission check, could fetch the live Stripe secret key through the REST
// API in one call, and overwrite it. That key charges cards and issues
// refunds. None of it went through the app's permission system, because it
// did not go through the app.
//
// These tests use the anon key and a real signed-in session: the same two
// things a browser has, so they exercise the actual path rather than a proxy
// for it.

const STRIPE_KEY_SHAPED = 'sk_test_thisisnotarealkey000000000000'

function seedStaff(then: (account: any) => void) {
  cy.seedStaffAccount().then((account) => {
    cy.task('db:setAccountSecret', {
      accountId: account.accountId,
      name: 'stripe_secret_key',
      value: STRIPE_KEY_SHAPED,
    })
    then(account)
  })
}

describe('Integration credentials are out of reach of staff', () => {
  it('does not let a signed-in staff member read account_secrets at all', () => {
    seedStaff((account) => {
      cy.task<{ rows: number; error: string | null }>('db:readAsStaff', {
        email: account.email,
        password: account.password,
        table: 'account_secrets',
      }).then((result) => {
        // Either shape is a pass: PostgREST answers a revoked table with an
        // error, and a denied-by-RLS one with an empty list. What must never
        // happen is a row coming back.
        expect(result.rows, 'rows visible to a staff member').to.eq(0)
      })
    })
  })

  it('is the owner, not just a limited role, that cannot read them', () => {
    // seedStaffAccount creates the account owner -- the most privileged user
    // there is. If the owner cannot read it, nobody below them can either,
    // and the check does not depend on how roles happen to be configured.
    seedStaff((account) => {
      cy.task<{ rows: number }>('db:readAsStaff', {
        email: account.email,
        password: account.password,
        table: 'account_secrets',
        columns: 'value',
      }).then((result) => {
        expect(result.rows, 'secret values visible to the account owner').to.eq(0)
      })
    })
  })

  it('still lets that same staff member read their own account row', () => {
    // The control. Without it the tests above would pass just as happily if
    // the session were broken or RLS denied everything, which would prove
    // nothing about the secrets specifically.
    seedStaff((account) => {
      cy.task<{ rows: number }>('db:readAsStaff', {
        email: account.email,
        password: account.password,
        table: 'accounts',
        columns: 'id, name',
      }).then((result) => {
        expect(result.rows, 'their own account row').to.eq(1)
      })
    })
  })
})
