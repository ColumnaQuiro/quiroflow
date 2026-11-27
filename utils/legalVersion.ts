// Which text of the Terms of service and the Privacy policy a new sign-up is
// shown, as the date it last changed in a way a clinic would care about.
//
// pages/signup.vue sends it with the sign-up, and the database writes it to
// legal_acceptances the moment the user is created
// (20261127090000_legal_acceptances.sql). That row is the only record that a
// clinic accepted anything, and of WHICH text: change /legal/terms or
// /legal/privacy materially and this date moves with it, or everyone who
// signs up afterwards is recorded as having accepted the old one.
//
// A date and nothing else: the database ignores any other shape.
export const LEGAL_VERSION = '2026-11-27'
