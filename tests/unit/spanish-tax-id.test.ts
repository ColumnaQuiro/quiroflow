import { describe, it, expect } from 'vitest'
import { checkSpanishTaxId, normalizeTaxId, validSpanishTaxId } from '../../utils/spanishTaxId'

// A patient's DNI/NIE goes to the AEAT as <NIF>. Not NIF-shaped and the whole
// envelope is refused (4102, every record in the batch with it); NIF-shaped
// with the wrong check letter and that record is refused (1239).
describe('Spanish tax identifiers', () => {
  it('normalises what reception types: case, spaces, dashes, dots', () => {
    expect(normalizeTaxId(' 12.345.678-z ')).to.eq('12345678Z')
    expect(normalizeTaxId('x-1234567-l')).to.eq('X1234567L')
    expect(normalizeTaxId('B 16/365/504')).to.eq('B16365504')
    expect(normalizeTaxId('ES12345678Z'), 'the VAT form').to.eq('12345678Z')
    expect(normalizeTaxId(null)).to.eq('')
  })

  it('checks a DNI’s letter', () => {
    expect(checkSpanishTaxId('12345678Z')).to.deep.eq({ kind: 'valid', normalized: '12345678Z', type: 'DNI' })
    expect(checkSpanishTaxId('99999999R').kind).to.eq('valid')
    expect(checkSpanishTaxId('12345678A')).to.deep.eq({ kind: 'invalid', normalized: '12345678A', type: 'DNI' })
    // Typed without its leading zero: still the same DNI, padded to nine.
    expect(checkSpanishTaxId('1234567L')).to.deep.eq({ kind: 'valid', normalized: '01234567L', type: 'DNI' })
  })

  it('checks a NIE, reading X, Y and Z as 0, 1 and 2', () => {
    expect(checkSpanishTaxId('X1234567L')).to.deep.eq({ kind: 'valid', normalized: 'X1234567L', type: 'NIE' })
    expect(checkSpanishTaxId('Y1234567X').kind).to.eq('valid')
    expect(checkSpanishTaxId('Z1234567R').kind).to.eq('valid')
    expect(checkSpanishTaxId('x-1234567-l').kind, 'after normalising').to.eq('valid')
    expect(checkSpanishTaxId('X1234567A').kind).to.eq('invalid')
    expect(checkSpanishTaxId('Y1234567L').kind, 'the same digits under another prefix').to.eq('invalid')
  })

  it('checks the K/L/M NIFs and a company’s CIF', () => {
    expect(checkSpanishTaxId('K1234567L').kind).to.eq('valid')
    expect(checkSpanishTaxId('M1234567A').kind).to.eq('invalid')
    // Columnaquiro S.L.: an S.L. (B) takes a control digit.
    expect(checkSpanishTaxId('B16365504')).to.deep.eq({ kind: 'valid', normalized: 'B16365504', type: 'CIF' })
    expect(checkSpanishTaxId('B16365505').kind).to.eq('invalid')
    expect(checkSpanishTaxId('B1636550D').kind, 'B takes a digit, not a letter').to.eq('invalid')
    // P (public body) takes a letter: 1234567 -> control 4 -> D.
    expect(checkSpanishTaxId('P1234567D').kind).to.eq('valid')
    expect(checkSpanishTaxId('P12345674').kind).to.eq('invalid')
  })

  it('calls anything else something other than a Spanish identifier', () => {
    expect(checkSpanishTaxId('')).to.deep.eq({ kind: 'empty' })
    expect(checkSpanishTaxId('   ')).to.deep.eq({ kind: 'empty' })
    expect(checkSpanishTaxId('AB1234567')).to.deep.eq({ kind: 'other', normalized: 'AB1234567' })
    expect(checkSpanishTaxId('P-123 456 789').kind, 'a passport number').to.eq('other')
  })

  it('only hands the sender something it may put in <NIF>', () => {
    expect(validSpanishTaxId('12.345.678-z')).to.eq('12345678Z')
    expect(validSpanishTaxId('12345678A')).to.eq(null)
    expect(validSpanishTaxId('AB1234567')).to.eq(null)
    expect(validSpanishTaxId(null)).to.eq(null)
  })
})
