// The nudges around home exercises: the patient's daily reminder (sent from
// the same-day cron in the hour they chose, in their clinic's zone, once a
// day, and not when everything is already ticked) and the "new exercise"
// push, which only a member who can see the assignment can trigger. The push
// itself needs Firebase, which CI does not have; these assert what the cron
// and the route decide and record.

// A zone where it is now within the first 20 minutes of an hour (the
// reminder's window), and that hour there. Whole-hour zones cover minutes
// 0-19, Kathmandu (+5:45) 20-34, Kolkata (+5:30) 35-49; 50-59 has none.
function zoneInWindow(): { tz: string; hour: number } | null {
  for (const tz of ['Europe/Madrid', 'Asia/Kathmandu', 'Asia/Kolkata']) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
    const hour = Number(parts.find((p) => p.type === 'hour')!.value)
    const minute = Number(parts.find((p) => p.type === 'minute')!.value)
    if (minute < 18) return { tz, hour }
  }
  return null
}
const clinicDay = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const runCron = () => cy.request({ method: 'POST', url: '/api/automations/same-day-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } }).its('status').should('eq', 200)

describe('Home exercise nudges', () => {
  it("reminds a patient once, in their hour and their clinic's zone, while something is undone", () => {
    const slot = zoneInWindow()
    if (!slot) {
      cy.log('No zone inside the reminder window this minute; the timing itself is unit-tested (exercise-reminder-due).')
      return
    }
    const email = `ex-reminder-${Date.now()}@example.test`
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateClinic', { clinicId: account.clinicId, timezone: slot.tz })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Iker', lastName: 'Mora' }).then((undone) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lola', lastName: 'Pons' }).then((allDone) => {
          cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: undone.id, email, password: 'valencia2026' })
          cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: allDone.id, email: `done-${email}`, password: 'valencia2026' })
          cy.task('db:assignExercise', { accountId: account.accountId, patientId: undone.id, name: 'Plancha' })
          cy.task('db:assignExercise', { accountId: account.accountId, patientId: allDone.id, name: 'Plancha', doneOn: [clinicDay(slot.tz)] })
          cy.task('db:setExerciseReminder', { patientId: undone.id, hour: slot.hour })
          cy.task('db:setExerciseReminder', { patientId: allDone.id, hour: slot.hour })
          // An hour that is not now: untouched.
          cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Teo', lastName: 'Gil' }).then((later) => {
            cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: later.id, email: `later-${email}`, password: 'valencia2026' })
            cy.task('db:assignExercise', { accountId: account.accountId, patientId: later.id, name: 'Plancha' })
            cy.task('db:setExerciseReminder', { patientId: later.id, hour: (slot.hour + 3) % 24 })

            runCron()
            cy.task<{ exercise_reminded_on: string | null }>('db:exerciseReminderState', { patientId: undone.id }).its('exercise_reminded_on').should('eq', clinicDay(slot.tz))
            // Everything ticked: marked for the day, so it is not re-checked
            // every tick, but nothing to nag about.
            cy.task<{ exercise_reminded_on: string | null }>('db:exerciseReminderState', { patientId: allDone.id }).its('exercise_reminded_on').should('eq', clinicDay(slot.tz))
            cy.task<{ exercise_reminded_on: string | null }>('db:exerciseReminderState', { patientId: later.id }).its('exercise_reminded_on').should('eq', null)
          })
        })
      })
    })
  })

  it("will not push to another clinic's patient", () => {
    cy.seedStaffAccount().then((other) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: other.accountId, clinicId: other.clinicId, firstName: 'Ana', lastName: 'Rey' }).then((patient) => {
        cy.task<{ patientExerciseId: string }>('db:assignExercise', { accountId: other.accountId, patientId: patient.id, name: 'Puente' }).then(({ patientExerciseId }) => {
          cy.seedStaffAccount().then((mine) => {
            cy.login(mine.email, mine.password)
            cy.visit('/dashboard')
            // The session cookie the sign-in left is what authenticates this.
            cy.request({ method: 'POST', url: '/api/exercises/notify-assigned', body: { patientExerciseId }, failOnStatusCode: false }).its('status').should('eq', 404)
          })
        })
      })
    })
  })
})
