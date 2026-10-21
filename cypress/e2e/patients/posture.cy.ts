// Posture assessments (20261017183504_posture_assessments.sql): photos per
// view, the points placed by the pose model and corrected by hand, the
// measurements live (utils/posture.ts), saved with the photos; shown on the
// record's Progreso; shared with the patient, who sees it on the portal.
//
// The pose model is stubbed (window.__postureDetect, see usePoseModel): the
// specs place known landmarks rather than fetch an 11 MB model.
const PHOTO = 'cypress/fixtures/posture-figure.png'

/** 33 landmarks of a person standing a little round-shouldered, facing the viewer's right in a side photo. */
function landmarks() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }))
  const set = (i: number, x: number, y: number) => (lm[i] = { x, y, visibility: 0.9 })
  set(0, 0.56, 0.1) // nose
  set(7, 0.55, 0.1) // ear L
  set(8, 0.53, 0.1) // ear R -- ahead of the shoulder below it
  set(11, 0.62, 0.2)
  set(12, 0.47, 0.21) // shoulder R, a touch lower
  set(23, 0.58, 0.5)
  set(24, 0.45, 0.5)
  set(25, 0.56, 0.72)
  set(26, 0.45, 0.72)
  set(27, 0.56, 0.93)
  set(28, 0.45, 0.93)
  return lm
}
function visitCapture(patientId: string, found = true) {
  cy.visit(`/patients/posture/${patientId}`, {
    onBeforeLoad: (win) => {
      ;(win as any).__postureDetect = () => (found ? landmarks() : null)
    },
  })
  cy.get('[data-cy=posture-capture][data-ready=true]', { timeout: 20000 })
}
function photo() {
  cy.get('[data-cy=posture-file]').selectFile(PHOTO, { force: true })
}

