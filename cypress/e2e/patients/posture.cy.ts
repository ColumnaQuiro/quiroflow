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

        // Shared with the patient, who sees it under Progreso.
        cy.get('[data-cy=posture-share]').check()
        cy.task<{ shared_with_patient: boolean }[]>('db:selectRows', { table: 'posture_assessments', columns: 'shared_with_patient', match: { patient_id: patient.id } }).its('0.shared_with_patient').should('eq', true)
        cy.clearAllCookies()
        cy.clearAllLocalStorage()
        cy.login(email, password)
        cy.visit('/portal/progress')
        cy.get('[data-cy=patient-posture][data-ready=true]', { timeout: 20000 }).should('be.visible')
        // One assessment: the numbers, no chart yet.
        cy.get('[data-cy=patient-posture-chart]').should('not.exist')
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
    const email = `curva-${Date.now()}@example.test`
    const password = 'valencia2026'
    const side = (earX: number) => ({ photo: 'none/right.jpg', width: 1000, height: 1800, facing: 'right', points: { ear: [earX, 100], shoulder: [500, 300], hip: [500, 900], knee: [500, 1300], ankle: [500, 1691] } })
    const front = (dropR: number) => ({
      photo: 'none/front.jpg', width: 1000, height: 1800, facing: null,
      points: { earR: [470, 100], earL: [530, 100], shoulderR: [400, 300 + dropR], shoulderL: [600, 300], hipR: [450, 900], hipL: [550, 900], kneeR: [460, 1300], kneeL: [540, 1300], ankleR: [450, 1691], ankleL: [550, 1691] },
    })
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Curva', lastName: 'Postura' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task('db:insertRows', {
          table: 'posture_assessments',
          rows: [
            { account_id: account.accountId, patient_id: patient.id, taken_at: '2026-06-02T09:00:00Z', height_cm: 170, views: { right: side(560), front: front(10) }, metrics: {}, shared_with_patient: true },
            { account_id: account.accountId, patient_id: patient.id, taken_at: '2026-09-08T09:00:00Z', height_cm: 170, views: { right: side(520), front: front(2) }, metrics: {}, shared_with_patient: true },
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

        // The patient sees the same, in their own words, once both are shared.
        cy.clearAllCookies()
        cy.clearAllLocalStorage()
        cy.login(email, password)
        cy.visit('/portal/progress')
        cy.get('[data-cy=patient-posture][data-ready=true]', { timeout: 20000 })
        cy.get('[data-cy=patient-posture-chart] circle').should('have.length', 2)
        cy.get('[data-cy=patient-posture-delta]').should('have.attr', 'data-better', 'true')
        cy.get('[data-cy=patient-posture-metric-shoulderTilt]').click()
        cy.get('[data-cy=patient-posture-delta]').should('have.attr', 'data-better', 'true')
        // The knees stay with the clinic.
        cy.get('[data-cy=patient-posture-metric-knees]').should('not.exist')
      })
    })
  })

  // La comparativa: two assessments read together, measure by measure, with
  // the earlier figure drawn over the later photo and a PDF of it. Nothing is
  // stored about it, so the patient can compare whichever were shared.
  it('compares two assessments measure by measure, for staff and for the patient, with its PDF', () => {
    const email = `comparativa-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Comparativa', lastName: 'Postura' }).then((patient) => {
        const folder = (n: number) => `${account.accountId}/posture/e2e-${patient.id}-${n}`
        const side = (n: number, earX: number) => ({ photo: `${folder(n)}/right.jpg`, width: 300, height: 600, facing: 'right', points: { ear: [earX, 40], shoulder: [150, 110], hip: [150, 300], knee: [150, 430], ankle: [150, 560] } })
        // The right shoulder drops less each time; the pelvis tilts more at the end.
        const front = (n: number, shoulderDrop: number, hipDrop: number) => ({
          photo: `${folder(n)}/front.jpg`, width: 300, height: 600, facing: null,
          points: { earR: [140, 40], earL: [160, 40], shoulderR: [110, 110 + shoulderDrop], shoulderL: [190, 110], hipR: [125, 300 + hipDrop], hipL: [175, 300], kneeR: [130, 430], kneeL: [170, 430], ankleR: [130, 560], ankleL: [170, 560] },
        })
        const row = (n: number, takenAt: string, earX: number, shoulderDrop: number, hipDrop: number, shared: boolean) => ({
          account_id: account.accountId, patient_id: patient.id, taken_at: takenAt, height_cm: 170, views: { right: side(n, earX), front: front(n, shoulderDrop, hipDrop) }, metrics: {}, shared_with_patient: shared,
        })
        cy.task('db:storePosturePhotos', { paths: [1, 2, 3].flatMap((n) => [`${folder(n)}/right.jpg`, `${folder(n)}/front.jpg`]) })
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task('db:insertRows', {
          table: 'posture_assessments',
          rows: [row(1, '2026-06-02T09:00:00Z', 185, 8, 0, true), row(2, '2026-07-14T09:00:00Z', 170, 4, 0, false), row(3, '2026-09-08T09:00:00Z', 160, 1, 6, true)],
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=progress`)
        cy.get('[data-cy=posture-section][data-ready=true]', { timeout: 20000 })
        // The first against the latest until someone picks otherwise.
        cy.get('[data-cy=posture-comparison]').should('exist')
        cy.get('[data-cy=posture-comparison-row-headWeight]').should('have.attr', 'data-verdict', 'better')
        cy.get('[data-cy=posture-comparison-row-shoulderTilt]').should('have.attr', 'data-verdict', 'better')
        cy.get('[data-cy=posture-comparison-row-hipTilt]').should('have.attr', 'data-verdict', 'worse')
        // What a photo cannot tell apart reads as the same, not as progress.
        cy.get('[data-cy=posture-comparison-row-kneeForward]').should('have.attr', 'data-verdict', 'same')
        cy.get('[data-cy=posture-comparison-headline]').invoke('text').should('match', /^\d+ of \d+ measurements improved$/)
        cy.get('[data-cy=posture-comparison-sentence]').should('contain', 'What improved most').and('contain', 'To watch: pelvic tilt')
        // The earlier figure, dashed, on the later photo only.
        cy.get('[data-cy=posture-compare-photo]').eq(1).find('[data-cy=posture-ghost]', { timeout: 20000 }).should('exist')
        cy.get('[data-cy=posture-compare-photo]').eq(0).find('[data-cy=posture-ghost]').should('not.exist')
        cy.get('[data-cy=posture-ghost-toggle]').uncheck()
        cy.get('[data-cy=posture-ghost]').should('not.exist')

        // Another pair: the middle one against the latest.
        cy.get('[data-cy=posture-row]').eq(2).find('input[type=checkbox]').first().uncheck()
        cy.get('[data-cy=posture-comparison]').should('not.exist')
        cy.get('[data-cy=posture-row]').eq(1).find('input[type=checkbox]').first().check()
        cy.get('[data-cy=posture-comparison-row-shoulderTilt]').should('have.attr', 'data-verdict', 'better')

        // Its PDF: both photos of each view, drawn by the server, as a link.
        const tab = { location: { href: '' }, close: () => {} }
        cy.window().then((win) => cy.stub(win, 'open').returns(tab))
        cy.intercept('POST', '/api/posture/*/comparison').as('comparison')
        cy.get('[data-cy=posture-comparison-report]').click()
        cy.wait('@comparison', { timeout: 40000 }).then(({ response }) => {
          expect(response!.statusCode).to.eq(200)
          expect(response!.body.fileName).to.match(/^(posture-comparison|comparativa-postural)-2026-07-14-2026-09-08\.pdf$/)
        })
        cy.wrap(tab).its('location.href').should('contain', `${account.accountId}/exports/`)
        cy.then(() => cy.request({ url: tab.location.href, encoding: 'binary' })).then((res) => {
          expect(res.headers['content-type']).to.contain('application/pdf')
          expect(String(res.body).slice(0, 5)).to.eq('%PDF-')
          // The summary and the table, then one page per view both have.
          expect(String(res.body).match(/\/Type\s*\/Page\b/g)).to.have.length(3)
        })
        // And it is in the patient's access log, like any file that leaves.
        cy.task<{ detail: { file?: string } }[]>('db:selectRows', { table: 'patient_access_log', columns: 'detail', match: { patient_id: patient.id, kind: 'file_downloaded' } }).then((rows) => {
          expect(rows.some((r) => r.detail?.file === 'posture_comparison')).to.eq(true)
        })

        // The patient: only the two that were shared, in their own words.
        cy.clearAllCookies()
        cy.clearAllLocalStorage()
        cy.login(email, password)
        cy.visit('/portal/progress')
        cy.get('[data-cy=patient-posture][data-ready=true]', { timeout: 20000 })
        // Two shared: nothing to choose between.
        cy.get('[data-cy=patient-posture-before]').should('not.exist')
        cy.get('[data-cy=patient-posture-comparison] [data-cy^=posture-comparison-row-]').should('have.length', 4)
        cy.get('[data-cy=patient-posture-comparison] [data-cy=posture-comparison-row-headWeight]').should('have.attr', 'data-verdict', 'better')
        cy.get('[data-cy=patient-posture-comparison] [data-cy=posture-comparison-row-hipTilt]').should('have.attr', 'data-verdict', 'worse')
        cy.get('[data-cy=patient-posture-photos] [data-cy=posture-ghost]', { timeout: 20000 }).should('have.length', 1)
        const patientTab = { location: { href: '' }, close: () => {} }
        cy.window().then((win) => cy.stub(win, 'open').returns(patientTab))
        cy.intercept('POST', '/api/portal/posture/*/comparison').as('patientComparison')
        cy.get('[data-cy=patient-posture-comparison-report]').click()
        cy.wait('@patientComparison', { timeout: 40000 }).its('response.statusCode').should('eq', 200)
        cy.wrap(patientTab).its('location.href').should('contain', '/exports/')

        // One that was not shared cannot be compared from the patient's side,
        // whatever id is sent.
        cy.task<{ id: string; shared_with_patient: boolean }[]>('db:selectRows', { table: 'posture_assessments', columns: 'id, shared_with_patient', match: { patient_id: patient.id } }).then((rows) => {
          const hidden = rows.find((r) => !r.shared_with_patient)!
          const shown = rows.find((r) => r.shared_with_patient)!
          cy.request({ method: 'POST', url: `/api/portal/posture/${shown.id}/comparison`, body: { withId: hidden.id }, failOnStatusCode: false }).its('status').should('eq', 404)
        })

        // With a third one shared there is a choice, and "before" stays before.
        cy.task('db:updateRows', { table: 'posture_assessments', match: { patient_id: patient.id }, values: { shared_with_patient: true } })
        cy.visit('/portal/progress')
        cy.get('[data-cy=patient-posture][data-ready=true]', { timeout: 20000 })
        cy.get('[data-cy=patient-posture-before] option').should('have.length', 2)
        cy.get('[data-cy=patient-posture-after] option').should('have.length', 2)
        cy.get('[data-cy=patient-posture-before]').select(1)
        cy.get('[data-cy=patient-posture-after] option').should('have.length', 1)
        cy.get('[data-cy=patient-posture-comparison] [data-cy=posture-comparison-row-shoulderTilt]').should('have.attr', 'data-verdict', 'better')
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
        // Dragging a point shows the magnifier, and the point moves with the
        // pointer from where it was grabbed. Pointer 1 is the mouse, the one
        // setPointerCapture accepts from a synthetic event. The press picks the
        // point nearest its coordinates, so nothing may scroll between measuring
        // and pressing: scrolled into view first, then no trigger scrolls again.
        const ev = { pointerId: 1, force: true, scrollBehavior: false as const }
        cy.get('[data-cy=posture-overlay]').scrollIntoView()
        cy.get('[data-cy=posture-point-hipR]').then(($c) => {
          const r = $c[0]!.getBoundingClientRect()
          const x = r.left + r.width / 2
          const y = r.top + r.height / 2
          cy.wrap($c).trigger('pointerdown', { ...ev, clientX: x, clientY: y })
          cy.get('[data-cy=posture-overlay]').trigger('pointermove', { ...ev, clientX: x + 20, clientY: y - 10 })
          cy.get('[data-cy=posture-loupe]').should('have.attr', 'data-point', 'hipR')
          cy.get('[data-cy=posture-overlay]').trigger('pointerup', ev)
          cy.get('[data-cy=posture-loupe]').should('not.exist')
          cy.get('[data-cy=posture-point-hipR]').should(($m) => expect($m[0]!.getBoundingClientRect().left).to.be.closeTo(r.left + 20, 1.5))
        })
        // A finger landing beside a point, off its circle, still grabs it: on an
        // iPad the circle is under half a fingertip. A mouse that far off does not.
        cy.get('[data-cy=posture-point-kneeR]').then(($c) => {
          const r = $c[0]!.getBoundingClientRect()
          const x = r.left - 10
          const y = r.top + r.height / 2
          cy.get('[data-cy=posture-overlay]').trigger('pointerdown', { ...ev, pointerType: 'mouse', clientX: x, clientY: y })
          cy.get('[data-cy=posture-loupe]').should('not.exist')
          cy.get('[data-cy=posture-overlay]').trigger('pointerup', ev)
          cy.get('[data-cy=posture-overlay]').trigger('pointerdown', { ...ev, pointerType: 'touch', clientX: x, clientY: y })
          cy.get('[data-cy=posture-overlay]').trigger('pointermove', { ...ev, clientX: x, clientY: y - 15 })
          cy.get('[data-cy=posture-loupe]').should('have.attr', 'data-point', 'kneeR')
          cy.get('[data-cy=posture-overlay]').trigger('pointerup', ev)
          cy.get('[data-cy=posture-point-kneeR]').should(($m) => expect($m[0]!.getBoundingClientRect().top).to.be.closeTo(r.top - 15, 1.5))
        })
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
