import { findMisreferencedPatients } from '../../../utils/practicehubReferences'

// PracticeHub's CSV export puts a patient's custom reference -- a DNI, an NIE,
// a passport -- in the "Patient Number" column whenever they have one, and the
// Patients importer reads that column. Those patients then arrive keyed by
// their ID document instead of their patient number.
//
// Nothing errors. The patient imports fine. Every LATER importer matches on
// external_reference, so their invoices, payments and bonos silently never
// arrive. On Columnaquiro that was 44 patients, unnoticed for a month.
//
// This is the check that names them, tested against the shapes that actually
// occurred rather than through the UI, because the UI needs a live
// PracticeHub connection and the logic is the part worth pinning down.
describe('Spotting patients stored under the wrong PracticeHub reference', () => {
  const phPatients = [
    { patient_number: '202400007', custom_reference: 'Y7980067R' },
    { patient_number: '202400001', custom_reference: '44507825L' },
    { patient_number: '202400098', custom_reference: '2981208409992' },
    { patient_number: '202400500', custom_reference: null },
  ]

  it('names a patient keyed by their DNI, and says what it should be', () => {
    const found = findMisreferencedPatients(phPatients, [
      { external_reference: 'Y7980067R', first_name: 'Ivanna', last_name: 'Acosta' },
    ])
    expect(found).to.have.length(1)
    expect(found[0].name).to.eq('Ivanna Acosta')
    expect(found[0].stored).to.eq('Y7980067R')
    expect(found[0].shouldBe).to.eq('202400007')
  })

  it('catches an all-digit custom reference, which no format check would', () => {
    // Two of Columnaquiro's 44 looked exactly like a patient number. This is
    // the case that makes comparing against PracticeHub's own value -- rather
    // than guessing from the shape -- the only approach that works.
    const found = findMisreferencedPatients(phPatients, [
      { external_reference: '2981208409992', first_name: 'Christina Rosalee', last_name: 'Hui' },
    ])
    expect(found).to.have.length(1)
    expect(found[0].shouldBe).to.eq('202400098')
  })

  it('leaves correctly stored patients alone', () => {
    const found = findMisreferencedPatients(phPatients, [
      { external_reference: '202400007', first_name: 'Ivanna', last_name: 'Acosta' },
      { external_reference: '202400500', first_name: 'Ana', last_name: null },
    ])
    expect(found).to.have.length(0)
  })

  it('does not guess about a reference PracticeHub does not recognise at all', () => {
    // A deleted patient, or a value typed by hand. It is wrong, but nothing
    // here knows what it should be, and "should be X" without knowing X is
    // worse than saying nothing.
    const found = findMisreferencedPatients(phPatients, [
      { external_reference: 'WHO-KNOWS', first_name: 'Mystery', last_name: 'Patient' },
    ])
    expect(found).to.have.length(0)
  })

  it('ignores patients with no reference at all', () => {
    // Created in QuiroFlow, never in PracticeHub -- Jordana's patients.
    const found = findMisreferencedPatients(phPatients, [
      { external_reference: null, first_name: 'Native', last_name: 'Patient' },
    ])
    expect(found).to.have.length(0)
  })
})