describe('Posture assessment', () => {
  // On a phone the camera and the photo library are two buttons: one input
  // with `capture` opened the camera only, and the button said "or choose".
  it('offers the camera and the gallery on a touch screen, and only the file picker on a desktop', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Galería', lastName: 'Cámara' }).then((patient) => {
        cy.login(account.email, account.password)
        visitCapture(patient.id)
        cy.get('[data-cy=posture-camera]').should('not.exist')
        cy.get('[data-cy=posture-take]').should('be.visible').and('contain', 'Choose photo')

        cy.useTouchScreen()
        visitCapture(patient.id)
        cy.get('[data-cy=posture-camera]').should('be.visible')
        cy.get('[data-cy=posture-take]').should('be.visible').and('contain', 'Choose from gallery')
        cy.get('[data-cy=posture-camera-file]').should('have.attr', 'capture', 'environment')
        cy.get('[data-cy=posture-file]').should('not.have.attr', 'capture')
      })
    })
  })

  it('takes front and side, measures them live, saves, and shows them on the record and to the patient', () => {
    const email = `postura-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Postura' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.login(account.email, account.password)
        visitCapture(patient.id)
        cy.get('[data-cy=posture-height]').clear().type('168')
        cy.get('[data-cy=posture-take]').should('be.visible')
        photo()
        cy.get('[data-cy=posture-found]', { timeout: 20000 }).should('have.attr', 'data-found', 'true')
        cy.get('[data-cy=posture-overlay] circle').should('have.length', 10)
        // The right shoulder is lower: a positive tilt.
        cy.get('[data-cy=posture-live-shoulders]').invoke('text').should('match', /^\d+(,\d)? °$/)
        cy.get('[data-cy=posture-next]').click()

        cy.get('[data-cy=posture-capture]').should('have.attr', 'data-step', 'right')
        photo()
        cy.get('[data-cy=posture-overlay] circle', { timeout: 20000 }).should('have.length', 5)
        cy.get('[data-cy=posture-live-weight]').invoke('text').should('match', /kg$/)
        cy.get('[data-cy=posture-next]').click()
        cy.get('[data-cy=posture-skip]').click()
        cy.get('[data-cy=posture-result]').should('be.visible')
        cy.get('[data-cy=posture-notes]').type('Primera valoración')
        cy.get('[data-cy=posture-save]').click()

        cy.location('search', { timeout: 20000 }).should('contain', 'tab=progress')
        cy.get('[data-cy=posture-section][data-ready=true]', { timeout: 20000 })
        cy.get('[data-cy=posture-row]').should('have.length', 1)
        cy.get('[data-cy=posture-kpi-weight]').should('contain', 'kg')
        cy.get('[data-cy=posture-compare-photo] [data-cy=posture-overlay]').should('have.length', 1)
        cy.task<{ height_cm: number; views: Record<string, { photo: string; points: Record<string, number[]> }>; metrics: Record<string, unknown>; shared_with_patient: boolean }[]>('db:selectRows', {
          table: 'posture_assessments',
          columns: 'height_cm, views, metrics, shared_with_patient',
          match: { patient_id: patient.id },
        }).then(([a]) => {
          expect(Number(a!.height_cm)).to.eq(168)
          expect(Object.keys(a!.views).sort()).to.deep.eq(['front', 'right'])
          expect(a!.views.front!.photo).to.match(new RegExp(`^${account.accountId}/posture/[0-9a-f-]+/front\\.jpg$`))
          // jsonb keeps keys in its own order.
          expect(Object.keys(a!.views.right!.points).sort()).to.deep.eq(['ankle', 'ear', 'hip', 'knee', 'shoulder'])
          expect(a!.metrics).to.have.keys(['front', 'right'])
          expect(a!.shared_with_patient).to.eq(false)
        })

        // The report: drawn by the server from the stored photos and handed
        // back as a link, which the page opens in the tab it opened on the tap.
        const tab = { location: { href: '' }, close: () => {} }
        cy.window().then((win) => cy.stub(win, 'open').returns(tab))
        cy.intercept('POST', '/api/posture/*/report').as('report')
        cy.get('[data-cy=posture-report]').click()
        cy.wait('@report', { timeout: 40000 }).its('response.statusCode').should('eq', 200)
        cy.wrap(tab).its('location.href').should('contain', 'informe.pdf')
        cy.then(() => cy.request({ url: tab.location.href, encoding: 'binary' })).then((res) => {
          expect(res.headers['content-type']).to.contain('application/pdf')
          expect(String(res.body).slice(0, 5)).to.eq('%PDF-')
        })

        // Shared with the patient, who sees it on the portal's home.
        cy.get('[data-cy=posture-share]').check()
        cy.task<{ shared_with_patient: boolean }[]>('db:selectRows', { table: 'posture_assessments', columns: 'shared_with_patient', match: { patient_id: patient.id } }).its('0.shared_with_patient').should('eq', true)
        cy.clearAllCookies()
        cy.clearAllLocalStorage()
        cy.login(email, password)
        cy.visit('/portal')
        cy.get('[data-cy=patient-posture]', { timeout: 20000 }).should('be.visible')
        cy.get('[data-cy=patient-posture-weight]').should('contain', 'kg')
        cy.get('[data-cy=patient-posture] [data-cy=posture-overlay] image').should('have.attr', 'href').and('contain', 'token=')
        // And the report, from their side: only because it was shared.
        const patientTab = { location: { href: '' }, close: () => {} }
        cy.window().then((win) => cy.stub(win, 'open').returns(patientTab))
        cy.intercept('POST', '/api/portal/posture/*/report').as('patientReport')
        cy.get('[data-cy=patient-posture-report]').click()
        cy.wait('@patientReport', { timeout: 40000 }).its('response.statusCode').should('eq', 200)
        cy.wrap(patientTab).its('location.href').should('contain', 'informe.pdf')
      })
    })
  })

  // Evolución: any headline number across every assessment, measured again
  // from the points (so these rows, saved with no metrics, still plot).
  it('charts each number across the assessments and says whether it got better', () => {
    const side = (earX: number) => ({ photo: 'none/right.jpg', width: 1000, height: 1800, facing: 'right', points: { ear: [earX, 100], shoulder: [500, 300], hip: [500, 900], knee: [500, 1300], ankle: [500, 1691] } })
    const front = (dropR: number) => ({
      photo: 'none/front.jpg', width: 1000, height: 1800, facing: null,
      points: { earR: [470, 100], earL: [530, 100], shoulderR: [400, 300 + dropR], shoulderL: [600, 300], hipR: [450, 900], hipL: [550, 900], kneeR: [460, 1300], kneeL: [540, 1300], ankleR: [450, 1691], ankleL: [550, 1691] },
    })
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Curva', lastName: 'Postura' }).then((patient) => {
        cy.task('db:insertRows', {
          table: 'posture_assessments',
          rows: [
            { account_id: account.accountId, patient_id: patient.id, taken_at: '2026-06-02T09:00:00Z', height_cm: 170, views: { right: side(560), front: front(10) }, metrics: {} },
            { account_id: account.accountId, patient_id: patient.id, taken_at: '2026-09-08T09:00:00Z', height_cm: 170, views: { right: side(520), front: front(2) }, metrics: {} },
          ],
        })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=progress`)
        cy.get('[data-cy=posture-section][data-ready=true]', { timeout: 20000 })
        cy.get('[data-cy=posture-trend]').should('have.attr', 'data-metric', 'headWeight')
        cy.get('[data-cy=posture-trend] circle').should('have.length', 2)
        cy.get('[data-cy=posture-trend-summary]').should('have.attr', 'data-better', 'true')
        // Knees were never stored on these rows; they are measured from the points.
        cy.get('[data-cy=posture-trend-knees]').should('exist')
        cy.get('[data-cy=posture-trend-shoulderTilt]').click()
        cy.get('[data-cy=posture-trend]').should('have.attr', 'data-metric', 'shoulderTilt')
        cy.get('[data-cy=posture-trend-summary]').should('have.attr', 'data-better', 'true')
      })
    })
  })

  it('lets the points be placed by hand when nobody is found', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Mano', lastName: 'Puntos' }).then((patient) => {
        cy.login(account.email, account.password)
        visitCapture(patient.id, false)
        cy.get('[data-cy=posture-height]').clear().type('175')
        photo()
        cy.get('[data-cy=posture-found]', { timeout: 20000 }).should('have.attr', 'data-found', 'false')
        cy.get('[data-cy=posture-overlay] circle').should('have.length', 10)
      })
    })
  })

  it('is not written for another clinic’s patient', () => {
    cy.seedStaffAccount().then((other) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: other.accountId, clinicId: other.clinicId, firstName: 'Ajena', lastName: 'Postura' }).then((stranger) => {
        cy.seedStaffAccount().then((account) => {
          cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
            email: account.email,
            password: account.password,
            table: 'posture_assessments',
            op: 'insert',
            values: { account_id: account.accountId, patient_id: stranger.id, height_cm: 170 },
          }).then((r) => {
            expect(r.changed).to.eq(0)
          })
          cy.task('db:selectRows', { table: 'posture_assessments', columns: 'id', match: { patient_id: stranger.id } }).should('have.length', 0)
        })
      })
    })
  })
})
