import { openNewAppointmentPanel } from '../../support/calendar'

// Booking a new patient left nowhere to type the phone number.
//
// The country <select> and the number share one row. A select with no width
// set takes the width of its LONGEST option, and across the 92 countries in
// utils/countries.ts that is "+971 United Arab Emirates" at 25 characters --
// while the selected one reads "+34 Spain" at 9. With shrink-0 on top, and
// the row sitting in one half of a two-column grid, the select measured 215px
// and left the number field 26px: about one character. It also pushed the
// input 21px past the panel's own right edge, so what reception saw was a
// sliver of a box cut off by the side of the panel.
//
// Measured rather than eyeballed. The failure is purely geometric -- every
// element was present, correctly bound and perfectly functional -- so any
// test that only asserted the field exists passed the whole time it was
// unusable.
describe('The new-patient phone field', () => {
  it('leaves room to actually type a number', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      openNewAppointmentPanel()

      cy.get('[data-cy=create-sheet]').within(() => {
        cy.get('[data-cy=create-new-patient]').click()

        cy.get('input[type="tel"]').should('be.visible').then(($input) => {
          const box = $input[0].getBoundingClientRect()
          // 26px before, 335 after. 160 sits far from both, so this fails on
          // the bug and tolerates any font or rounding difference.
          expect(box.width, 'phone input width in px').to.be.greaterThan(160)

          // And it stays inside the panel: overflowing the right edge is what
          // made the remaining sliver unreachable rather than merely small.
          const panel = $input[0].closest('[data-cy=create-sheet]')!.getBoundingClientRect()
          expect(box.right, 'phone input right edge vs panel').to.be.at.most(Math.ceil(panel.right))
        })

        // And the select is still usable -- pinning its width must not have
        // collapsed it to the point the dial code is unreadable. Its own
        // sibling, not `select:last`: the panel's Repeat select is further
        // down and full width, which is what that matched.
        cy.get('input[type="tel"]').prev('select').then(($select) => {
          const width = $select[0].getBoundingClientRect().width
          expect(width, 'country select width in px').to.be.within(100, 140)
        })
      })

      cy.screenshot('new-patient-phone-row', { capture: 'viewport' })
    })
  })
})
