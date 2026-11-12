// Family accounts (20261106053857_family_accounts.sql): one patient login
// manages the family members the clinic has linked to it in patient_managers,
// and only those. The database decides -- every patient-side policy reads
// patients_i_can_act_for() -- so the first test reads straight through RLS as
// each login, and the rest drive the portal and the ficha.
//
// Invented names only.
const years = (n: number) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString().slice(0, 10)
}
const inDays = (n: number, hour = 10) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

interface Family {
  account: { accountId: string; clinicId: string; email: string; password: string }
  rosa: { id: string }
  lucas: { id: string }
  andres: { id: string }
  marta: { id: string }
  rosaLogin: { email: string; password: string }
  martaLogin: { email: string; password: string }
}

// Rosa (adult, has the app) manages Lucas, her 9-year-old, as his guardian with
// full access, and Andrés, her partner, with his consent for visits and
// payments only. Marta, Rosa's adult sister, has her own login and no link.
function seedFamily(): Cypress.Chainable<Family> {
  return cy.seedStaffAccount().then((account) => {
    const stamp = Date.now()
    const mk = (firstName: string, dateOfBirth: string) =>
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Ribera', dateOfBirth })
    return mk('Rosa', years(40)).then((rosa) =>
      mk('Lucas', years(9)).then((lucas) =>
        mk('Andrés', years(42)).then((andres) =>
          mk('Marta', years(37)).then((marta) => {
            const rosaLogin = { email: `family-rosa-${stamp}@example.test`, password: 'valencia2026' }
            const martaLogin = { email: `family-marta-${stamp}@example.test`, password: 'valencia2026' }
            cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: rosa.id, ...rosaLogin })
            cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: marta.id, ...martaLogin })
            const rel = (a: string, b: string, relation: string) => ({ account_id: account.accountId, patient_id: a, related_patient_id: b, relation })
            cy.task('db:insertRows', {
              table: 'patient_relations',
              rows: [rel(rosa.id, lucas.id, 'child'), rel(lucas.id, rosa.id, 'parent'), rel(rosa.id, andres.id, 'partner'), rel(andres.id, rosa.id, 'partner'), rel(rosa.id, marta.id, 'sibling'), rel(marta.id, rosa.id, 'sibling')],
            })
            cy.task('db:insertRows', {
              table: 'patient_managers',
              rows: [
                { account_id: account.accountId, manager_patient_id: rosa.id, patient_id: lucas.id, basis: 'guardian', access: 'full' },
                { account_id: account.accountId, manager_patient_id: rosa.id, patient_id: andres.id, basis: 'consent', access: 'admin', note: 'Lo pidió en recepción' },
              ],
            })
            cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: lucas.id, startsAt: inDays(3, 17) })
            cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: andres.id, startsAt: inDays(4, 9) })
            cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: marta.id, startsAt: inDays(5, 12) })
            cy.task<{ id: string }>('db:createPatientFile', { accountId: account.accountId, patientId: lucas.id, fileName: 'informe-lucas.pdf' }).then((f) =>
              cy.task('db:updateRows', { table: 'patient_files', values: { visibility: 'custom' }, match: { id: f.id } }),
            )
            cy.task<{ id: string }>('db:createPatientFile', { accountId: account.accountId, patientId: andres.id, fileName: 'informe-andres.pdf' }).then((f) =>
              cy.task('db:updateRows', { table: 'patient_files', values: { visibility: 'custom' }, match: { id: f.id } }),
            )
            return cy.wrap({ account, rosa, lucas, andres, marta, rosaLogin, martaLogin } as Family)
          }),
        ),
      ),
    )
  })
}

// The name at the foot of the sidebar only becomes the switcher once the
// family has loaded (it is plain text for somebody with no family).
const openSwitcher = () => cy.get('button[data-cy=family-switcher-toggle]').click()

const namesOf = (rows: { first_name?: string }[]) => rows.map((r) => r.first_name).sort()

