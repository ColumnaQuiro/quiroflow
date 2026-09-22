import { parseVisitNote, visitNotePreview } from '../../../utils/visitNote'

// Unit-style: no cy.visit, no seeding. A visit note is one text column that
// the charting pane writes in four labelled sections. That convention lived
// privately inside ExamAutofill, so the only component that could render a
// note with its structure intact was the one that wrote it.
describe('Reading a visit note', () => {
  const written = [
    'Subjective: Lower back pain, worse in the mornings.',
    'Objective: Restricted lumbar flexion, no neuro deficit.',
    'Action: Adjustment L5, soft tissue work.',
    'Plan: Review in one week.',
  ].join('\n\n')

  it('recovers the four sections the charting pane wrote', () => {
    const parsed = parseVisitNote(written)
    expect(parsed.structured).to.equal(true)
    expect(parsed.sections.map((s) => s.label)).to.deep.equal(['Subjective', 'Objective', 'Action', 'Plan'])
    expect(parsed.sections[2].text).to.equal('Adjustment L5, soft tissue work.')
  })

  it('keeps the sections in clinical order, not the order they were stored', () => {
    const jumbled = ['Plan: Review in a week.', 'Subjective: Sore.'].join('\n\n')
    expect(parseVisitNote(jumbled).sections.map((s) => s.label)).to.deep.equal(['Subjective', 'Plan'])
  })

  it('shows an unstructured note as itself rather than dropping it', () => {
    // Notes predate the convention, and notes get pasted in. Parsing text
    // you did not write and silently discarding the remainder is how a
    // clinical record loses a sentence.
    const freeform = 'Adjustment to L5. Patient reports improvement since last session.'
    const parsed = parseVisitNote(freeform)
    expect(parsed.structured).to.equal(false)
    expect(parsed.sections).to.have.length(0)
    expect(parsed.preamble).to.equal(freeform)
  })

  it('keeps text that sits outside the sections', () => {
    const mixed = ['Referred by GP.', 'Subjective: Sore shoulder.'].join('\n\n')
    const parsed = parseVisitNote(mixed)
    expect(parsed.preamble).to.equal('Referred by GP.')
    expect(parsed.sections).to.have.length(1)
  })

  it('does not mistake an arbitrary colon for a section', () => {
    const tricky = 'Note: patient called ahead\n\nSubjective: Sore.'
    const parsed = parseVisitNote(tricky)
    expect(parsed.sections.map((s) => s.label)).to.deep.equal(['Subjective'])
    expect(parsed.preamble).to.contain('patient called ahead')
  })

  it('previews what the patient said, which is what a list is scanned for', () => {
    expect(visitNotePreview(written)).to.equal('Lower back pain, worse in the mornings.')
  })

  it('previews an unstructured note from its own text', () => {
    expect(visitNotePreview('Adjustment to L5.')).to.equal('Adjustment to L5.')
  })

  it('truncates a long preview on a character, not mid-render', () => {
    const long = `Subjective: ${'a'.repeat(300)}`
    const preview = visitNotePreview(long, 40)
    expect(preview).to.have.length(40)
    expect(preview.endsWith('…')).to.equal(true)
  })

  it('treats an empty note as empty rather than throwing', () => {
    expect(parseVisitNote(null).structured).to.equal(false)
    expect(visitNotePreview(null)).to.equal('')
  })
})
