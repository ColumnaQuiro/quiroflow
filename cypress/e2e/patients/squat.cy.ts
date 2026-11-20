// Squat assessments (20261120181253_squat_assessments.sql, utils/squat.ts):
// posture_assessments of kind 'squat', two photos per angle -- standing and at
// the bottom -- taken on the same capture screen as posture, shown under
// Postura | Sentadilla on the record's Progreso. And what came with them for
// posture: the Q-angle, the camera's tilt, values written on the photo, the
// alignment index, where the weight falls and the exercises suggested.
//
// The pose model is stubbed as in posture.cy.ts (window.__postureDetect).
const PHOTO = 'cypress/fixtures/posture-figure.png'

/** 33 landmarks: a person facing the viewer's right from the side, the right leg nearer, feet included. */
function landmarks() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }))
  const set = (i: number, x: number, y: number) => (lm[i] = { x, y, visibility: 0.9 })
  set(0, 0.56, 0.1) // nose
  set(7, 0.55, 0.1)
  set(8, 0.53, 0.1)
  set(11, 0.62, 0.2)
  set(12, 0.47, 0.21)
  set(23, 0.58, 0.5)
  set(24, 0.45, 0.5)
  set(25, 0.56, 0.72)
  set(26, 0.43, 0.72)
  set(27, 0.56, 0.93)
  set(28, 0.45, 0.93)
  set(29, 0.53, 0.96) // heel L
  set(30, 0.42, 0.96) // heel R
  set(31, 0.6, 0.97) // toe L
  set(32, 0.5, 0.97) // toe R
  return lm
}
function visitCapture(patientId: string, kind: 'posture' | 'squat' = 'posture') {
  cy.visit(`/patients/posture/${patientId}${kind === 'squat' ? '?kind=squat' : ''}`, {
    onBeforeLoad: (win) => {
      ;(win as any).__postureDetect = () => landmarks()
    },
  })
  cy.get(`[data-cy=posture-capture][data-kind=${kind}][data-ready=true]`, { timeout: 20000 })
}
function photo() {
  cy.get('[data-cy=posture-file]').selectFile(PHOTO, { force: true })
  cy.get('[data-cy=posture-found]', { timeout: 20000 }).should('have.attr', 'data-found', 'true')
}

