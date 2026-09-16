// /api/import/practicehub-file exists because PracticeHub's S3 bucket sends
// no CORS headers for our origin, so the browser cannot read the signed
// download URLs /api/files hands out. It fetches one and returns the bytes.
//
// An authenticated endpoint that fetches whatever URL it is handed is a way
// into everything only the server can see -- cloud metadata, anything on a
// private network, the local filesystem via file://. So it takes https on
// amazonaws.com and nothing else, and these drive the real endpoint rather
// than trusting the predicate by reading it.
describe('The PracticeHub file proxy', () => {
  const blocked = [
    ['a host that merely ends in the right letters', 'https://evil-amazonaws.com/x'],
    ['a subdomain trick', 'https://amazonaws.com.attacker.net/x'],
    ['plain http, where the signed URL could be read in transit', 'http://phub-production.s3.amazonaws.com/x'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['the local filesystem', 'file:///etc/passwd'],
    ['something that is not a URL at all', 'not a url'],
  ]

  it('refuses anything that is not a PracticeHub S3 URL', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      // cy.session() leaves the browser on a blank page; the requests below
      // need an origin that carries the auth cookie.
      cy.visit('/dashboard')

      blocked.forEach(([what, url]) => {
        cy.request({
          method: 'POST',
          url: '/api/import/practicehub-file',
          body: { url },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status, `${what}: ${url}`).to.eq(400)
        })
      })
    })
  })

  it('refuses a caller with no session, before it looks at the URL', () => {
    // No login. A real PracticeHub-shaped URL, so this is the auth gate
    // answering rather than the host check.
    cy.request({
      method: 'POST',
      url: '/api/import/practicehub-file',
      body: { url: 'https://phub-production.s3.amazonaws.com/2085/patient/3/x' },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.be.oneOf([401, 403])
    })
  })

  it('refuses a signed-in staff member without data_admin', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', {
        accountId: account.accountId,
        roleName: 'Front Desk',
        patch: { settings_access: true, data_admin: false },
      })
      const email = `nodataadmin-${Date.now()}@example.test`
      const password = 'Test1234!'
      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Front Desk',
        email,
        password,
        fullName: 'No Data Admin',
      }).then(() => {
        cy.login(email, password)
        cy.visit('/dashboard')
        cy.request({
          method: 'POST',
          url: '/api/import/practicehub-file',
          body: { url: 'https://phub-production.s3.amazonaws.com/2085/patient/3/x' },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status, 'importing files is a data_admin job').to.be.oneOf([401, 403])
        })
      })
    })
  })
})
