// The publishable key is in the page source of every clinic's booking widget.
// Whatever `anon` can call, anyone can call.
//
// PostgREST publishes every function in `public` that a role may execute, so
// "internal" is not a property a Postgres function has -- only its grants
// are. Three that were never meant to answer a stranger did:
//
//   next_invoice_number / next_factura_number  increment a sequence and
//     return it. Their guard reads `if auth.uid() is not null and not
//     has_permission(...)`, written so the service role can call them from
//     the server -- but anon has no auth.uid() either, so it walked straight
//     past. A factura series has to be sequential and unbroken, and from
//     2027 it is what reaches the AEAT.
//
//   rebuild_factura_huellas  rewrites the whole VeriFactu hash chain for an
//     account, with no guard at all.
//
// And fourteen trigger functions sat on /rest/v1/rpc/<name> simply because
// nothing had revoked the EXECUTE that Postgres grants to PUBLIC by default.
//
// That default is the thing this spec is really guarding. The first version
// of the migration revoked from `anon`, which LOOKS right and changes
// nothing: the privilege was arriving through PUBLIC, and anon kept it.
// A test that only asserted "the migration ran" would have passed.
describe('What the anon key can reach', () => {
  function refused(fn: string, args?: Record<string, unknown>) {
    return cy.task<{ error: string | null }>('db:callRpcAsAnon', { fn, args }).then((r) => {
      expect(r.error, `anon called ${fn} and was not refused`).to.not.be.null
      expect(r.error, `${fn} refused for a reason other than permissions`).to.match(/permission denied|not find the function|schema cache/i)
    })
  }

  it('cannot take the next invoice number', () => {
    cy.seedStaffAccount().then((account) => {
      refused('next_invoice_number', { p_account_id: account.accountId, p_prefix: 'INV-' })
    })
  })

  it('cannot take the next factura number', () => {
    cy.seedStaffAccount().then((account) => {
      refused('next_factura_number', { p_account_id: account.accountId, p_series: 'F' })
    })
  })

  it('cannot rebuild the VeriFactu chain', () => {
    cy.seedStaffAccount().then((account) => {
      refused('rebuild_factura_huellas', { p_account_id: account.accountId, p_spec_version: 'v1' })
    })
  })

  it('cannot call the trigger functions', () => {
    // One SECURITY DEFINER, one not; both reached PUBLIC the same way.
    refused('fn_audit_log')
    refused('stamp_created_by')
    refused('record_factura_alta')
  })

  // The other half of the assertion, and the reason this is not just
  // "revoke everything": these RPCs answer the booking widget, which has no
  // session at all. Revoking the helpers around them breaks row level
  // security outright, since the policies call them as the invoking role.
  it('still answers the public booking widget', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task<{ error: string | null }>('db:callRpcAsAnon', {
        fn: 'get_public_booking_info',
        args: { p_slug: account.accountSlug },
      }).then((r) => {
        expect(r.error, 'the booking widget can still load a clinic').to.be.null
      })
    })
  })
})
