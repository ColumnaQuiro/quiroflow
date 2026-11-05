// Patient education (20261017175432_patient_education.sql): the clinic's
// library starts from QuiroFlow's twelve and is the clinic's to edit; a
// practitioner sends one from the record, suggested by the patient's motivo
// de consulta; it is read from the no-login link or in the portal's "Para
// ti", and the record then says it was read.
//
// Neither email nor push is configured here, so a send falls back to the
// link the practitioner copies -- the same path a patient with no app and no
// email takes.
type Send = { id: string; token: string; channel: string | null; opened_at: string | null }
const sendsOf = (patientId: string) => cy.task<Send[]>('db:selectRows', { table: 'learn_sends', columns: 'id, token, channel, opened_at', match: { patient_id: patientId } })

describe('Patient education', () => {
  it('starts the library from QuiroFlow’s articles, and edits, adds and deletes its own', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/education')
      cy.get('[data-cy=learn-library][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=learn-add-starters]').click()
      cy.get('[data-cy=learn-row]').should('have.length', 12)
      cy.get('[data-cy=learn-starters]').should('not.exist')
      cy.get('[data-cy=learn-filter-embarazo]').click()
      cy.get('[data-cy=learn-row]').should('have.length', 1).and('contain', 'Espalda y embarazo')
      cy.get('[data-cy=learn-filter-all]').click()

      // A new one of the clinic's own, with a video.
      cy.get('[data-cy=learn-new]').click()
      cy.get('[data-cy=learn-title]').type('Nuestro método')
      cy.get('[data-cy=learn-body]').type('Primer párrafo.{enter}{enter}Segundo párrafo.')
      cy.get('[data-cy=learn-video-url]').type('https://youtu.be/dQw4w9WgXcQ')
      cy.get('[data-cy=learn-tag-primera_visita]').click()
      cy.get('[data-cy=learn-minutes]').type('2')
      cy.get('[data-cy=learn-save]').click()
      cy.get('[data-cy=learn-row]').should('have.length', 13)
      cy.task<{ title: string; tags: string[]; video_url: string; starter_key: string | null }[]>('db:selectRows', { table: 'learn_articles', columns: 'title, tags, video_url, starter_key', match: { account_id: account.accountId, title: 'Nuestro método' } }).then(([a]) => {
        expect(a!.tags).to.deep.eq(['primera_visita'])
        expect(a!.starter_key).to.eq(null)
      })
      // Never sent, so it can be deleted outright.
      cy.contains('[data-cy=learn-row]', 'Nuestro método').find('[data-cy=learn-delete]').click()
      cy.get('[data-cy=learn-row]').should('have.length', 12)
    })
  })

  it('sends one from the record, suggested by the complaint; read from the link, the record says so', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Lectura' }).then((patient) => {
        cy.task('db:updateRows', { table: 'patients', values: { chief_complaint: 'Dolor lumbar con ciática' }, match: { id: patient.id } })
        cy.task('db:insertRows', {
          table: 'learn_articles',
          rows: [
            { account_id: account.accountId, title: 'A · Cuello y pantallas', body: 'Uno.\n\nDos.', tags: ['cervical'] },
            { account_id: account.accountId, title: 'B · Hernia discal', body: 'El disco es un cojín.\n\nMoverse ayuda.', tags: ['lumbar'], minutes: 4 },
          ],
        })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy=learn-staff][data-ready=true]', { timeout: 20000 }).should('contain', 'Nothing sent yet')
        cy.clickUntil('[data-cy=learn-send-open]', '[data-cy=learn-send-form]')
        // The lumbar one first, starred, though it is second by title.
        cy.get('[data-cy=learn-pick] option').first().should('contain', '★ B · Hernia discal')
        cy.get('[data-cy=learn-send]').click()
        cy.get('[data-cy=learn-sent-result]').should('have.attr', 'data-channel', 'link')
        cy.get('[data-cy=learn-sent-row]').should('have.length', 1).and('contain', 'B · Hernia discal').find('[data-cy=learn-sent-status]').should('contain', 'Not opened')

        sendsOf(patient.id).then(([send]) => {
          expect(send!.channel).to.eq('link')
          expect(send!.opened_at).to.eq(null)
          // The patient opens the link, with no login.
          cy.clearAllCookies()
          cy.clearAllLocalStorage()
          cy.visit(`/aprende/${send!.token}`)
          cy.get('[data-cy=learn-link][data-phase=ready]', { timeout: 20000 })
          cy.get('[data-cy=learn-article] h1').should('have.text', 'B · Hernia discal')
          cy.get('[data-cy=learn-paragraph]').should('have.length', 2)
          sendsOf(patient.id).its('0.opened_at').should('be.a', 'string')
        })
        cy.visit('/aprende/0000000000000000000000000000000000ff')
        cy.get('[data-cy=learn-link-invalid]').should('be.visible')

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy=learn-sent-status]', { timeout: 20000 }).should('contain', 'Read')
      })
    })
  })

  it('shows it in the portal’s "Para ti", where opening it marks it read', () => {
    const email = `lectura-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Portal' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task<{ id: string }[]>('db:insertRows', { table: 'learn_articles', rows: [{ account_id: account.accountId, title: 'Frío o calor', body: 'Frío al principio.\n\nCalor después.', video_url: 'https://vimeo.com/76979871' }] }).then(([article]) => {
          cy.task('db:insertRows', { table: 'learn_sends', rows: [{ account_id: account.accountId, patient_id: patient.id, article_id: article!.id, channel: 'app' }] })
        })
        cy.login(email, password)
        cy.visit('/portal')
        cy.get('[data-cy=patient-learn]', { timeout: 20000 }).should('contain', 'Frío o calor').find('[data-cy=patient-learn-new]').should('exist')
        cy.get('[data-cy=patient-learn-item]').click()
        cy.get('[data-cy=patient-learn-read][data-phase=ready]', { timeout: 20000 })
        cy.get('[data-cy=learn-video]').should('have.attr', 'src', 'https://player.vimeo.com/video/76979871')
        // Back home it is no longer new; the database says when it was opened.
        cy.visit('/portal')
        cy.get('[data-cy=patient-learn-item]', { timeout: 20000 }).should('exist')
        cy.get('[data-cy=patient-learn-new]').should('not.exist')
        sendsOf(patient.id).its('0.opened_at').should('be.a', 'string')
      })
    })
  })

  // 20261105161338_learn_library_for_patients.sql: an article made visible
  // to every patient is announced once, found under the exercises as
  // "Hábitos y consejos", and opening it gives the patient a send of their
  // own ('library'), so the record shows it was read.
  it('makes one visible to all and announces it once; the patient finds it in the library', () => {
    const email = `biblioteca-${Date.now()}@example.test`
    const password = 'valencia2026'
    type Article = { id: string; visible_to_patients: boolean; announced_at: string | null }
    const articleOf = (id: string) => cy.task<Article[]>('db:selectRows', { table: 'learn_articles', columns: 'id, visible_to_patients, announced_at', match: { id } }).its(0)
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Iris', lastName: 'Biblioteca' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task<{ id: string }[]>('db:insertRows', {
          table: 'learn_articles',
          rows: [
            { account_id: account.accountId, title: 'Dormir sin dolor', body: 'De lado con un cojín.\n\nNunca boca abajo.', tags: ['habitos'] },
            // Every row names every column: a bulk insert writes null, not the default, for one left out.
            { account_id: account.accountId, title: 'Solo para quien se la envíe', body: 'Texto.', tags: [] },
          ],
        }).then(([visible]) => {
          cy.login(account.email, account.password)
          cy.visit('/settings/education')
          cy.get('[data-cy=learn-library][data-ready=true]', { timeout: 20000 })
          cy.get(`[data-cy=learn-edit-${visible!.id}]`).click()
          cy.get('[data-cy=learn-announce]').should('not.exist')
          cy.get('[data-cy=learn-visible-all]').check()
          cy.get('[data-cy=learn-announce-check]').should('be.checked')
          cy.get('[data-cy=learn-save]').click()
          cy.get('[data-cy=learn-form]').should('not.exist')
          cy.contains('[data-cy=learn-row]', 'Dormir sin dolor').find('[data-cy=learn-row-visible]').should('exist')
          articleOf(visible!.id).should((a) => {
            expect(a.visible_to_patients).to.eq(true)
            expect(a.announced_at).to.be.a('string')
          })
          // Edited again, it offers no second announcement, and the server refuses one.
          cy.get(`[data-cy=learn-edit-${visible!.id}]`).click()
          cy.get('[data-cy=learn-visibility]').should('contain', 'Se avisó a los pacientes')
          cy.get('[data-cy=learn-announce]').should('not.exist')
          cy.task<string>('db:accessTokenFor', { email: account.email, password: account.password }).then((token) => {
            cy.request({ method: 'POST', url: '/api/learn/announce', headers: { Authorization: `Bearer ${token}` }, body: { articleId: visible!.id }, failOnStatusCode: false }).its('status').should('eq', 409)
          })

          // The patient finds it under their exercises -- and not the one that was never made visible.
          cy.login(email, password)
          cy.visit('/portal/exercises')
          cy.get('[data-cy=patient-learn-library]', { timeout: 20000 }).should('contain', 'Dormir sin dolor').and('not.contain', 'Solo para quien se la envíe')
          cy.get('[data-cy=patient-learn-library-item]').should('have.length', 1).click()
          cy.get('[data-cy=patient-learn-read][data-phase=ready]', { timeout: 20000 })
          cy.get('[data-cy=learn-article] h1').should('have.text', 'Dormir sin dolor')
          sendsOf(patient.id).should((sends) => {
            expect(sends).to.have.length(1)
            expect(sends[0]!.channel).to.eq('library')
            expect(sends[0]!.opened_at).to.be.a('string')
          })
          // Opening it again reads the same send rather than adding another.
          cy.visit('/portal/exercises')
          cy.get('[data-cy=patient-learn-library-item]', { timeout: 20000 }).click()
          cy.get('[data-cy=patient-learn-read][data-phase=ready]', { timeout: 20000 })
          sendsOf(patient.id).should('have.length', 1)
        })
      })
    })
  })

  it('is not sent to another clinic’s patient', () => {
    cy.seedStaffAccount().then((other) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: other.accountId, clinicId: other.clinicId, firstName: 'Ajena', lastName: 'Paciente' }).then((stranger) => {
        cy.seedStaffAccount().then((account) => {
          cy.task<{ id: string }[]>('db:insertRows', { table: 'learn_articles', rows: [{ account_id: account.accountId, title: 'Propia', body: 'Texto.' }] }).then(([article]) => {
            cy.task<string>('db:accessTokenFor', { email: account.email, password: account.password }).then((token) => {
              cy.request({ method: 'POST', url: '/api/learn/send', headers: { Authorization: `Bearer ${token}` }, body: { patientId: stranger.id, articleId: article!.id }, failOnStatusCode: false })
                .its('status')
                .should('be.oneOf', [400, 403])
              sendsOf(stranger.id).should('have.length', 0)
            })
          })
        })
      })
    })
  })
})
