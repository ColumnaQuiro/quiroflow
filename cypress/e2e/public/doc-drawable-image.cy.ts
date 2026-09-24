// The drawable-image block on the patient-facing form (/doc/[token]): a
// diagram the clinic uploaded, with a canvas over it the patient marks their
// pain on.
//
// Two things about it are worth a test and neither shows up by eye. The
// canvas takes its size from the diagram underneath, which arrives over the
// network *after* the block has mounted -- so the buffer has to be re-fitted
// once it lands or every mark is offset from the finger that made it. And
// what gets stored is the canvas alone, a transparent PNG, which means the
// assertion that matters is on `fields` in the database, not on the screen.

/**
 * Where the marks actually are, in the CSS pixels the finger was at -- the
 * drawing buffer and the rendered box are different sizes, and it is their
 * disagreement that puts ink somewhere other than under the finger.
 */
function ink($canvas: JQuery<HTMLElement>) {
  const canvas = $canvas[0] as HTMLCanvasElement
  const ctx = canvas.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const perCssPixel = canvas.width / canvas.getBoundingClientRect().width
  const bounds = { painted: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) continue
    const pixel = (i - 3) / 4
    const x = (pixel % canvas.width) / perCssPixel
    const y = Math.floor(pixel / canvas.width) / perCssPixel
    bounds.painted += 1
    bounds.minX = Math.min(bounds.minX, x)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.minY = Math.min(bounds.minY, y)
    bounds.maxY = Math.max(bounds.maxY, y)
  }
  return bounds
}

/** One finger down, dragged, lifted. */
function stroke(from: [number, number], to: [number, number]) {
  const options = { eventConstructor: 'PointerEvent', pointerId: 1 }
  cy.get('canvas').trigger('pointerdown', from[0], from[1], options)
  cy.get('canvas').trigger('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, options)
  cy.get('canvas').trigger('pointermove', to[0], to[1], options)
  cy.get('canvas').trigger('pointerup', to[0], to[1], options)
}

function openPainMapDoc(value: string | null) {
  return cy.seedStaffAccount().then((account) => {
    return cy.task('db:uploadDocImage', { accountId: account.accountId }).then((imagePath: any) => {
      return cy
        .task('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Dolor',
          lastName: 'Cervical',
        })
        .then((patient: any) => {
          return cy
            .task('db:createPatientDoc', {
              accountId: account.accountId,
              patientId: patient.id,
              title: 'Mapa del dolor',
              fields: [{ id: 'pain-1', type: 'drawable_image', label: '¿Dónde te duele?', imagePath, value }],
            })
            .then((doc: any) => {
              cy.visit(`/doc/${doc.publicToken}`)
              cy.contains('Mapa del dolor').should('be.visible')
              // The diagram has to have laid out before any coordinate here
              // means anything -- until it does, the box is only the
              // min-height placeholder.
              cy.get('img[alt="Diagram to draw on"]').should('be.visible').and(($img) => {
                expect(($img[0] as HTMLImageElement).naturalWidth, 'the diagram loaded from the public bucket').to.be.greaterThan(0)
              })
              return cy.wrap(doc.docId)
            })
        })
    })
  })
}

describe('Marking a pain map on a patient form', () => {
  // A typical Android phone: the diagram is scaled down to ~330px wide there,
  // so the buffer-vs-box sizing is exercised at the size that matters.
  beforeEach(() => cy.viewport(360, 740))

  it('puts the marks under the finger and keeps them across strokes', () => {
    openPainMapDoc(null)

    stroke([40, 60], [100, 140])

    cy.get('canvas')
      .then(ink)
      .then((first) => {
        expect(first.painted, 'ink from the first mark').to.be.greaterThan(0)
        expect(first.minX, 'left edge of the mark').to.be.closeTo(40, 5)
        expect(first.maxX, 'right edge of the mark').to.be.closeTo(100, 5)
        expect(first.minY, 'top edge of the mark').to.be.closeTo(60, 5)
        expect(first.maxY, 'bottom edge of the mark').to.be.closeTo(140, 5)

        // Lifting the finger emits the PNG. A pain map is not finished at
        // that point the way a signature is -- it usually takes several
        // areas -- so the canvas must still be there and still accumulating.
        stroke([150, 60], [200, 100])
        cy.get('canvas')
          .then(ink)
          .should((both) => {
            expect(both.painted, 'ink after a second mark').to.be.greaterThan(first.painted)
            expect(both.maxX, 'the second mark reached where the finger did').to.be.closeTo(200, 5)
          })
      })
  })

  it('marks a single tap, which is how one sore spot gets answered', () => {
    openPainMapDoc(null)

    const options = { eventConstructor: 'PointerEvent', pointerId: 1 }
    cy.get('canvas').trigger('pointerdown', 120, 90, options)
    cy.get('canvas').trigger('pointerup', 120, 90, options)

    // A stroke that never moves draws nothing at all unless the dot is drawn
    // deliberately, and "it hurts here" is one point rather than a scribble.
    cy.get('canvas')
      .then(ink)
      .should((dot) => {
        expect(dot.painted, 'ink from a tap that never moved').to.be.greaterThan(0)
        expect(dot.minX, 'the dot is where the finger was').to.be.closeTo(120, 5)
        expect(dot.minY, 'the dot is where the finger was').to.be.closeTo(90, 5)
      })
  })

  it('stores the marks, and only the marks, when the form is submitted', () => {
    openPainMapDoc(null).then((docId) => {
      stroke([40, 60], [100, 140])
      cy.contains('button', 'Submit').click()
      cy.contains('This document has been completed.').should('be.visible')

      cy.task('db:patientDocFields', { docId }).should((doc: any) => {
        expect(doc.completedAt, 'the document is marked completed').to.not.equal(null)
        const field = doc.fields[0]
        expect(field.value, 'the drawing was saved as a PNG data URL').to.match(/^data:image\/png;base64,/)
        // The diagram stays a bucket path next to the drawing rather than
        // being flattened into it -- that is what keeps the stored payload
        // the size of a few strokes.
        expect(field.imagePath, 'the diagram is still referenced by path').to.be.a('string')
      })
    })
  })

  it('reopens a saved drawing as something that can still be added to', () => {
    // A 2x2 PNG of solid opaque red, standing in for marks made on an earlier
    // visit and read back from the database. Deliberately NOT the 1x1 stand-in
    // doc-signature.cy.ts uses: that one is a fully transparent pixel, which
    // is fine there because nothing ever reads its pixels, and useless here
    // because "the drawing came back" is exactly an assertion about pixels.
    const SAVED =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGO4o6b2H4QZYAwATLwInddJ0yUAAAAASUVORK5CYII='
    openPainMapDoc(SAVED)

    // Painted back onto the canvas, not shown as a picture of itself: the
    // signature pad's read-only preview would make a second area of pain
    // impossible to add, and the practitioner reviewing this in the patient's
    // Documents tab is looking at the same component.
    cy.get('canvas')
      .should('be.visible')
      .then(ink)
      .should((saved) => expect(saved.painted, 'the saved drawing is back on the canvas').to.be.greaterThan(0))

    cy.contains('button', 'Clear drawing').click()
    cy.get('canvas').then(ink).should('have.property', 'painted', 0)

    stroke([40, 60], [100, 140])
    cy.get('canvas')
      .then(ink)
      .should((after) => {
        expect(after.painted, 'ink drawn after clearing').to.be.greaterThan(0)
        expect(after.minX, 'and still under the finger').to.be.closeTo(40, 5)
      })
  })
})
