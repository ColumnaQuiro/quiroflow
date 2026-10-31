// A WhatsApp reaction is shown on the message it reacts to, as on the
// patient's phone, rather than as a message of its own
// (whatsapp_messages.contact_reaction). A new emoji replaces theirs, an empty
// one -- taken back -- clears it, and none of it is a message: nothing new in
// the thread. A reaction to a message QuiroFlow does not have still arrives as
// the "Ha reaccionado con" line, so nothing is lost.
let phoneNumberId = ''
let phone = ''
let appSecret = ''

function deliver(message: Record<string, unknown>) {
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: `wamid.r${Date.now()}${Math.random()}`, from: `34${phone}`, ...message }] } }] }],
  })
  return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) =>
    cy.request({ method: 'POST', url: '/api/whatsapp/webhook', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature } }),
  )
}
const react = (messageId: string, emoji: string) => deliver({ type: 'reaction', reaction: { message_id: messageId, emoji } })

type Row = { id: string; wamid: string | null; direction: string; body_preview: string | null; contact_reaction: string | null }

describe('WhatsApp reactions', () => {
  it('shows a reaction on the message it is about, replaces it, and clears it when taken back', () => {
    phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    phone = `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    appSecret = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Elena', lastName: 'Reacciona' }).then((patient) => {
        cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
        cy.task('db:seedWhatsappReplyScenario', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, phoneNumberId, phone, confirmationStatus: null })
        const wamid = `wamid.ours${Date.now()}`
        cy.task('db:insertRows', {
          table: 'whatsapp_messages',
          rows: [{ account_id: account.accountId, patient_id: patient.id, phone_number: `34${phone}`, wamid, direction: 'outbound', status: 'read', body_preview: 'Tu cita queda el martes a las 10:00.', channel: 'whatsapp' }],
        })
        const rows = () => cy.task<Row[]>('db:selectRows', { table: 'whatsapp_messages', columns: 'id, wamid, direction, body_preview, contact_reaction', match: { patient_id: patient.id } })
        // The scenario seeds a reminder of its own; ours is the one with this wamid.
        const ours = () => rows().then((list) => list.find((r) => r.wamid === wamid)!)

        react(wamid, '👍')
        ours().its('contact_reaction').should('eq', '👍')
        // Not a message: nothing inbound was stored for it.
        rows().then((list) => expect(list.filter((r) => r.direction === 'inbound')).to.have.length(0))

        cy.login(account.email, account.password)
        cy.visit('/inbox')
        cy.showAllConversations()
        cy.contains('Elena Reacciona').click()
        cy.contains('[data-cy=thread-message]', 'Tu cita queda el martes').find('[data-cy=message-reaction]').should('have.text', '👍')

        // Changed on the phone: replaced, not added. (The open thread patches
        // it in place from the realtime UPDATE, as it does ticks; the thread is
        // reopened here because local realtime does not deliver to Cypress.)
        const reopen = () => {
          cy.reload()
          cy.showAllConversations()
          cy.contains('Elena Reacciona').click()
        }
        react(wamid, '❤️')
        ours().its('contact_reaction').should('eq', '❤️')
        reopen()
        cy.contains('[data-cy=thread-message]', 'Tu cita queda el martes').find('[data-cy=message-reaction]').should('have.text', '❤️')

        // Taken back: gone.
        react(wamid, '')
        ours().its('contact_reaction').should('be.null')
        reopen()
        cy.contains('[data-cy=thread-message]', 'Tu cita queda el martes').should('be.visible').find('[data-cy=message-reaction]').should('not.exist')

        // About a message QuiroFlow never had: kept as the line, drawn small.
        react('wamid.unknown-to-us', '🙏')
        rows().then((list) => expect(list.filter((r) => r.direction === 'inbound').map((r) => r.body_preview)).to.deep.eq(['Ha reaccionado con 🙏']))
        reopen()
        cy.get('[data-cy=thread-reaction-line]').should('contain', '🙏')
        rows().then((list) => expect(list.filter((r) => r.direction === 'outbound')).to.have.length(2))
      })
    })
  })
})
