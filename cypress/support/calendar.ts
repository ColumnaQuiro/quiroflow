// Shared helpers for the calendar specs that book an appointment and then
// look for it in the day grid.

/**
 * The practitioner seedStaffAccount() creates, as the Calendar renders them.
 *
 * seedStaffAccount defaults ownerName to 'Test Owner' (cypress/support/
 * commands.ts) and create_account_with_owner makes that person a
 * practitioner assigned to the clinic, so this is the name on the
 * calendar's single practitioner tab and in the New Appointment panel's
 * Practitioner select.
 */
export const SEEDED_PRACTITIONER = 'Test Owner'

const PATIENT_SEARCH = 'input[placeholder="Search by name, phone, or email…"]'

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/**
 * `d` as an <input type="date"> value, in the browser's OWN timezone.
 *
 * Deliberately not `toISOString().slice(0, 10)`, which is the UTC date:
 * NewAppointmentPanel parses this field as local time
 * (`new Date(`${date}T${time}`)`) and pages/calendar.vue builds its day
 * range from local midnight (startOfDay), so a UTC-derived string names a
 * different day from the one the app then shows -- east of Greenwich
 * between midnight and the offset (Europe/Madrid 00:00-02:00 in summer),
 * west of it during the evening. CI runs in UTC and never sees it; a
 * developer running the suite locally at the wrong hour does, and the
 * calendar then steps back to a day the appointment isn't on.
 */
export function dateInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Yesterday, in the browser's own timezone.
 *
 * These specs book in the past because AppointmentBillingTab raises no
 * invoice for a visit that hasn't happened yet -- and yesterday rather than
 * a fixed weekday, because the weekday makes no difference here: the seeded
 * clinic's business_hours is the all-days-empty default, which
 * hasBusinessHoursConfigured() reads as "not configured" rather than
 * "closed every day", so nothing is shaded, NewAppointmentPanel's
 * outside-working-hours confirm never fires, and the day grid renders
 * identically Monday to Sunday. stepDate(-1) is likewise a plain
 * minus-one-day that skips nothing. Yesterday is therefore the one date
 * that is always exactly one Previous click away, on any day of the week.
 */
export function yesterday(): Date {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d
}

/**
 * Opens the calendar's New Appointment panel -- but only once the page holds
 * the reference data the panel snapshots as it mounts.
 *
 * pages/calendar.vue fetches that data after mount (onMounted: `await
 * loadReferenceData()` and only then `ensureValidPractitionerFilter()`),
 * while NewAppointmentPanel reads the practitioner exactly once, at mount:
 * `const practitionerId = ref(props.prefillPractitionerId ?? '')`. A panel
 * opened before the fetch lands captures '' and never re-reads it, however
 * long the rest of the form is filled in for, so the appointment is
 * inserted with practitioner_id null. loadAppointments() then applies
 * `.eq('practitioner_id', practitionerFilter)`, and since the calendar has
 * no "unassigned practitioner" tab, a null one is excluded from every tab:
 * the booking exists in the database and is invisible in the grid for ever.
 * That is what made these specs fail with "Expected to find content:
 * '<patient>' but never did" after stepping the day back, on a run where
 * the click beat the fetch.
 *
 * The same too-early panel also fires the patient search's one-shot 250ms
 * debounce before the page's own queries have proven the session is live;
 * that query returns no rows, nothing re-runs it, and the spec fails
 * earlier still on the dropdown showing "No matches".
 *
 * The practitioner tab bar IS that data -- one button per practitioner
 * assigned to this clinic, with "No practitioners are assigned to this
 * clinic yet." rendered in its place until the fetch resolves -- and
 * ensureValidPractitionerFilter() runs in the same synchronous block that
 * populates it, so a rendered tab means the filter behind it is set too.
 * Asserting the tab is therefore an assertion about page state, not a wait
 * for time to pass.
 */
export function openNewAppointmentPanel(practitionerName: string = SEEDED_PRACTITIONER) {
  cy.get('[data-testid="practitioner-tabs"]').contains('button', practitionerName).should('be.visible')
  // First click after a fresh visit can still race Vue hydration (see
  // commands.ts clickUntil) -- that is a separate problem from the data
  // above, and both have to be past before the panel is usable.
  cy.clickUntil('button:contains("New Appointment")', PATIENT_SEARCH)
}

/**
 * Asserts the day grid is showing `day`.
 *
 * Pins what a bare `cy.get('[aria-label="Previous"]').click()` only assumes.
 * Day-view columns carry the anchor date as data-day-key (pages/
 * calendar.vue), so this fails naming both dates when navigation lands
 * somewhere else, instead of the booked patient's name simply never
 * appearing.
 */
export function assertDayGridShows(day: Date) {
  cy.get('[data-cal-col]').first().should('have.attr', 'data-day-key', dateInputValue(day))
}

/** Today at hh:mm in the browser's own timezone, as an ISO instant. */
export function todayAt(h: number, m = 0): string {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

/**
 * A patient and one visit with them today, for the specs that need a visit
 * in a particular stage. `extra` goes straight to db:createAppointment
 * (confirmationStatus, checkedInAt, status, source, ...).
 */
export function seedVisit(
  account: { accountId: string; clinicId: string; teamMemberId: string },
  roomId: string | null,
  first: string,
  last: string,
  h: number,
  m: number,
  extra: Record<string, unknown> = {},
): Cypress.Chainable<{ patientId: string; appointmentId: string }> {
  return cy
    .task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: last })
    .then((patient) =>
      cy
        .task<{ id: string }>('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          practitionerId: account.teamMemberId,
          roomId,
          startsAt: todayAt(h, m),
          ...extra,
        })
        .then((appt) => ({ patientId: patient.id, appointmentId: appt.id })),
    )
}
