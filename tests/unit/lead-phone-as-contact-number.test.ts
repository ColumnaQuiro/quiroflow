import { describe, it, expect } from 'vitest'
import { leadPhoneAsContactNumber, phoneMatches, toE164 } from '../../utils/phone'

// Converting a lead copied its international phone into a patient number,
// which is stored local. Edwin Coloma, 3 Oct 2026: "34611732681" became the
// patient's local number, and his appointment confirmation went to
// 3434611732681.
describe("A lead's phone as a patient's contact number", () => {
  it('splits the dial code out of the digits Meta and WhatsApp deliver', () => {
    expect(leadPhoneAsContactNumber('34611732681', 'ES')).to.deep.equal({ countryCode: 'ES', number: '611732681' })
  })

  it('is messaged at the same number the lead was', () => {
    const contact = leadPhoneAsContactNumber('34611732681', 'ES')!
    expect(toE164(contact.number, contact.countryCode)).to.equal('34611732681')
  })

  it("keeps a foreign lead's own country", () => {
    // A WhatsApp lead from Colombia, in a Spanish clinic.
    const contact = leadPhoneAsContactNumber('573001234567', 'ES')!
    expect(contact.countryCode).to.equal('CO')
    expect(toE164(contact.number, contact.countryCode)).to.equal('573001234567')
  })

  it('takes the number written with a plus or a 00 the same way', () => {
    expect(leadPhoneAsContactNumber('+34 611 73 26 81', 'ES')).to.deep.equal({ countryCode: 'ES', number: '611732681' })
    expect(leadPhoneAsContactNumber('0034611732681', 'ES')).to.deep.equal({ countryCode: 'ES', number: '611732681' })
  })

  it('gives nothing for a blank phone', () => {
    expect(leadPhoneAsContactNumber('  ', 'ES')).to.equal(null)
  })
})

describe('Finding the patient a lead already is, by phone', () => {
  it("matches a patient's local number against the lead's international one", () => {
    // What convert.post.ts compared as text, and so never matched.
    expect(phoneMatches('611 73 26 81', 'ES', '34611732681')).to.equal(true)
  })
})
