# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The staff and patient app in `mobile/` is a Capacitor wrapper around web UI,
shipped to the App Store and Google Play. Its design language is web, not
native iOS or Android.

## Users

QuiroFlow is clinic management software for allied-health clinics:
chiropractic first, where it started, and other hands-on practices such as
physiotherapy and osteopathy. The market today is Spain.

- **Clinic owner**: buys QuiroFlow and usually treats patients as well. Sets
  up the clinic, prices, team and permissions, and reads the reports and
  the money.
- **Front desk / reception**: books, reschedules and confirms appointments,
  answers WhatsApp and Instagram, takes payments, sells bonos, and keeps
  the day running.
- **Practitioners**: work through their own day, write clinical notes, run
  posture analysis, follow care plans and re-exams, and set home exercises.
- **Patients**: book online on the clinic's own subdomain, and use the
  patient app and portal for appointments, documents, payments, exercises,
  learning content and messages.

Access is per role and permission (Settings → Roles). Two-factor login can be
required for each clinic.

## Product Purpose

Run a whole clinic in one app, from the first message to the follow-up
visit: bring new patients in, answer them, treat them, get paid, and get
them back. Success means a clinic stops juggling separate tools, nothing
falls through the gaps between them, and the front desk spends less time on
admin.

## Positioning

**One app, one record.** Ad leads, the AI receptionist, the schedule, posture
analysis, care plans, bonos and memberships, VeriFactu invoices and the
patient app all work on the same patient record, so there is nothing to sync
and nothing lost along the way. A clinic is not buying "a CRM", "a
receptionist" and "a PMS". It wants new patients to arrive and existing ones
to stay.

The working marketing frame groups every capability under five verbs that
follow the patient: **Captar, Atender, Tratar, Cobrar, Fidelizar** (bring in,
attend to, treat, get paid, keep). See `docs/marketing/una-sola-app.html` (a
proposal, not yet published).

## Operating Context

- The front desk runs on an iPad (`tailwind.tokens.ts`), so every control
  has a 44px touch size alongside the 36px mouse size. *Inferred, not yet
  confirmed:* a patient is often standing at the counter; practitioners use
  phones between treatments; owners read reports and settings outside clinic
  hours.
- Patients write mostly on WhatsApp. The AI receptionist answers around the
  clock and books into the real schedule.
- Spanish fiscal and legal context: VeriFactu invoicing (mandatory from
  1 Jan 2027), the AEAT, gestoría exports, GDPR and record retention.
- Many clinics come from PracticeHub or Quirocitas, and importing their data
  is part of signing up.

## Capabilities and Constraints

- Scheduling across several locations with automatic room assignment,
  waitlist, online booking and a booking page on each clinic's subdomain
  (`<slug>.app.quiroflow.com`).
- Patient records: clinical notes, posture analysis, care plans and
  re-exams, forms and documents with signatures, files, home exercises and
  learning content.
- Billing: invoices and VeriFactu facturas, bonos (packages), memberships
  billed automatically through Stripe, gift vouchers, payment links, and
  reports including debtors, commissions and gestoría.
- Growth: Meta lead ads, a pipeline of leads, the AI receptionist on
  WhatsApp and Instagram, automations and campaigns, recalls, and Google
  reviews.
- Developer API, webhooks and a public developer docs site (`/developers`).
- **Terminology** stays in Spanish where Spanish clinics use the word: bono,
  factura, gestoría, revisión/revaloración, recepción, plan de cuidado.
- **Language**: every staff string exists in English and Spanish, written
  together at the call site (`t(en, es)`). Each staff member picks their
  language in Settings → Appearance.
- **Number format**: Spanish four-digit amounts are written without a
  thousands separator ("1274,00 €"), on purpose (RAE/CLDR). Do not add
  grouping.

## Brand Commitments

- The name is **QuiroFlow**. The company is Columnaquiro S.L., which also
  runs a working chiropractic clinic, Columnaquiro.
- Production lives at `app.quiroflow.com`. The bare `quiroflow.com` is a
  separate marketing site in its own repo.
- Customer-facing copy is in Spanish, in a direct and practical clinic
  voice, not the voice of an ad agency.

## Evidence on Hand

- **Columnaquiro** is a real clinic that uses QuiroFlow and can be cited as
  a customer.
- **Other paying clinics** exist. Use their names, logos or quotes only with
  each clinic's permission. None are collected in this repo yet.
- Do not invent testimonials, numbers of customers, benchmarks or results.
- **Screenshots and demos use invented data only**: the fictional "Clínica
  Demo" and made-up patient names, never real patients and never
  Columnaquiro's own data. Patient names never appear in code, commits or
  pull requests.

## Product Principles

1. **One record, no syncing.** A new feature uses the patient record that is
   already there. It does not start a second copy of it.
2. **Nothing lost silently.** Merges, imports, payments and messages must
   never drop data while looking successful. If something fails, say so on
   screen.
3. **Built for the front desk's real day**: fast, interruptible and easy to
   scan with a patient at the counter.
4. **Compliance is part of the product.** VeriFactu, GDPR, two-factor login
   and the activity log come built in, not as add-ons.
5. **Spanish clinic reality first**: Spanish terms, formats and fiscal rules
   come first. English is offered for staff who choose it.