describe('Squat and posture extras', () => {
  it('takes a squat standing and at the bottom from the front and the side, and shows it on the record', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sara', lastName: 'Sentadilla' }).then((patient) => {
        cy.login(account.email, account.password)
        visitCapture(patient.id, 'squat')
        cy.get('[data-cy=posture-height]').clear().type('170')
        cy.get('[data-cy=squat-angles]').should('have.value', 'both')
        cy.get('[data-cy=posture-capture]').should('have.attr', 'data-step', 'front_up')
        cy.get('[data-cy=squat-instructions]').should('contain', 'arms straight out in front')

        photo()
        // Twelve points from the front: the feet too.
        cy.get('[data-cy=posture-overlay] circle').should('have.length', 12)
        cy.get('[data-cy=posture-next]').click()

        cy.get('[data-cy=posture-capture]').should('have.attr', 'data-step', 'front_down')
        cy.get('[data-cy=squat-instructions]').should('contain', 'hold the bottom for two seconds')
        photo()
        cy.get('[data-cy=squat-live-knee-r]').invoke('text').should('match', /°$/)
        // Scaled by the standing photo, so there are centimetres.
        cy.get('[data-cy=squat-live-shift]').invoke('text').should('match', /cm$/)
        // The values on the photo, beside their points.
        cy.get('[data-cy=posture-values]').check()
        cy.get('[data-cy=posture-callout-kneeR]').should('exist')
        cy.get('[data-cy=posture-next]').click()

        cy.get('[data-cy=posture-capture]').should('have.attr', 'data-step', 'side_up')
        photo()
        cy.get('[data-cy=posture-overlay] circle').should('have.length', 7)
        cy.get('[data-cy=posture-next]').click()
        photo()
        cy.get('[data-cy=squat-live-knee-angle]').invoke('text').should('match', /°$/)
        cy.get('[data-cy=posture-next]').click()

        cy.get('[data-cy=posture-result]').should('be.visible')
        cy.get('[data-cy=posture-notes]').type('Primera sentadilla')
        cy.get('[data-cy=posture-save]').click()

        cy.location('search', { timeout: 20000 }).should('contain', 'tab=progress')
        cy.get('[data-cy=posture-section][data-ready=true]', { timeout: 20000 })
        // A squat is not a posture assessment.
        cy.get('[data-cy=posture-empty]').should('be.visible')
        cy.get('[data-cy=posture-mode-squat]').click()
        cy.get('[data-cy=squat-section][data-ready=true]', { timeout: 20000 })
        cy.get('[data-cy=squat-row]').should('have.length', 1).and('contain', 'Primera sentadilla')
        cy.get('[data-cy=squat-kpi-kneeIn]').should('contain', '°')
        cy.get('[data-cy=squat-kpi-depth]').should('contain', '°')
        cy.get('[data-cy=squat-photo]').should('have.length', 2)
        cy.get('[data-cy=squat-table-front]').should('contain', 'Right knee inward')
        cy.get('[data-cy=squat-plane-side]').click()
        cy.get('[data-cy=squat-table-side]').should('contain', 'Knee angle')
        cy.get('[data-cy=squat-new]').should('have.attr', 'href', `/patients/posture/${patient.id}?kind=squat`)

        cy.task<{ kind: string; views: Record<string, unknown>; metrics: Record<string, unknown>; notes: string }[]>('db:selectRows', {
          table: 'posture_assessments',
          columns: 'kind, views, metrics, notes',
          match: { patient_id: patient.id },
        }).then(([a]) => {
          expect(a!.kind).to.eq('squat')
          expect(Object.keys(a!.views).sort()).to.deep.eq(['front_down', 'front_up', 'side_down', 'side_up'])
          expect(Object.keys(a!.metrics).sort()).to.deep.eq(['front_down', 'front_up', 'side_down', 'side_up'])
          expect(a!.notes).to.eq('Primera sentadilla')
        })
      })
    })
  })

  it('can take a squat from one angle only', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lado', lastName: 'Solo' }).then((patient) => {
        cy.login(account.email, account.password)
        visitCapture(patient.id, 'squat')
        cy.get('[data-cy=posture-height]').clear().type('165')
        cy.get('[data-cy=squat-angles]').select('side')
        cy.get('[data-cy=posture-step-front_up]').should('not.exist')
        cy.get('[data-cy=posture-capture]').should('have.attr', 'data-step', 'side_up')
        photo()
        cy.get('[data-cy=posture-next]').click()
        photo()
        cy.get('[data-cy=posture-next]').click()
        cy.get('[data-cy=posture-save]').click()
        cy.location('search', { timeout: 20000 }).should('contain', 'tab=progress')
        cy.task<{ views: Record<string, unknown> }[]>('db:selectRows', { table: 'posture_assessments', columns: 'views', match: { patient_id: patient.id } }).then(([a]) => {
          expect(Object.keys(a!.views).sort()).to.deep.eq(['side_down', 'side_up'])
        })
      })
    })
  })

  it('adds the Q-angle on the front photo, corrects the camera tilt, and writes values on the photo', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ángulo', lastName: 'Cu' }).then((patient) => {
        cy.login(account.email, account.password)
        visitCapture(patient.id)
        cy.get('[data-cy=posture-height]').clear().type('168')
        photo()
        cy.get('[data-cy=posture-overlay] circle').should('have.length', 10)
        cy.get('[data-cy=posture-live-q]').should('not.exist')
        cy.get('[data-cy=posture-q-add]').click()
        cy.get('[data-cy=posture-overlay] circle').should('have.length', 16)
        cy.get('[data-cy=posture-q-line]').should('have.length', 2)
        cy.get('[data-cy=posture-live-q]').invoke('text').should('match', /° \/ .*°$/)

        // Straight to start with: the vertical is vertical.
        cy.get('[data-cy=posture-plumb]').then(($l) => expect($l.attr('x1')).to.eq($l.attr('x2')))
        cy.get('[data-cy=posture-live-shoulders]').invoke('text').then((before) => {
          cy.get('[data-cy=posture-tilt-range]').invoke('val', 4).trigger('input')
          cy.get('[data-cy=posture-tilt-value]').should('contain', '4')
          cy.get('[data-cy=posture-plumb]').then(($l) => expect(Number($l.attr('x1'))).to.be.greaterThan(Number($l.attr('x2'))))
          cy.get('[data-cy=posture-live-shoulders]').invoke('text').should('not.eq', before)
        })

        cy.get('[data-cy=posture-values]').check()
        cy.get('[data-cy=posture-callout-shoulders]').should('exist')
        cy.get('[data-cy=posture-callout-qR]').should('exist')

        cy.get('[data-cy=posture-q-remove]').click()
        cy.get('[data-cy=posture-overlay] circle').should('have.length', 10)
      })
    })
  })

  it('shows the alignment index, where the weight falls, and gives the suggested exercises', () => {
    // A head well forward and the right shoulder low: suggestions for both.
    const side = { photo: 'none/right.jpg', width: 1000, height: 1800, facing: 'right', points: { ear: [580, 100], shoulder: [530, 300], hip: [500, 900], knee: [500, 1300], ankle: [500, 1691] } }
    const front = { photo: 'none/front.jpg', width: 1000, height: 1800, facing: null, points: { earR: [470, 100], earL: [530, 100], shoulderR: [400, 340], shoulderL: [600, 300], hipR: [450, 900], hipL: [550, 900], kneeR: [450, 1300], kneeL: [550, 1300], ankleR: [450, 1691], ankleL: [550, 1691] } }
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Índice', lastName: 'Postura' }).then((patient) => {
        cy.task('db:insertRows', {
          table: 'posture_assessments',
          rows: [{ account_id: account.accountId, patient_id: patient.id, taken_at: '2026-11-02T09:00:00Z', height_cm: 170, views: { right: side, front }, metrics: {} }],
        })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=progress`)
        cy.get('[data-cy=posture-section][data-ready=true]', { timeout: 20000 })
        cy.get('[data-cy=posture-kpi-alignment]').invoke('text').should('match', /\d+\s*\/100/)
        // Symmetric from the front: half the weight on each foot.
        cy.get('[data-cy=posture-balance]').should('have.attr', 'data-right', '50')
        cy.get('[data-cy=posture-suggestion-head]').should('exist')
        cy.get('[data-cy=posture-suggestion-shoulderTilt]').should('exist')
        cy.get('[data-cy=posture-suggestion-exercise-chin-tuck] input').should('be.checked')
        // Leave one out.
        cy.get('[data-cy=posture-suggestion-exercise-standing-side-bend] input').uncheck()
        cy.get('[data-cy=posture-suggestions-assign]').should('not.be.disabled').click()
        // Given once: shown as already had, not offered again. (Waited for
        // here, before reading the database, which a task does not retry.)
        cy.get('[data-cy=posture-suggestion-exercise-chin-tuck]', { timeout: 20000 }).should('contain', 'already has it')
        cy.task<{ exercise_id: string }[]>('db:selectRows', { table: 'patient_exercises', columns: 'exercise_id', match: { patient_id: patient.id } }).should('have.length.greaterThan', 2)
        cy.task<{ starter_key: string }[]>('db:selectRows', { table: 'exercises', columns: 'starter_key', match: { account_id: account.accountId } }).then((rows) => {
          const keys = rows.map((r) => r.starter_key)
          expect(keys).to.include('chin-tuck')
          expect(keys).not.to.include('standing-side-bend')
        })
      })
    })
  })
})