describe('Family accounts', () => {
  it('a login reads the people the clinic linked to it, within each link, and nobody else', () => {
    seedFamily().then((f) => {
      // Rosa: herself, her son and her partner -- not her sister.
      cy.task<{ rows: { first_name: string }[] }>('db:selectAsUser', { ...f.rosaLogin, table: 'patients', select: 'first_name' })
        .its('rows')
        .then((rows) => expect(namesOf(rows)).to.deep.equal(['Andrés', 'Lucas', 'Rosa']))
      cy.task<{ rows: { patient_id: string }[] }>('db:selectAsUser', { ...f.rosaLogin, table: 'appointments', select: 'patient_id' })
        .its('rows')
        .then((rows) => {
          const ids = rows.map((r) => r.patient_id)
          expect(ids).to.include(f.lucas.id)
          expect(ids).to.include(f.andres.id)
          expect(ids).not.to.include(f.marta.id)
        })
      // Documents are clinical: Lucas's (full link), not Andrés's (visits and payments only).
      cy.task<{ rows: { file_name: string }[] }>('db:selectAsUser', { ...f.rosaLogin, table: 'patient_files', select: 'file_name' })
        .its('rows')
        .then((rows) => expect(rows.map((r) => r.file_name)).to.deep.equal(['informe-lucas.pdf']))

      // Marta, who is family but was given nothing: only herself.
      cy.task<{ rows: { first_name: string }[] }>('db:selectAsUser', { ...f.martaLogin, table: 'patients', select: 'first_name' })
        .its('rows')
        .then((rows) => expect(namesOf(rows)).to.deep.equal(['Marta']))
      cy.task<{ rows: unknown[] }>('db:selectAsUser', { ...f.martaLogin, table: 'patient_files', select: 'id' }).its('rows').should('have.length', 0)

      // The switcher's list, with what each link reaches.
      cy.task<{ data: { first_name: string; access: string; basis: string | null; relation: string | null }[] }>('db:callRpcAs', { ...f.rosaLogin, fn: 'get_my_family' }).then(({ data }) => {
        expect(data!.map((p) => `${p.first_name}:${p.access}`)).to.deep.equal(['Rosa:self', 'Andrés:admin', 'Lucas:full'])
        expect(data!.find((p) => p.first_name === 'Lucas')).to.include({ basis: 'guardian', relation: 'child' })
      })

      // An RPC acting for somebody outside the set is refused, not answered.
      cy.task<{ data: unknown; error: string | null }>('db:callRpcAs', { ...f.martaLogin, fn: 'get_patient_booking_info', args: { p_patient_id: f.lucas.id } })
        .its('error')
        .should('equal', 'Not found')

      // Opening Lucas's record is logged as Rosa, the family member.
      cy.task('db:callRpcAs', { ...f.rosaLogin, fn: 'log_family_access', args: { p_patient_id: f.lucas.id, p_kind: 'record_opened' } })
      cy.task<{ actor_name: string; team_member_id: string | null; detail: { via: string; manager_patient_id: string } }[]>('db:selectRows', {
        table: 'patient_access_log',
        columns: 'actor_name, team_member_id, detail',
        match: { patient_id: f.lucas.id },
      }).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]!.actor_name).to.equal('Rosa Ribera')
        expect(rows[0]!.team_member_id).to.equal(null)
        expect(rows[0]!.detail).to.include({ via: 'family', manager_patient_id: f.rosa.id })
      })

      // A guardian link lapses by itself at 16.
      cy.task('db:updateRows', { table: 'patients', values: { date_of_birth: years(16) }, match: { id: f.lucas.id } })
      cy.task<{ rows: { first_name: string }[] }>('db:selectAsUser', { ...f.rosaLogin, table: 'patients', select: 'first_name' })
        .its('rows')
        .then((rows) => expect(namesOf(rows)).to.deep.equal(['Andrés', 'Rosa']))
    })
  })

  it('switching to a family member in the portal shows their record, and only what the link reaches', () => {
    seedFamily().then((f) => {
      cy.login(f.rosaLogin.email, f.rosaLogin.password)
      cy.visit('/portal')
      cy.contains('h1', 'Hi, Rosa').should('be.visible')
      cy.get('[data-cy=acting-banner]').should('not.exist')

      // Lucas: his visit, his documents, said on every page.
      openSwitcher()
      cy.get('[data-cy=family-switcher] [data-cy=family-person-Lucas]').click()
      cy.get('[data-cy=acting-banner]').should('contain', "You are viewing Lucas's account")
      cy.contains('h1', "Lucas's account").should('be.visible')
      cy.contains('a', 'Documents').click()
      cy.location('pathname').should('eq', '/portal/documents')
      cy.contains('informe-lucas.pdf').should('be.visible')
      cy.get('[data-cy=acting-banner]').should('be.visible')

      // Andrés: visits and payments only -- no Documents, and the page itself
      // sends them home.
      openSwitcher()
      cy.get('[data-cy=family-switcher] [data-cy=family-person-Andrés]').click()
      cy.location('pathname').should('eq', '/portal')
      cy.get('[data-cy=acting-banner]').should('contain', "You are viewing Andrés's account").and('contain', 'Only visits, bookings and payments')
      cy.get('aside').contains('a', 'Documents').should('not.exist')
      cy.get('aside').contains('a', 'Appointments').click()
      cy.location('pathname').should('eq', '/portal/appointments')
      cy.contains('informe-andres.pdf').should('not.exist')

      // The choice survives a reload (cookie), and "Back to mine" ends it.
      cy.reload()
      cy.get('[data-cy=acting-banner]').should('contain', 'Andrés')
      cy.get('[data-cy=acting-banner-back]').click()
      cy.get('[data-cy=acting-banner]').should('not.exist')
      cy.visit('/portal')
      cy.contains('h1', 'Hi, Rosa').should('be.visible')
    })
  })

  it('a message written for a child reaches the clinic as the child’s, signed by the parent', () => {
    seedFamily().then((f) => {
      cy.login(f.rosaLogin.email, f.rosaLogin.password)
      cy.visit('/portal')
      openSwitcher()
      cy.get('[data-cy=family-switcher] [data-cy=family-person-Lucas]').click()
      cy.get('[data-cy=acting-banner]').should('be.visible')
      cy.get('aside').contains('a', 'Messages').click()
      cy.get('textarea').type('Lucas tiene revisión el jueves, ¿podemos venir antes?')
      cy.contains('button', 'Send').click()
      cy.contains('Lucas tiene revisión el jueves').should('be.visible')
      cy.task<{ direction: string; sent_by_patient_id: string | null }[]>('db:selectRows', {
        table: 'patient_app_messages',
        columns: 'direction, sent_by_patient_id',
        match: { patient_id: f.lucas.id },
      }).should((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]).to.deep.equal({ direction: 'inbound', sent_by_patient_id: f.rosa.id })
      })
    })
  })

  it('the desk gives a parent access to a child’s app from the Familia card', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (firstName: string, dateOfBirth: string) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Ortega', dateOfBirth })
      mk('Elena', years(38)).then((elena) =>
        mk('Nico', years(7)).then((nico) => {
          const rel = (a: string, b: string, relation: string) => ({ account_id: account.accountId, patient_id: a, related_patient_id: b, relation })
          cy.task('db:insertRows', { table: 'patient_relations', rows: [rel(nico.id, elena.id, 'parent'), rel(elena.id, nico.id, 'child')] })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${nico.id}`)
          cy.get('[data-cy=family-link]').should('contain', 'Elena Ortega')
          cy.get('[data-cy=family-app-access-add]').click({ scrollBehavior: 'center' })
          // Under 16, so a guardian link is offered and chosen; it reaches everything.
          cy.get('[data-cy=family-app-basis-guardian]').should('be.checked')
          cy.get('[data-cy=family-app-access-full]').should('be.checked')
          cy.get('[data-cy=family-app-access-save]').click({ scrollBehavior: 'center' })
          cy.get('[data-cy=family-app-access-link]').should('contain', "Elena manages Nico's app").and('contain', 'guardian').and('contain', 'no app yet')

          cy.task<{ manager_patient_id: string; patient_id: string; basis: string; access: string }[]>('db:selectRows', {
            table: 'patient_managers',
            columns: 'manager_patient_id, patient_id, basis, access',
            match: { account_id: account.accountId },
          }).then((rows) => expect(rows).to.deep.equal([{ manager_patient_id: elena.id, patient_id: nico.id, basis: 'guardian', access: 'full' }]))

          // And taken away again.
          cy.get('[data-cy=family-app-access-remove]').click({ scrollBehavior: 'center' })
          cy.get('[data-cy=family-app-access-link]').should('not.exist')
          cy.task<unknown[]>('db:selectRows', { table: 'patient_managers', columns: 'id', match: { account_id: account.accountId } }).should('have.length', 0)
        }),
      )
    })
  })

  it('linking a child under 16 from the ficha gives the parent guardian access by itself, and unlinking takes it away', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (firstName: string, dateOfBirth: string) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Vidal', dateOfBirth })
      mk('Clara', years(41)).then((clara) =>
        mk('Teo', years(6)).then((teo) =>
          mk('Irene', years(17)).then((irene) =>
            mk('Hugo', years(5)).then((hugo) => {
              const managers = () =>
                cy.task<{ manager_patient_id: string; patient_id: string; basis: string; access: string }[]>('db:selectRows', {
                  table: 'patient_managers',
                  columns: 'manager_patient_id, patient_id, basis, access',
                  match: { account_id: account.accountId },
                })
              const linkFromFicha = (name: string, relation: string) => {
                cy.get('[data-cy=family-add]').click({ scrollBehavior: 'center' })
                cy.get('[data-cy=family-search]').type(name)
                cy.contains('[data-cy=family-result]', `${name} Vidal`).click()
                cy.get('[data-cy=family-relation]').select(relation)
              }

              cy.login(account.email, account.password)
              cy.visit(`/patients/${clara.id}`)

              // Teo, 6: the form says what saving gives, and saving gives it.
              linkFromFicha('Teo', 'child')
              cy.get('[data-cy=family-auto-guardian-hint]').should('contain', "Clara will manage Teo's app as their guardian")
              cy.get('[data-cy=family-save]').click({ scrollBehavior: 'center' })
              cy.contains('[data-cy=family-link]', 'Teo Vidal')
                .find('[data-cy=family-app-access-link]')
                .should('contain', "Clara manages Teo's app")
                .and('contain', 'guardian')
                .and('contain', 'everything')
              managers().then((rows) => expect(rows).to.deep.equal([{ manager_patient_id: clara.id, patient_id: teo.id, basis: 'guardian', access: 'full' }]))

              // Irene, 17: her own consent is needed, so nothing is given.
              linkFromFicha('Irene', 'child')
              cy.get('[data-cy=family-auto-guardian-hint]').should('not.exist')
              cy.get('[data-cy=family-save]').click({ scrollBehavior: 'center' })
              cy.contains('[data-cy=family-link]', 'Irene Vidal').find('[data-cy=family-app-access-link]').should('not.exist')
              managers().should('have.length', 1)

              // A child linked without the desk (as the WhatsApp receptionist
              // does, with no created_by) is left for the desk to grant.
              cy.task('db:insertRows', {
                table: 'patient_relations',
                rows: [
                  { account_id: account.accountId, patient_id: clara.id, related_patient_id: hugo.id, relation: 'child' },
                  { account_id: account.accountId, patient_id: hugo.id, related_patient_id: clara.id, relation: 'parent' },
                ],
              })
              managers().should('have.length', 1)

              // Unlinking Teo takes his access with it.
              cy.contains('[data-cy=family-link]', 'Teo Vidal').find('[data-cy=family-remove]').click({ scrollBehavior: 'center' })
              cy.contains('[data-cy=family-link]', 'Teo Vidal').should('not.exist')
              managers().should('have.length', 0)
            }),
          ),
        ),
      )
    })
  })

  it('signing up never lands on a child’s record, nor guesses between two adults sharing an email', () => {
    cy.seedStaffAccount().then((account) => {
      const stamp = Date.now()
      const shared = `familia-${stamp}@example.test`
      const kidOnly = `solo-nino-${stamp}@example.test`
      const mk = (firstName: string, dateOfBirth: string, email: string) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Soler', dateOfBirth, email })
      mk('Pilar', years(45), shared)
      mk('Jorge', years(47), shared)
      mk('Iker', years(8), shared)
      mk('Ane', years(6), kidOnly)
      // Two adults on the family email: nobody is picked.
      cy.task('db:createLoneUser', { email: shared, password: 'valencia2026' })
      cy.task<{ error: string | null }>('db:callRpcAs', { email: shared, password: 'valencia2026', fn: 'claim_patient_profile' })
        .its('error')
        .should('match', /share this email/)
      // Only a child's record on it: not hers to sign in to.
      cy.task('db:createLoneUser', { email: kidOnly, password: 'valencia2026' })
      cy.task<{ error: string | null }>('db:callRpcAs', { email: kidOnly, password: 'valencia2026', fn: 'claim_patient_profile' })
        .its('error')
        .should('equal', 'No matching patient record found')
      cy.task<{ user_id: string | null }[]>('db:selectRows', { table: 'patients', columns: 'user_id', match: { account_id: account.accountId } }).then((rows) =>
        expect(rows.every((r) => r.user_id === null)).to.equal(true),
      )
      // The portal says to ask the clinic, not "not found".
      cy.login(shared, 'valencia2026')
      cy.visit('/portal')
      cy.location('pathname').should('eq', '/portal/not-found')
      cy.get('[data-cy=portal-shared-email]').should('contain', 'More than one person at your clinic has this email')
    })
  })
})
