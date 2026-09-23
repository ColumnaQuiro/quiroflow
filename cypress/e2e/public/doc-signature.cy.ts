// The signature pad on the patient-facing form (/doc/[token]). Everything
// checked here was reported from Android phones and is invisible to a mouse:
// a mouse signature is one uninterrupted drag, so it never meets the pad
// going read-only at the first pen lift, and never needs the Clear button to
// recover from it.
const SIGNATURE_FIELD = {
  id: 'sig-1',
  type: 'signature',
  label: 'Signature of the patient',
  required: true,
}

// 1x1 black PNG -- stands in for a signature drawn on an earlier visit and
// read back from the database, which is the only state the <img> preview is
// for.
const SAVED_SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/**
 * Where the ink actually is, in the CSS pixels the finger was at -- which is
 * the comparison that matters, because the drawing buffer and the rendered
 * box are two different sizes and it is their disagreement that puts ink
 * somewhere other than under the finger.
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

/** One finger down, dragged, lifted -- a single stroke of a signature. */
function stroke(from: [number, number], to: [number, number]) {
  const options = { eventConstructor: 'PointerEvent', pointerId: 1 }
  cy.get('canvas').trigger('pointerdown', from[0], from[1], options)
  cy.get('canvas').trigger('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, options)
  cy.get('canvas').trigger('pointermove', to[0], to[1], options)
  cy.get('canvas').trigger('pointerup', to[0], to[1], options)
}

function openSignableDoc(value: string | null) {
  cy.seedStaffAccount().then((account) => {
    cy.task('db:createPatient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Firma',
      lastName: 'Pendiente',
    }).then((patient: any) => {
      cy.task('db:createPatientDoc', {
        accountId: account.accountId,
        patientId: patient.id,
        title: 'Consentimiento informado',
        fields: [{ ...SIGNATURE_FIELD, value }],
      }).then((doc: any) => {
        cy.visit(`/doc/${doc.publicToken}`)
        cy.contains('Consentimiento informado').should('be.visible')
      })
    })
  })
}

describe('Signing a patient form', () => {
  // The width of a typical Android phone, where these were reported: the pad
  // is ~280px wide there, so the buffer-vs-box sizing is exercised at the
  // size that matters rather than at a desktop's.
  beforeEach(() => cy.viewport(360, 740))

  it('stays drawable after the first stroke, so a signature can take more than one', () => {
    openSignableDoc(null)

    stroke([30, 30], [90, 80])

    // Lifting the pen emits the signature, which used to swap the canvas for
    // a picture of it: every stroke after the first landed on an image and
    // was lost, which on a phone is most of a signature.
    cy.get('img[alt="Signature"]').should('not.exist')
    cy.get('canvas').should('be.visible')

    cy.get('canvas')
      .then(ink)
      .then((first) => {
        expect(first.painted, 'ink from the first stroke').to.be.greaterThan(0)

        stroke([120, 30], [180, 80])

        cy.get('canvas')
          .then(ink)
          .should((both) => {
            expect(both.painted, 'ink after a second stroke').to.be.greaterThan(first.painted)
            expect(both.maxX, 'the second stroke reached where the finger did').to.be.closeTo(180, 4)
          })
      })
  })

  it('clears a signature that was already saved, back to an empty pad', () => {
    openSignableDoc(SAVED_SIGNATURE)

    cy.get('img[alt="Signature"]').should('be.visible')

    // The button did nothing at all in this state: it read the canvas, which
    // the preview had replaced, and gave up before emitting anything.
    cy.contains('button', 'Clear signature').click()

    cy.get('img[alt="Signature"]').should('not.exist')
    cy.get('canvas').should('be.visible').then(ink).should('have.property', 'painted', 0)

    // The pad then takes a new signature straight away, under the finger --
    // it is a brand new canvas element, so it has to be re-fitted to its box
    // or the ink lands offset from where it was drawn.
    stroke([30, 30], [90, 80])
    cy.get('canvas')
      .then(ink)
      .should((second) => {
        expect(second.painted, 'ink from the signature drawn after clearing').to.be.greaterThan(0)
        expect(second.minX, 'left edge of the stroke').to.be.closeTo(30, 4)
        expect(second.maxX, 'right edge of the stroke').to.be.closeTo(90, 4)
        expect(second.minY, 'top edge of the stroke').to.be.closeTo(30, 4)
        expect(second.maxY, 'bottom edge of the stroke').to.be.closeTo(80, 4)
      })
  })
})
